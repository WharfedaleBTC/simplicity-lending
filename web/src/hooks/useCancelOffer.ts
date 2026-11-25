import { fetchFeeRateSatPerKvbAbovePending } from '@/api/esplora/fee'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useChain } from '@/providers/chain/useChain'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { findPendingOfferMetadata } from '@/simplicity/lending/metadata'
import {
  buildDerivedLendingOfferProgramParams,
  buildLendingOfferSpendInfo,
  buildLendingWitness,
  loadLendingProgram,
} from '@/simplicity/lending/program'
import { buildScriptAuthWitness, loadScriptAuthProgram } from '@/simplicity/script-auth/program'
import { buildCovenantSpendInfo } from '@/simplicity/taproot'
import { bytesToHex, hexToBytes } from '@/utils/hex'
import { getProcessingTxids } from '@/utils/pendingTransactions'
import { toBytes32, toUint32, toUint64 } from '@/utils/uint'
import {
  assertDistinctOutpoints,
  assertExplicitAmount,
  assertScriptMatches,
  fetchTransaction,
  type PreparedTransaction,
  requireExplicitAmount,
  requireExplicitAsset,
  requireTxOut,
  type TxSpec,
} from '@/wharfedale/tx'
import { Address, AssetId, OutPoint, Script } from '@/wharfedale/types'
import { isPolicyAssetUtxo, requireWalletUtxo, WALLET_INPUT_RBF_SEQUENCE } from '@/wharfedale/utxo'

const NFT_AMOUNT = 1n
const BURN_PAYLOAD = new TextEncoder().encode('burn')

export interface CancelOfferParams {
  pendingOfferOutpoint: string
  lenderNftOutpoint: string
  borrowerNftOutpoint: string
  collateralRecipientAddress: string
  feeOutpoints: string[]
}

export interface CancelOfferSummary {
  inputs: Record<string, string>
  outputs: Record<string, string>
  assetIds: Record<string, string>
}

