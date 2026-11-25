import { fetchFeeRateSatPerKvbAbovePending } from '@/api/esplora/fee'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { BPS_DIVISOR } from '@/constants/offers'
import { useChain } from '@/providers/chain/useChain'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { loadAssetAuthVaultProgram } from '@/simplicity/asset-auth-vault/program'
import { findPendingOfferMetadata } from '@/simplicity/lending/metadata'
import {
  buildDerivedLendingOfferProgramParams,
  buildLendingOfferSpendInfo,
  buildLendingWitness,
  loadLendingProgram,
} from '@/simplicity/lending/program'
import { getTotalAmountToRepay } from '@/simplicity/lending/utils'
import { buildCovenantSpendInfo } from '@/simplicity/taproot'
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
const BURN_PAYLOAD = new TextEncoder().encode('burn')

// 10% of the total fee goes to the protocol, matching PROTOCOL_FEE_PERCENTAGE in Rust.
// Check crates/contracts/src/programs/lending/offer.rs)
const PROTOCOL_FEE_BPS = 1_000n

function getTotalProtocolFee(totalFee: bigint): bigint {
  return (totalFee * PROTOCOL_FEE_BPS) / BPS_DIVISOR
}

export interface RepayOfferParams {
  activeOfferOutpoint: string
  borrowerNftOutpoint: string
  principalOutpoints: string[]
  feeOutpoints: string[]
  collateralRecipientAddress?: string
}

export interface RepayOfferSummary {
  inputs: Record<string, string>
  outputs: Record<string, string>
  assetIds: Record<string, string>
  amounts: Record<string, string>
}

