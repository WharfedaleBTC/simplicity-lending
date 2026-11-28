// The lists the pages show: open offers in the market, and the wallet's own loans by role.
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useChainTime } from '@/api/esplora/hooks'
import { useAllBorrowerOffers, useAllLenderOffers } from '@/api/indexer/hooks'
import { fetchAllOfferPages, fetchOffers } from '@/api/indexer/methods'
import { offersQueryKeys } from '@/api/indexer/queryKeys'
import type { OfferShort, OfferStatus } from '@/api/indexer/schemas'
import { STALE_TIME_MS } from '@/api/staleTime'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { REPAYMENT_DUE_THRESHOLD_SECONDS } from '@/constants/offers'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { type OfferAction, resolveOfferAction } from '@/utils/offerActions'
import { getOfferPendingTx } from '@/utils/pendingTransactions'

/** Every open, unexpired offer, except the wallet's own (it can't lend to itself). */
export function useMarketOffers() {
  const { scriptPubkey } = useWallet()
  const params = {
    status: 'pending' as OfferStatus,
    notExpired: true,
    collateralAsset: NETWORK_CONFIG.collateralAsset.id,
    principalAsset: NETWORK_CONFIG.principalAsset.id,
    ...(scriptPubkey ? { excludeParticipantScript: scriptPubkey } : {}),
  }
  return useQuery({
    queryKey: [...offersQueryKeys.lists(), 'market', params],
    queryFn: ({ signal }) => fetchAllOfferPages(page => fetchOffers(page, { signal }), params),
    staleTime: STALE_TIME_MS.short,
  })
}

/** Newest first. */
export function byNewest(a: OfferShort, b: OfferShort): number {
  return b.created_at_height - a.created_at_height
}

export function useBorrowerLoans() {
  const { scriptPubkey } = useWallet()
  return useAllBorrowerOffers(scriptPubkey ?? '')
}

export function useLenderLoans() {
  const { scriptPubkey } = useWallet()
  return useAllLenderOffers(scriptPubkey ?? '')
}

/** Chain time now, in unix seconds (ticks). */
export function useChainNow(): number {
  return useChainTime().data
}

export interface Attention {
  offer: OfferShort
  action: Exclude<OfferAction, 'accept' | 'none'>
  role: 'borrower' | 'lender'
}

const PRIORITY: Record<Attention['action'], number> = {
  liquidate: 0,
  repay: 1,
  'claim-principal': 2,
  'claim-interest': 3,
  cancel: 4,
}

/**
 * What the wallet should do next, across its loans: repay one nearly or already due, take
 * expired collateral, claim a loan's principal or a repayment, cancel an expired offer.
 */
export function useAttention(): { items: Attention[]; isLoading: boolean } {
  const { scriptPubkey } = useWallet()
  const { pendingTxs } = usePendingTransactions()
  const now = useChainNow()
  const borrower = useBorrowerLoans()
  const lender = useLenderLoans()
  const items = useMemo(() => {
    const out: Attention[] = []
    const add = (offers: OfferShort[] | undefined, role: Attention['role']) => {
      for (const offer of offers ?? []) {
        if (getOfferPendingTx(offer.id, pendingTxs)) continue
        const action = resolveOfferAction(offer, scriptPubkey, now)
        if (action === 'none' || action === 'accept') continue
        const left = offer.loan_expiration_time - now
        if (action === 'repay' && left > REPAYMENT_DUE_THRESHOLD_SECONDS) continue
        if (action === 'cancel' && left > 0) continue
        out.push({ offer, action, role })
      }
    }
    add(borrower.data, 'borrower')
    add(lender.data, 'lender')
    return out.sort((a, b) => PRIORITY[a.action] - PRIORITY[b.action])
  }, [borrower.data, lender.data, pendingTxs, scriptPubkey, now])
  return { items, isLoading: borrower.isLoading || lender.isLoading }
}
