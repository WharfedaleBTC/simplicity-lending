import { useQuery } from '@tanstack/react-query'

import { fetchTxConfirmations } from '@/api/esplora/methods'

/**
 * How often a broadcast transaction's status is checked. Wharfedale makes a block within about
 * a second of a transaction, so a confirmation shows up on the next check.
 */
export const TX_STATUS_POLL_MS = 3_000

export type TxStatus = 'processing' | 'confirmed' | 'finalized'

export interface TxStatusSnapshot {
  status: TxStatus
  confirmations: number | null
}

/** One cache entry per transaction, shared by the transaction dialogs and pending-tx tracking. */
export function txStatusQueryKey(txid: string) {
  return ['tx-status', txid] as const
}

/**
 * Wharfedale blocks are final once committed (Malachite BFT): one confirmation is final. A
 * second one may never come, as the chain makes no blocks while idle.
 */
export async function fetchTxStatusSnapshot(
  txid: string,
  signal?: AbortSignal,
): Promise<TxStatusSnapshot> {
  const confirmations = await fetchTxConfirmations(txid, { signal })
  return confirmations === null
    ? { status: 'processing', confirmations }
    : { status: 'finalized', confirmations }
}

export function useTxStatus(
  txid?: string | null,
  pollIntervalMs = TX_STATUS_POLL_MS,
): { status: TxStatus | null; confirmations: number | null; isComplete: boolean } {
  const { data } = useQuery<TxStatusSnapshot>({
    queryKey: txStatusQueryKey(txid ?? ''),
    enabled: Boolean(txid),
    refetchInterval: query => (query.state.data?.status === 'finalized' ? false : pollIntervalMs),
    queryFn: ({ signal }) => fetchTxStatusSnapshot(txid as string, signal),
  })

  const status = data?.status ?? null
  const confirmations = data?.confirmations ?? null
  const isComplete = status === 'confirmed' || status === 'finalized'
  return { status, confirmations, isComplete }
}