export function useRepayOffer() {
  const { chainNetwork: lwkNetwork } = useChain()
  const { getReceiveAddress, getChangeAddress, getBlindedWalletUtxos, syncWallet } = useWallet()
  const { pendingTxs } = usePendingTransactions()

  const repayOffer = async (
    params: RepayOfferParams,
  ): Promise<PreparedTransaction<RepayOfferSummary>> => {
    const activeOfferOutpoint = new OutPoint(params.activeOfferOutpoint)
    const borrowerNftOutpoint = new OutPoint(params.borrowerNftOutpoint)
    const principalOutpoints = params.principalOutpoints.map(o => new OutPoint(o))
    const feeOutpoints = params.feeOutpoints.map(o => new OutPoint(o))
    assertDistinctOutpoints(
      [activeOfferOutpoint, borrowerNftOutpoint, ...principalOutpoints, ...feeOutpoints],
      'Repayment inputs must use distinct outpoints',
    )
    const receiveAddressString = await getReceiveAddress()
    if (!receiveAddressString) throw new Error('Missing wallet receive address')
    const collateralRecipient = Address.parse(
      params.collateralRecipientAddress?.trim() || receiveAddressString,
    )
    await syncWallet()
    const blindedWalletUtxos = await getBlindedWalletUtxos()
    const feeUtxos = params.feeOutpoints.map(o =>
      requireWalletUtxo(blindedWalletUtxos, o, `Fee ${NETWORK_CONFIG.collateralAsset.symbol}`),
    )
    if (feeUtxos.some(utxo => !isPolicyAssetUtxo(utxo, lwkNetwork.policyAsset()))) {
      throw new Error(`Fee outpoints must be wallet ${NETWORK_CONFIG.collateralAsset.symbol} UTXOs`)
    }
    const principalWalletUtxos = params.principalOutpoints.map(o =>
      requireWalletUtxo(blindedWalletUtxos, o, 'Principal'),
    )
    const [activeOfferTx, borrowerNftTx] = await Promise.all([
      fetchTransaction(activeOfferOutpoint),
      fetchTransaction(borrowerNftOutpoint),
    ])
    const pendingOfferOutpoint = activeOfferTx.inputs[0].outpoint()
    const [pendingOfferTx, principalTxs, feeTxs, feeRate] = await Promise.all([
      fetchTransaction(pendingOfferOutpoint),
      Promise.all(principalOutpoints.map(o => fetchTransaction(o))),
      Promise.all(feeOutpoints.map(o => fetchTransaction(o))),
      fetchFeeRateSatPerKvbAbovePending(getProcessingTxids(pendingTxs)),
    ])
    const activeOfferTxOut = requireTxOut(activeOfferTx, activeOfferOutpoint.vout(), 'Active offer')
    const borrowerNftTxOut = requireTxOut(borrowerNftTx, borrowerNftOutpoint.vout(), 'Borrower NFT')
    const lenderNftTxOut = requireTxOut(activeOfferTx, 2, 'Lender NFT reference')
    const principalTxOuts = principalTxs.map((tx, index) =>
      requireTxOut(tx, principalOutpoints[index].vout(), 'Principal'),
    )
    const feeTxOuts = feeTxs.map((tx, index) =>
      requireTxOut(tx, feeOutpoints[index].vout(), `Fee ${NETWORK_CONFIG.collateralAsset.symbol}`),
    )

    const collateralAsset = requireExplicitAsset(activeOfferTxOut, 'Active offer')
    const collateralAmount = requireExplicitAmount(activeOfferTxOut, 'Active offer')
    const borrowerNftAsset = requireExplicitAsset(borrowerNftTxOut, 'Borrower NFT')
    const lenderNftAsset = requireExplicitAsset(lenderNftTxOut, 'Lender NFT reference')
    assertExplicitAmount(borrowerNftTxOut, NFT_AMOUNT, 'Borrower NFT')
    const metadata = await findPendingOfferMetadata(pendingOfferTx)
    const principalAsset = AssetId.fromBytes(metadata.principalAssetId)
    const offerParameters = {
      collateralAmount: toUint64(collateralAmount, 'collateralAmount'),
      principalAmount: metadata.principalAmount,
      principalInterestRate: metadata.principalInterestRate,
      loanExpirationTime: metadata.loanExpirationTime,
    }
    const totalAmountToRepay = getTotalAmountToRepay(offerParameters)
    for (const principalWalletUtxo of principalWalletUtxos) {
      const actualAssetId = principalWalletUtxo.unblinded().asset().toString()
      if (actualAssetId !== principalAsset.toString()) {
        throw new Error(`Principal UTXO has unexpected asset ${actualAssetId}`)
      }
    }
    const principalInputAmount = principalWalletUtxos.reduce(
      (sum, utxo) => sum + utxo.unblinded().value(),
      0n,
    )
    if (principalInputAmount < totalAmountToRepay) {
      throw new Error(`Principal UTXO amount is lower than ${totalAmountToRepay.toString()}`)
    }
    const principalChangeAmount = principalInputAmount - totalAmountToRepay
    const protocolFeeKeeperAssetId = toBytes32(
      AssetId.fromString(NETWORK_CONFIG.protocolFeeAsset.id).toBytes(),
      'protocolFeeKeeperAssetId',
    )
    const derivedLendingParams = buildDerivedLendingOfferProgramParams({
      collateralAssetId: toBytes32(collateralAsset.toBytes(), 'collateralAssetId'),
      principalAssetId: metadata.principalAssetId,
      borrowerNftAssetId: toBytes32(borrowerNftAsset.toBytes(), 'borrowerNftAssetId'),
      lenderNftAssetId: toBytes32(lenderNftAsset.toBytes(), 'lenderNftAssetId'),
      protocolFeeKeeperAssetId,
      offerParameters,
    })
    const lendingProgram = loadLendingProgram(derivedLendingParams)
    const activeLendingSpendInfo = buildLendingOfferSpendInfo(lendingProgram, offerParameters, true)

    assertScriptMatches(
      activeOfferTxOut.scriptPubkey(),
      activeLendingSpendInfo.scriptPubkey,
      'Active offer output does not match the reconstructed active Lending covenant',
    )

    const finalizedLenderVaultProgram = loadAssetAuthVaultProgram({
      vaultAssetId: derivedLendingParams.principalAssetId,
      keeperAuthAssetId: derivedLendingParams.lenderNftAssetId,
      keeperAuthAssetAmount: toUint64(1n),
      withKeeperAssetBurn: true,
      supplierAuthAssetId: derivedLendingParams.borrowerNftAssetId,
      withSupplierAssetBurn: true,
      finalizedVaultCovHash: toBytes32(new Uint8Array(32)),
      isActive: false,
    })
    const finalizedProtocolFeeVaultProgram = loadAssetAuthVaultProgram({
      vaultAssetId: derivedLendingParams.principalAssetId,
      keeperAuthAssetId: protocolFeeKeeperAssetId,
      keeperAuthAssetAmount: toUint64(1n),
      withKeeperAssetBurn: false,
      supplierAuthAssetId: derivedLendingParams.borrowerNftAssetId,
      withSupplierAssetBurn: true,
      finalizedVaultCovHash: toBytes32(new Uint8Array(32)),
      isActive: false,
    })
    const finalizedLenderVaultSpendInfo = buildCovenantSpendInfo(finalizedLenderVaultProgram)
    const finalizedProtocolFeeVaultSpendInfo = buildCovenantSpendInfo(
      finalizedProtocolFeeVaultProgram,
    )
    const totalFee = totalAmountToRepay - metadata.principalAmount
    const totalProtocolFee = getTotalProtocolFee(totalFee)
    const lenderVaultAmount = totalAmountToRepay - totalProtocolFee
    const burnScript = Script.opReturn(BURN_PAYLOAD)
    if (principalWalletUtxos.length + feeUtxos.length === 0) {
      throw new Error('At least one wallet UTXO is required')
    }
    const walletInputs = [
      ...principalWalletUtxos.map((utxo, index) => ({
        utxo,
        outpoint: principalOutpoints[index],
        prevout: principalTxOuts[index],
      })),
      ...feeUtxos.map((utxo, index) => ({
        utxo,
        outpoint: feeOutpoints[index],
        prevout: feeTxOuts[index],
      })),
    ]

    const changeAddress = await getChangeAddress()
    const spec: TxSpec = {
      inputs: [
        {
          outpoint: borrowerNftOutpoint,
          prevout: borrowerNftTxOut,
        },
        {
          outpoint: activeOfferOutpoint,
          prevout: activeOfferTxOut,
          program: {
            program: lendingProgram,
            storage: activeLendingSpendInfo.storage.map(hexToBytes),
            witness: buildLendingWitness({
              branch: 'FullRepayment',
              currentDebt: totalAmountToRepay,
            }),
          },
        },
        ...walletInputs.map(({ outpoint, prevout }, index) => ({
          outpoint,
          prevout,
          walletCoin: true,
          sequence: index === 0 ? WALLET_INPUT_RBF_SEQUENCE : undefined,
        })),
      ],
      outputs: [
        { script: burnScript, amount: NFT_AMOUNT, asset: borrowerNftAsset },
        {
          script: finalizedLenderVaultSpendInfo.scriptPubkey,
          amount: lenderVaultAmount,
          asset: principalAsset,
        },
        {
          script: finalizedProtocolFeeVaultSpendInfo.scriptPubkey,
          amount: totalProtocolFee,
          asset: principalAsset,
        },
        {
          script: collateralRecipient.scriptPubkey(),
          amount: collateralAmount,
          asset: collateralAsset,
          blindingPubkey: collateralRecipient.blindingPubkey(),
        },
        ...(principalChangeAmount > 0n
          ? [
              {
                script: changeAddress.scriptPubkey(),
                amount: principalChangeAmount,
                asset: principalAsset,
                blindingPubkey: changeAddress.blindingPubkey(),
              },
            ]
          : []),
      ],
    }

    return {
      spec,
      feeRateSatPerKvb: feeRate,
      // TODO: Remove debug summary before release
      summary: {
        inputs: {
          '0 Borrower NFT': params.borrowerNftOutpoint,
          '1 Active offer Lending': params.activeOfferOutpoint,
          '2+ Principal wallet UTXO(s)': params.principalOutpoints.join(', '),
          [`Fee ${NETWORK_CONFIG.collateralAsset.symbol} (wallet)`]: params.feeOutpoints.join(', '),
        },
        outputs: {
          '0 Borrower NFT burn': bytesToHex(burnScript.bytes()),
          '1 Finalized lender vault': bytesToHex(
            finalizedLenderVaultSpendInfo.scriptPubkey.bytes(),
          ),
          '2 Finalized protocol fee vault': bytesToHex(
            finalizedProtocolFeeVaultSpendInfo.scriptPubkey.bytes(),
          ),
          '3 Unlocked collateral': collateralRecipient.toString(),
          'Principal change':
            principalChangeAmount > 0n
              ? `${principalChangeAmount.toString()} to ${changeAddress.toString()}`
              : 'None',
          [`${NETWORK_CONFIG.collateralAsset.symbol} change`]:
            'Managed by LWK after covenant outputs',
        },
        assetIds: {
          collateralAssetId: collateralAsset.toString(),
          principalAssetId: principalAsset.toString(),
          borrowerNftAssetId: borrowerNftAsset.toString(),
          lenderNftAssetId: lenderNftAsset.toString(),
        },
        amounts: {
          collateralAmount: collateralAmount.toString(),
          totalAmountToRepay: totalAmountToRepay.toString(),
          totalFee: totalFee.toString(),
          totalProtocolFee: totalProtocolFee.toString(),
          lenderVaultAmount: lenderVaultAmount.toString(),
          principalInputAmount: principalInputAmount.toString(),
          principalChangeAmount: principalChangeAmount.toString(),
        },
      },
    }
  }

  return { repayOffer }
}
