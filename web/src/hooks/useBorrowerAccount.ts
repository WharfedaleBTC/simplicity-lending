import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import { fetchFeeRateSatPerKvbAbovePending } from '@/api/esplora/fee'
import { useFactories } from '@/api/indexer/hooks'
import { factoryQueryKeys } from '@/api/indexer/queryKeys'
import type { FactoryDetails } from '@/api/indexer/schemas'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useChain } from '@/providers/chain/useChain'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { loadIssuanceFactoryProgram } from '@/simplicity/issuance-factory/program'
import { buildCovenantSpendInfo } from '@/simplicity/taproot'
import { formatFeeReserve } from '@/utils/format'
import { bytesToHex } from '@/utils/hex'
import { getProcessingTxids } from '@/utils/pendingTransactions'
import { sha256 } from '@/utils/sha256'
import { toUint8, toUint64 } from '@/utils/uint'
import {
  assetIdFromIssuance,
  AssetKind,
  buildAssetContract,
  type ContractHash,
  contractHashOrEmpty,
} from '@/wharfedale/assetContract'
import {
  fetchTransaction,
  type PreparedTransaction,
  requireTxOut,
  type TxSpec,
} from '@/wharfedale/tx'
import { Address, AssetId, OutPoint, Script } from '@/wharfedale/types'
import {
  isConfirmedWalletUtxo,
  isPolicyAssetUtxo,
  utxoToOutpointString,
  WALLET_INPUT_RBF_SEQUENCE,
} from '@/wharfedale/utxo'

export interface FactoryState {
  factoryAssetId: string
  factoryAuthOutpoint: string
  issuanceFactoryOutpoint: string
}

function prepareFactory(factory: FactoryDetails): FactoryState | null {
  if (!factory.auth_utxo || !factory.program_utxo) return null
  return {
    factoryAssetId: factory.factory_asset_id,
    factoryAuthOutpoint: `${factory.auth_utxo.txid}:${factory.auth_utxo.vout}`,
    issuanceFactoryOutpoint: `${factory.program_utxo.txid}:${factory.program_utxo.vout}`,
  }
}

const BORROWER_ACCOUNT_FEE_RESERVE_SATS = 250n
const ISSUING_UTXOS_COUNT = 2
const REISSUANCE_FLAGS = 0n
const ISSUANCE_AMOUNT = 2n
const REISSUANCE_TOKEN_AMOUNT = 0n
const FACTORY_AUTH_AMOUNT = 1n
const ISSUANCE_FACTORY_AMOUNT = 1n

export interface BorrowerAccountCreationSummary {
  fundingOutpoint: string
  factoryAddress: string
  factoryAuthOutpoint: string
  issuanceFactoryOutpoint: string
  issuedAssetId: string
  metadataOpReturnHex: string
}

