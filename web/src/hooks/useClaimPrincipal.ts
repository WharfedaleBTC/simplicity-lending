import { fetchFeeRateSatPerKvbAbovePending } from '@/api/esplora/fee'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useChain } from '@/providers/chain/useChain'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { buildAssetAuthWitness, loadAssetAuthProgram } from '@/simplicity/asset-auth/program'
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
import { Address, OutPoint } from '@/wharfedale/types'
import { isPolicyAssetUtxo, requireWalletUtxo, WALLET_INPUT_RBF_SEQUENCE } from '@/wharfedale/utxo'

const NFT_AMOUNT = 1n

const BORROWER_NFT_INPUT_INDEX = 1
const BORROWER_NFT_OUTPUT_INDEX = 0

export interface ClaimPrincipalParams {
  principalOutpoint: string
  borrowerNftOutpoint: string
  feeOutpoints: string[]
  borrowerNftRecipientAddress?: string
  principalRecipientAddress?: string
}

export interface ClaimPrincipalSummary {
  inputs: Record<string, string>
  outputs: Record<string, string>
  assetIds: Record<string, string>
  amounts: Record<string, string>
  scripts: Record<string, string>
}

export function useClaimPrincipal() {
  const { chainNetwork: lwkNetwork } = useChain()
  const { getReceiveAddress, getBlindedWalletUtxos, syncWallet } = useWallet()
  const { pendingTxs } = usePendingTransactions()

  const claimPrincipal = async (
    params: ClaimPrincipalParams,
  ): Promise<PreparedTransaction<ClaimPrincipalSummary>> => {
    const principalOutpoint = new OutPoint(params.principalOutpoint)
    const borrowerNftOutpoint = new OutPoint(params.borrowerNftOutpoint)
    const feeOutpoints = params.feeOutpoints.map(o => new OutPoint(o))
    assertDistinctOutpoints(
      [principalOutpoint, borrowerNftOutpoint, ...feeOutpoints],
      'Claim principal inputs must use distinct outpoints',
    )
    const receiveAddressString = await getReceiveAddress()
    if (!receiveAddressString) throw new Error('Missing wallet receive address')
    const borrowerNftRecipient = Address.parse(
      params.borrowerNftRecipientAddress?.trim() || receiveAddressString,
    )
    const principalRecipient = Address.parse(
      params.principalRecipientAddress?.trim() || receiveAddressString,
    )
    await syncWallet()
    const blindedWalletUtxos = await getBlindedWalletUtxos()
    const feeUtxos = params.feeOutpoints.map(o =>
      requireWalletUtxo(blindedWalletUtxos, o, `Fee ${NETWORK_CONFIG.collateralAsset.symbol}`),
    )
    if (feeUtxos.some(utxo => !isPolicyAssetUtxo(utxo, lwkNetwork.policyAsset()))) {
      throw new Error(`Fee outpoints must be wallet ${NETWORK_CONFIG.collateralAsset.symbol} UTXOs`)
    }
    const [principalTx, borrowerNftTx, feeTxs, feeRate] = await Promise.all([
      fetchTransaction(principalOutpoint),
      fetchTransaction(borrowerNftOutpoint),
      Promise.all(feeOutpoints.map(o => fetchTransaction(o))),
      fetchFeeRateSatPerKvbAbovePending(getProcessingTxids(pendingTxs)),
    ])

    const principalTxOut = requireTxOut(principalTx, principalOutpoint.vout(), 'Principal')
    const borrowerNftTxOut = requireTxOut(borrowerNftTx, borrowerNftOutpoint.vout(), 'Borrower NFT')
    const feeTxOuts = feeTxs.map((tx, index) =>
      requireTxOut(tx, feeOutpoints[index].vout(), `Fee ${NETWORK_CONFIG.collateralAsset.symbol}`),
    )

    const principalAsset = requireExplicitAsset(principalTxOut, 'Principal')
    const principalAmount = requireExplicitAmount(principalTxOut, 'Principal')
    const borrowerNftAsset = requireExplicitAsset(borrowerNftTxOut, 'Borrower NFT')
    assertExplicitAmount(borrowerNftTxOut, NFT_AMOUNT, 'Borrower NFT')
    const assetAuthProgram = loadAssetAuthProgram({
      assetId: toBytes32(borrowerNftAsset.toBytes(), 'borrowerNftAssetId'),
      assetAmount: toUint64(NFT_AMOUNT, 'borrowerNftAmount'),
      withAssetBurn: false,
    })
    const assetAuthSpendInfo = buildCovenantSpendInfo(assetAuthProgram)

    assertScriptMatches(
      principalTxOut.scriptPubkey(),
      assetAuthSpendInfo.scriptPubkey,
      'Principal UTXO does not match the reconstructed borrower AssetAuth covenant',
    )
    if (feeUtxos.length === 0) throw new Error('At least one fee UTXO is required')

    const spec: TxSpec = {
      inputs: [
        {
          outpoint: principalOutpoint,
          prevout: principalTxOut,
          program: {
            program: assetAuthProgram,
            storage: assetAuthSpendInfo.storage.map(hexToBytes),
            witness: buildAssetAuthWitness({
              inputAssetIndex: toUint32(BORROWER_NFT_INPUT_INDEX, 'borrowerNftInputIndex'),
              outputAssetIndex: toUint32(BORROWER_NFT_OUTPUT_INDEX, 'borrowerNftOutputIndex'),
            }),
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
        {
          script: borrowerNftRecipient.scriptPubkey(),
          amount: NFT_AMOUNT,
          asset: borrowerNftAsset,
        },
        {
          script: principalRecipient.scriptPubkey(),
          amount: principalAmount,
          asset: principalAsset,
          blindingPubkey: principalRecipient.blindingPubkey(),
        },
      ],
    }

    return {
      spec,
      feeRateSatPerKvb: feeRate,
      // TODO: Remove debug summary before release
      summary: {
        inputs: {
          '0 Principal AssetAuth': params.principalOutpoint,
          '1 Borrower NFT (wallet)': params.borrowerNftOutpoint,
          [`2+ Fee ${NETWORK_CONFIG.collateralAsset.symbol} (wallet)`]:
            params.feeOutpoints.join(', '),
        },
        outputs: {
          '0 Borrower NFT to recipient': borrowerNftRecipient.toString(),
          '1 Unlocked principal to recipient': principalRecipient.toString(),
          [`${NETWORK_CONFIG.collateralAsset.symbol} change`]: 'Managed by LWK',
        },
        assetIds: {
          principalAssetId: principalAsset.toString(),
          borrowerNftAssetId: borrowerNftAsset.toString(),
        },
        amounts: {
          principalAmount: principalAmount.toString(),
          borrowerNftAmount: NFT_AMOUNT.toString(),
        },
        scripts: {
          assetAuthScript: bytesToHex(assetAuthSpendInfo.scriptPubkey.bytes()),
          borrowerNftRecipientScript: bytesToHex(borrowerNftRecipient.scriptPubkey().bytes()),
        },
      },
    }
  }

  return { claimPrincipal }
}