export function useCancelOffer() {
  const { chainNetwork: lwkNetwork } = useChain()
  const { getBlindedWalletUtxos, syncWallet } = useWallet()
  const { pendingTxs } = usePendingTransactions()

  const cancelOffer = async (
    params: CancelOfferParams,
  ): Promise<PreparedTransaction<CancelOfferSummary>> => {
    const pendingOfferOutpoint = new OutPoint(params.pendingOfferOutpoint)
    const lenderNftOutpoint = new OutPoint(params.lenderNftOutpoint)
    const borrowerNftOutpoint = new OutPoint(params.borrowerNftOutpoint)
    const feeOutpoints = params.feeOutpoints.map(o => new OutPoint(o))
    assertDistinctOutpoints(
      [pendingOfferOutpoint, lenderNftOutpoint, borrowerNftOutpoint, ...feeOutpoints],
      'Cancellation inputs must use distinct outpoints',
    )
    await syncWallet()
    const blindedWalletUtxos = await getBlindedWalletUtxos()
    const feeUtxos = params.feeOutpoints.map(o =>
      requireWalletUtxo(blindedWalletUtxos, o, `Fee ${NETWORK_CONFIG.collateralAsset.symbol}`),
    )
    if (feeUtxos.some(utxo => !isPolicyAssetUtxo(utxo, lwkNetwork.policyAsset()))) {
      throw new Error(`Fee outpoints must be wallet ${NETWORK_CONFIG.collateralAsset.symbol} UTXOs`)
    }
    const [pendingOfferTx, lenderNftTx, borrowerNftTx, feeTxs, feeRate] = await Promise.all([
      fetchTransaction(pendingOfferOutpoint),
      fetchTransaction(lenderNftOutpoint),
      fetchTransaction(borrowerNftOutpoint),
      Promise.all(feeOutpoints.map(o => fetchTransaction(o))),
      fetchFeeRateSatPerKvbAbovePending(getProcessingTxids(pendingTxs)),
    ])
    const pendingOfferTxOut = requireTxOut(
      pendingOfferTx,
      pendingOfferOutpoint.vout(),
      'Pending offer',
    )

    const lenderNftTxOut = requireTxOut(lenderNftTx, lenderNftOutpoint.vout(), 'Lender NFT')
    const borrowerNftTxOut = requireTxOut(borrowerNftTx, borrowerNftOutpoint.vout(), 'Borrower NFT')
    const feeTxOuts = feeTxs.map((tx, index) =>
      requireTxOut(tx, feeOutpoints[index].vout(), `Fee ${NETWORK_CONFIG.collateralAsset.symbol}`),
    )

    const collateralAsset = requireExplicitAsset(pendingOfferTxOut, 'Pending offer')
    const collateralAmount = requireExplicitAmount(pendingOfferTxOut, 'Pending offer')
    const lenderNftAsset = requireExplicitAsset(lenderNftTxOut, 'Lender NFT')
    assertExplicitAmount(lenderNftTxOut, NFT_AMOUNT, 'Lender NFT')

    const borrowerNftAsset = requireExplicitAsset(borrowerNftTxOut, 'Borrower NFT')
    assertExplicitAmount(borrowerNftTxOut, NFT_AMOUNT, 'Borrower NFT')
    const metadata = await findPendingOfferMetadata(pendingOfferTx)
    const protocolFeeKeeperAssetId = toBytes32(
      AssetId.fromString(NETWORK_CONFIG.protocolFeeAsset.id).toBytes(),
      'protocolFeeKeeperAssetId',
    )
    // TODO: Indexer will handle this
    const derivedLendingParams = buildDerivedLendingOfferProgramParams({
      collateralAssetId: toBytes32(collateralAsset.toBytes(), 'collateralAssetId'),
      principalAssetId: metadata.principalAssetId,
      borrowerNftAssetId: toBytes32(borrowerNftAsset.toBytes(), 'borrowerNftAssetId'),
      lenderNftAssetId: toBytes32(lenderNftAsset.toBytes(), 'lenderNftAssetId'),
      protocolFeeKeeperAssetId,
      offerParameters: {
        collateralAmount: toUint64(collateralAmount, 'collateralAmount'),
        principalAmount: metadata.principalAmount,
        principalInterestRate: metadata.principalInterestRate,
        loanExpirationTime: metadata.loanExpirationTime,
      },
    })
    const lendingProgram = loadLendingProgram(derivedLendingParams)
    // TODO: Probably we will be able to obtain this info from
    // the indexer in the future, so we won't need to reconstruct the spend info on the client side
    const lendingSpendInfo = buildLendingOfferSpendInfo(lendingProgram, {
      principalAmount: metadata.principalAmount,
      principalInterestRate: metadata.principalInterestRate,
    })

    assertScriptMatches(
      pendingOfferTxOut.scriptPubkey(),
      lendingSpendInfo.scriptPubkey,
      'Pending offer output does not match the reconstructed Lending covenant',
    )

    const lendingScriptHash = toBytes32(
      hexToBytes(lendingSpendInfo.scriptPubkey.jet_sha256_hex()),
      'lendingScriptHash',
    )
    const scriptAuthProgram = loadScriptAuthProgram(lendingScriptHash)
    const scriptAuthAddress = buildCovenantSpendInfo(scriptAuthProgram)
    assertScriptMatches(
      lenderNftTxOut.scriptPubkey(),
      scriptAuthAddress.scriptPubkey,
      'Lender NFT output is not locked by this pending offer ScriptAuth covenant',
    )
    const burnScript = Script.opReturn(BURN_PAYLOAD)
    const collateralRecipient = Address.parse(params.collateralRecipientAddress)
    if (feeUtxos.length === 0) throw new Error('At least one fee UTXO is required')

    const spec: TxSpec = {
      inputs: [
        {
          outpoint: pendingOfferOutpoint,
          prevout: pendingOfferTxOut,
          program: {
            program: lendingProgram,
            storage: lendingSpendInfo.storage.map(hexToBytes),
            witness: buildLendingWitness({ branch: 'OfferCancellation' }),
          },
        },
        {
          outpoint: lenderNftOutpoint,
          prevout: lenderNftTxOut,
          program: {
            program: scriptAuthProgram,
            storage: buildCovenantSpendInfo(scriptAuthProgram).storage.map(hexToBytes),
            witness: buildScriptAuthWitness(toUint32(0, 'lendingInputIndex')),
          },
        },
        {
          outpoint: borrowerNftOutpoint,
          prevout: borrowerNftTxOut,
        },
        ...feeUtxos.map((_utxo, index) => ({
          outpoint: feeOutpoints[index],
          prevout: feeTxOuts[index],
          walletCoin: true,
          sequence: index === 0 ? WALLET_INPUT_RBF_SEQUENCE : undefined,
        })),
      ],
      outputs: [
        { script: burnScript, amount: NFT_AMOUNT, asset: lenderNftAsset },
        { script: burnScript, amount: NFT_AMOUNT, asset: borrowerNftAsset },
        {
          script: collateralRecipient.scriptPubkey(),
          amount: collateralAmount,
          asset: collateralAsset,
          blindingPubkey: collateralRecipient.blindingPubkey(),
        },
      ],
    }

    return {
      spec,
      feeRateSatPerKvb: feeRate,
      // TODO: Remove debug summary before release
      summary: {
        inputs: {
          '0 Pending offer Lending': params.pendingOfferOutpoint,
          '1 Lender NFT ScriptAuth': params.lenderNftOutpoint,
          '2 Borrower NFT': params.borrowerNftOutpoint,
          [`3+ Fee ${NETWORK_CONFIG.collateralAsset.symbol} (wallet)`]:
            params.feeOutpoints.join(', '),
        },
        outputs: {
          '0 Lender NFT burn': bytesToHex(burnScript.bytes()),
          '1 Borrower NFT burn': bytesToHex(burnScript.bytes()),
          '2 Unlocked collateral': collateralRecipient.toString(),
        },
        assetIds: {
          collateralAssetId: collateralAsset.toString(),
          principalAssetId: AssetId.fromBytes(metadata.principalAssetId).toString(),
          borrowerNftAssetId: borrowerNftAsset.toString(),
          lenderNftAssetId: lenderNftAsset.toString(),
        },
      },
    }
  }

  return { cancelOffer }
}
