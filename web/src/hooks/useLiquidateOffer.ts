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
import { getTotalAmountToRepay } from '@/simplicity/lending/utils'
import { bytesToHex, hexToBytes } from '@/utils/hex'
import { getProcessingTxids } from '@/utils/pendingTransactions'
import { toBytes32, toUint64 } from '@/utils/uint'
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
const MAX_SEQUENCE_NON_RBF = 0xfffffffe
const BURN_PAYLOAD = new TextEncoder().encode('burn')

export interface LiquidateOfferParams {
  activeOfferOutpoint: string
  createOfferTxid: string
  lenderNftOutpoint: string
  feeOutpoints: string[]
}

export interface LiquidateOfferSummary {
  inputs: Record<string, string>
  outputs: Record<string, string>
  assetIds: Record<string, string>
  offerParameters: Record<string, string>
}

export function useLiquidateOffer() {
  const { chainNetwork: lwkNetwork } = useChain()
  const { getReceiveAddress, getBlindedWalletUtxos, syncWallet } = useWallet()
  const { pendingTxs } = usePendingTransactions()

  const liquidateOffer = async (
    params: LiquidateOfferParams,
  ): Promise<PreparedTransaction<LiquidateOfferSummary>> => {
    const activeOfferOutpoint = new OutPoint(params.activeOfferOutpoint)
    const lenderNftOutpoint = new OutPoint(params.lenderNftOutpoint)
    const feeOutpoints = params.feeOutpoints.map(o => new OutPoint(o))
    assertDistinctOutpoints(
      [activeOfferOutpoint, lenderNftOutpoint, ...feeOutpoints],
      'Liquidation inputs must use distinct outpoints',
    )
    const [receiveAddressString, feeRate] = await Promise.all([
      getReceiveAddress(),
      fetchFeeRateSatPerKvbAbovePending(getProcessingTxids(pendingTxs)),
    ])
    if (!receiveAddressString) throw new Error('Missing receive address')
    const collateralRecipient = Address.parse(receiveAddressString)
    await syncWallet()
    const blindedWalletUtxos = await getBlindedWalletUtxos()
    const feeUtxos = params.feeOutpoints.map(o =>
      requireWalletUtxo(blindedWalletUtxos, o, `Fee ${NETWORK_CONFIG.collateralAsset.symbol}`),
    )
    if (feeUtxos.some(utxo => !isPolicyAssetUtxo(utxo, lwkNetwork.policyAsset()))) {
      throw new Error(`Fee outpoints must be wallet ${NETWORK_CONFIG.collateralAsset.symbol} UTXOs`)
    }
    // TODO: Handle with indexer
    // create-offer tx vout 2 = Borrower NFT (asset id needed for program reconstruction)
    const borrowerNftReferenceOutpoint = new OutPoint(`${params.createOfferTxid}:2`)
    const [activeOfferTx, createOfferTx, borrowerNftTx, lenderNftTx, feeTxs] = await Promise.all([
      fetchTransaction(activeOfferOutpoint),
      fetchTransaction(new OutPoint(`${params.createOfferTxid}:0`)),
      fetchTransaction(borrowerNftReferenceOutpoint),
      fetchTransaction(lenderNftOutpoint),
      Promise.all(feeOutpoints.map(o => fetchTransaction(o))),
    ])
    const activeOfferTxOut = requireTxOut(activeOfferTx, activeOfferOutpoint.vout(), 'Active offer')
    const borrowerNftTxOut = requireTxOut(
      borrowerNftTx,
      borrowerNftReferenceOutpoint.vout(),
      'Borrower NFT reference',
    )
    const lenderNftTxOut = requireTxOut(lenderNftTx, lenderNftOutpoint.vout(), 'Lender NFT')
    const feeTxOuts = feeTxs.map((tx, index) =>
      requireTxOut(tx, feeOutpoints[index].vout(), `Fee ${NETWORK_CONFIG.collateralAsset.symbol}`),
    )

    const collateralAsset = requireExplicitAsset(activeOfferTxOut, 'Active offer')
    const collateralAmount = requireExplicitAmount(activeOfferTxOut, 'Active offer')
    const borrowerNftAsset = requireExplicitAsset(borrowerNftTxOut, 'Borrower NFT reference')
    const lenderNftAsset = requireExplicitAsset(lenderNftTxOut, 'Lender NFT')
    assertExplicitAmount(lenderNftTxOut, NFT_AMOUNT, 'Lender NFT')
    const metadata = await findPendingOfferMetadata(createOfferTx)
    const offerParameters = {
      collateralAmount: toUint64(collateralAmount, 'collateralAmount'),
      principalAmount: metadata.principalAmount,
      principalInterestRate: metadata.principalInterestRate,
      loanExpirationTime: metadata.loanExpirationTime,
    }
    const derivedLendingParams = buildDerivedLendingOfferProgramParams({
      collateralAssetId: toBytes32(collateralAsset.toBytes(), 'collateralAssetId'),
      principalAssetId: metadata.principalAssetId,
      borrowerNftAssetId: toBytes32(borrowerNftAsset.toBytes(), 'borrowerNftAssetId'),
      lenderNftAssetId: toBytes32(lenderNftAsset.toBytes(), 'lenderNftAssetId'),
      protocolFeeKeeperAssetId: toBytes32(
        AssetId.fromString(NETWORK_CONFIG.protocolFeeAsset.id).toBytes(),
        'protocolFeeKeeperAssetId',
      ),
      offerParameters,
    })
    const lendingProgram = loadLendingProgram(derivedLendingParams)
    const activeLendingSpendInfo = buildLendingOfferSpendInfo(lendingProgram, offerParameters, true)

    assertScriptMatches(
      activeOfferTxOut.scriptPubkey(),
      activeLendingSpendInfo.scriptPubkey,
      'Active offer output does not match the reconstructed active Lending covenant',
    )

    const currentDebt = getTotalAmountToRepay(offerParameters)
    const burnScript = Script.opReturn(BURN_PAYLOAD)
    if (params.feeOutpoints.length === 0) throw new Error('At least one fee UTXO is required')

    const spec: TxSpec = {
      inputs: [
        {
          outpoint: activeOfferOutpoint,
          prevout: activeOfferTxOut,
          // Non-final, and the transaction's lock time at the expiry (a unix time): the
          // covenant checks it, and consensus admits it only once the expiry has passed.
          sequence: MAX_SEQUENCE_NON_RBF,
          lockTime: metadata.loanExpirationTime,
          program: {
            program: lendingProgram,
            storage: activeLendingSpendInfo.storage.map(hexToBytes),
            witness: buildLendingWitness({ branch: 'Liquidation', currentDebt }),
          },
        },
        { outpoint: lenderNftOutpoint, prevout: lenderNftTxOut },
        ...feeUtxos.map((_utxo, index) => ({
          outpoint: feeOutpoints[index],
          prevout: feeTxOuts[index],
          walletCoin: true,
          // One RBF-signaling input is enough to make the whole tx replaceable (BIP-125 rule 1).
          sequence: index === 0 ? WALLET_INPUT_RBF_SEQUENCE : undefined,
        })),
      ],
      outputs: [
        { script: burnScript, amount: NFT_AMOUNT, asset: lenderNftAsset },
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
          '0 Active offer Lending': params.activeOfferOutpoint,
          '1 Lender NFT (wallet)': params.lenderNftOutpoint,
          [`2+ Fee ${NETWORK_CONFIG.collateralAsset.symbol} (wallet)`]:
            params.feeOutpoints.join(', '),
          'Create-offer tx (metadata)': params.createOfferTxid,
        },
        outputs: {
          '0 Lender NFT burn': bytesToHex(burnScript.bytes()),
          '1 Unlocked collateral': collateralRecipient.toString(),
          [`${NETWORK_CONFIG.collateralAsset.symbol} change`]: collateralRecipient.toString(),
        },
        assetIds: {
          collateralAssetId: collateralAsset.toString(),
          principalAssetId: AssetId.fromBytes(metadata.principalAssetId).toString(),
          borrowerNftAssetId: borrowerNftAsset.toString(),
          lenderNftAssetId: lenderNftAsset.toString(),
        },
        offerParameters: {
          collateralAmount: collateralAmount.toString(),
          principalAmount: metadata.principalAmount.toString(),
          principalInterestRate: metadata.principalInterestRate.toString(),
          loanExpirationTime: metadata.loanExpirationTime.toString(),
          currentDebt: currentDebt.toString(),
        },
      },
    }
  }

  return { liquidateOffer }
}
