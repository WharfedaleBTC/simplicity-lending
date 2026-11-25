import { useCallback } from 'react'

import { broadcastTx } from '@/api/esplora/methods'
import { getStandardTransactionSteps } from '@/components/TransactionStepper/transactionSteps'
import { useTxProgress } from '@/providers/txProgress/useTxProgress'
import { useWallet } from '@/providers/wallet/useWallet'
import type { PreparedTransaction } from '@/wharfedale/tx'

export interface TransactionFlowResult<TSummary> {
  txid: string
  summary: TSummary
}

type RunStandardTransactionFlow = <TSummary>(
  build: () => Promise<PreparedTransaction<TSummary>>,
) => Promise<TransactionFlowResult<TSummary>>

export function useStandardTransactionFlow(): RunStandardTransactionFlow {
  const { completeTransaction, signerType, applyBroadcastTransaction } = useWallet()
  const { startTxProgress, setTxProgressError } = useTxProgress()

  return useCallback<RunStandardTransactionFlow>(
    async <TSummary>(build: () => Promise<PreparedTransaction<TSummary>>) => {
      try {
        const advance = startTxProgress(getStandardTransactionSteps(signerType))
        const { spec, summary, feeRateSatPerKvb } = await build()

        // Funding, blinding, signing and the covenant witnesses happen in one step here.
        await advance('signing')
        const { tx } = await completeTransaction(spec, feeRateSatPerKvb)

        await advance('finalizing')
        await advance('broadcasting')
        const txid = await broadcastTx(tx.toString())

        applyBroadcastTransaction(tx)

        return {
          txid,
          summary:
            typeof summary === 'function' ? (summary as (txid: string) => TSummary)(txid) : summary,
        }
      } catch (error) {
        setTxProgressError(error)
        throw error
      }
    },
    [
      setTxProgressError,
      completeTransaction,
      signerType,
      applyBroadcastTransaction,
      startTxProgress,
    ],
  )
}