export function useBorrowerAccount() {
  const { chainNetwork: lwkNetwork } = useChain()
  const { getReceiveAddress, getBlindedWalletUtxos, scriptPubkey } = useWallet()
  const { pendingTxs } = usePendingTransactions()
  const queryClient = useQueryClient()
  const factoriesQuery = useFactories(scriptPubkey || '')
  const activeFactory = factoriesQuery.data?.[0] ?? null
  const hasAccount = !!activeFactory

  const factoryState = useMemo(
    () => (activeFactory ? prepareFactory(activeFactory) : null),
    [activeFactory],
  )

  const refetchFactory = useCallback((): void => {
    if (!scriptPubkey) return
    queryClient.invalidateQueries({ queryKey: factoryQueryKeys.byScript(scriptPubkey) })
  }, [scriptPubkey, queryClient])

  const createBorrowerAccount = async (): Promise<
    PreparedTransaction<BorrowerAccountCreationSummary>
  > => {
    const receiveAddressString = await getReceiveAddress()
    if (!receiveAddressString) throw new Error('Missing receive address')

    const policyAsset = lwkNetwork.policyAsset()
    const blindedWalletUtxos = await getBlindedWalletUtxos()

    const feeUtxo = blindedWalletUtxos
      .filter(utxo => isConfirmedWalletUtxo(utxo) && isPolicyAssetUtxo(utxo, policyAsset))
      .filter(utxo => utxo.unblinded().value() > BORROWER_ACCOUNT_FEE_RESERVE_SATS)
      .sort((a, b) => Number(a.unblinded().value() - b.unblinded().value()))[0]

    if (!feeUtxo) {
      throw new Error(
        `Need a confirmed wallet ${NETWORK_CONFIG.collateralAsset.symbol} UTXO larger than ${formatFeeReserve(BORROWER_ACCOUNT_FEE_RESERVE_SATS)} to cover the borrower account fee reserve.`,
      )
    }

    const fundingOutpoint = utxoToOutpointString(feeUtxo)
    const [feeRate, feeTx] = await Promise.all([
      fetchFeeRateSatPerKvbAbovePending(getProcessingTxids(pendingTxs)),
      fetchTransaction(feeUtxo.outpoint()),
    ])
    const feeTxOut = requireTxOut(feeTx, feeUtxo.outpoint().vout(), 'Funding')
    const receiveAddress = Address.parse(receiveAddressString).toUnconfidential()
    const issuanceFactoryProgram = loadIssuanceFactoryProgram({
      issuingUtxosCount: toUint8(ISSUING_UTXOS_COUNT, 'issuingUtxosCount'),
      reissuanceFlags: toUint64(REISSUANCE_FLAGS, 'reissuanceFlags'),
    })
    const factoryAddress = buildCovenantSpendInfo(issuanceFactoryProgram)
    const { contractHash, issuedAssetId, metadata } = await prepareIssuance(feeUtxo.outpoint())

    const spec: TxSpec = {
      inputs: [
        {
          outpoint: feeUtxo.outpoint(),
          prevout: feeTxOut,
          walletCoin: true,
          sequence: WALLET_INPUT_RBF_SEQUENCE,
          issuance: {
            assetAmount: ISSUANCE_AMOUNT,
            tokenAmount: REISSUANCE_TOKEN_AMOUNT,
            contractHash,
          },
        },
      ],
      outputs: [
        {
          script: receiveAddress.scriptPubkey(),
          amount: FACTORY_AUTH_AMOUNT,
          asset: issuedAssetId,
        },
        {
          script: factoryAddress.scriptPubkey,
          amount: ISSUANCE_FACTORY_AMOUNT,
          asset: issuedAssetId,
        },
        { script: Script.opReturn(metadata), amount: 0n, asset: policyAsset },
      ],
    }

    return {
      spec,
      feeRateSatPerKvb: feeRate,
      // TODO: Remove debug summary before release
      summary: (txid: string) => ({
        fundingOutpoint,
        factoryAddress: factoryAddress.address,
        factoryAuthOutpoint: `${txid}:0`,
        issuanceFactoryOutpoint: `${txid}:1`,
        issuedAssetId: issuedAssetId.toString(),
        metadataOpReturnHex: bytesToHex(Script.opReturn(metadata).bytes()),
      }),
    }
  }

  const removeBorrowerAccount = async (): Promise<void> => {
    throw new Error(
      'Remove is scaffolded but not wired: the wallet connector must expose Schnorr signing for IssuanceFactory sig_all_hash.',
    )
  }

  return {
    createBorrowerAccount,
    factoryState,
    refetchFactory,
    hasAccount,
    removeBorrowerAccount,
    scriptPubkey,
  }
}

async function prepareIssuance(fundingOutpoint: OutPoint): Promise<{
  contractHash: ContractHash
  issuedAssetId: AssetId
  metadata: Uint8Array
}> {
  const contract = buildAssetContract(fundingOutpoint, AssetKind.Factory)
  const contractHash = await contractHashOrEmpty(contract)
  return {
    contractHash,
    issuedAssetId: assetIdFromIssuance(fundingOutpoint, contractHash),
    metadata: await buildMetadata(),
  }
}

async function buildMetadata(): Promise<Uint8Array> {
  const { sources } = await import('virtual:simplicity-sources')
  const hash = await sha256(new TextEncoder().encode(sources.issuance_factory))
  const programId = new Uint8Array(hash).slice(0, 4)
  const data = new Uint8Array(13)
  data.set(programId, 0)
  data[4] = ISSUING_UTXOS_COUNT
  new DataView(data.buffer).setBigUint64(5, REISSUANCE_FLAGS, true)
  return data
}
