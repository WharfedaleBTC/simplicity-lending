import {
  type DefinedUseQueryResult,
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
  useQueries,
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query'

import type { ApiError } from '../errors'
import { GC_TIME_MS, STALE_TIME_MS } from '../staleTime'
import {
  broadcastTx,
  fetchAddressInfo,
  fetchAddressTxs,
  fetchAddressUtxo,
  fetchBlockHashAtHeight,
  fetchBlockTimestamp,
  fetchTx,
  fetchTxOutspends,
} from './methods'
import { esploraQueryKeys } from './queryKeys'
import type {
  AddressInfo,
  EsploraOutspend,
  EsploraTx,
  ScriptHashTxEntry,
  ScriptHashUtxoEntry,
} from './schemas'

const DEFAULT_CLOCK_TICK_MS = 10_000

export function useTx(txId: string): UseQueryResult<EsploraTx> {
  return useQuery({
    queryKey: esploraQueryKeys.tx(txId),
    queryFn: ({ signal }) => fetchTx(txId, { signal }),
    staleTime: STALE_TIME_MS.long,
    gcTime: GC_TIME_MS.long,
    enabled: !!txId,
  })
}

export function useTxOutspends(txId: string): UseQueryResult<EsploraOutspend[]> {
  return useQuery({
    queryKey: esploraQueryKeys.txOutspends(txId),
    queryFn: ({ signal }) => fetchTxOutspends(txId, { signal }),
    staleTime: STALE_TIME_MS.short,
    enabled: !!txId,
  })
}

export function useAddressInfo(address: string): UseQueryResult<AddressInfo> {
  return useQuery({
    queryKey: esploraQueryKeys.addressInfo(address),
    queryFn: ({ signal }) => fetchAddressInfo(address, { signal }),
    staleTime: STALE_TIME_MS.short,
    enabled: !!address,
  })
}

export function useAddressUtxos(address: string): UseQueryResult<ScriptHashUtxoEntry[]> {
  return useQuery({
    queryKey: esploraQueryKeys.addressUtxo(address),
    queryFn: ({ signal }) => fetchAddressUtxo(address, { signal }),
    staleTime: STALE_TIME_MS.realtime,
    enabled: !!address,
  })
}

export function useAddressTxs(
  address: string,
  lastSeenTxId?: string,
): UseQueryResult<ScriptHashTxEntry[]> {
  return useQuery({
    queryKey: esploraQueryKeys.addressTxs(address, lastSeenTxId),
    queryFn: ({ signal }) => fetchAddressTxs(address, lastSeenTxId, { signal }),
    staleTime: STALE_TIME_MS.short,
    enabled: !!address,
  })
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

/**
 * The time loans expire against: now, in unix seconds. A Wharfedale block made now carries at
 * least this timestamp, and time locks are checked against the block's own timestamp.
 */
export function useChainTime(
  refetchIntervalMs: number = DEFAULT_CLOCK_TICK_MS,
): DefinedUseQueryResult<number> {
  return useQuery({
    queryKey: esploraQueryKeys.chainTime,
    queryFn: async () => nowSeconds(),
    refetchInterval: refetchIntervalMs,
    initialData: nowSeconds,
  })
}

/** Timestamps of blocks by height (immutable once known). */
export function useBlockTimestamps(heights: number[]): Record<number, number> {
  const unique = [...new Set(heights)]
  const results = useQueries({
    queries: unique.map(height => ({
      queryKey: esploraQueryKeys.blockTimestamp(height),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchBlockTimestamp(height, { signal }),
      staleTime: STALE_TIME_MS.immutable,
      gcTime: GC_TIME_MS.immutable,
    })),
  })
  const out: Record<number, number> = {}
  unique.forEach((height, i) => {
    const t = results[i]?.data
    if (t !== undefined) out[height] = t
  })
  return out
}

export function useBlockHashAtHeight(blockHeight: number): UseQueryResult<string> {
  return useQuery({
    queryKey: esploraQueryKeys.blockHash(blockHeight),
    queryFn: ({ signal }) => fetchBlockHashAtHeight(blockHeight, { signal }),
    staleTime: STALE_TIME_MS.immutable,
    gcTime: GC_TIME_MS.immutable,
  })
}

export interface BroadcastTxVariables {
  txHex: string
  signal?: AbortSignal
}

export type UseBroadcastTxOptions = Omit<
  UseMutationOptions<string, ApiError, BroadcastTxVariables>,
  'mutationFn'
>

export function useBroadcastTx(
  options: UseBroadcastTxOptions = {},
): UseMutationResult<string, ApiError, BroadcastTxVariables> {
  return useMutation({
    ...options,
    mutationFn: ({ txHex, signal }: BroadcastTxVariables) => broadcastTx(txHex, { signal }),
  })
}
