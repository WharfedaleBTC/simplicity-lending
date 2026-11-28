import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useBorrowerOverview } from '@/api/indexer/hooks'
import type { OfferShort, OfferStatus } from '@/api/indexer/schemas'
import { LoansTable } from '@/components/loans'
import { AppShell, ArrowRight, EmptyState, Figures, NoWalletNotice, Pager } from '@/components/ui'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { RoutePath } from '@/constants/routes'
import { byNewest, useBorrowerLoans, useChainNow } from '@/hooks/useLoans'
import {
  formatDuration,
  formatPrincipal,
  formatUsdRounded,
  formatWbtc,
  wbtcUnit,
} from '@/lib/money'
import { offerInterest, useBtcUsd } from '@/lib/offerFigures'
import { useAssetDenomination } from '@/providers/assetDenomination/useAssetDenomination'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { findAssetAmount } from '@/utils/offers'

const PAGE_SIZE = 10

export interface StatusFilter {
  id: string
  label: string
  statuses: OfferStatus[] | null
}

export function StatusChips({
  filters,
  offers,
  value,
  onChange,
}: {
  filters: StatusFilter[]
  offers: OfferShort[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div className='chips' role='group' aria-label='Status'>
      {filters.map(filter => (
        <button
          key={filter.id}
          className='chip'
          type='button'
          aria-pressed={value === filter.id}
          onClick={() => onChange(filter.id)}
        >
          {filter.label}{' '}
          <small>
            {filter.statuses
              ? offers.filter(o => filter.statuses?.includes(o.status)).length
              : offers.length}
          </small>
        </button>
      ))}
    </div>
  )
}

const FILTERS: StatusFilter[] = [
  { id: 'all', label: 'All', statuses: null },
  { id: 'open', label: 'Open', statuses: ['pending'] },
  { id: 'active', label: 'Active', statuses: ['active'] },
  { id: 'repaid', label: 'Repaid', statuses: ['repaid'] },
  { id: 'closed', label: 'Closed', statuses: ['cancelled', 'claimed', 'liquidated'] },
]

export default function BorrowPage() {
  const { collateralAsset, principalAsset } = NETWORK_CONFIG
  const { isReady, scriptPubkey, confirmedBalances } = useWallet()
  const { denomination } = useAssetDenomination()
  const { highlightedCreatedOfferIds } = usePendingTransactions()
  const now = useChainNow()
  const btcUsd = useBtcUsd()
  const overview = useBorrowerOverview(scriptPubkey ?? '')
  const loans = useBorrowerLoans()
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)

  const offers = useMemo(() => [...(loans.data ?? [])].sort(byNewest), [loans.data])
  const statuses = FILTERS.find(f => f.id === filter)?.statuses ?? null
  const shown = statuses ? offers.filter(o => statuses.includes(o.status)) : offers
  const active = offers.filter(o => o.status === 'active')
  const owed = active.reduce((sum, o) => sum + o.principal_amount + offerInterest(o), 0n)
  const nextDue = active
    .map(o => o.loan_expiration_time - now)
    .filter(left => left > 0)
    .sort((a, b) => a - b)[0]
  const locked = overview.data
    ? findAssetAmount(overview.data.collateral_locked, collateralAsset.id)
    : null
  // The indexer's `borrowings` also counts open offers: borrowed is what active loans lent.
  const borrowed = loans.data ? active.reduce((sum, o) => sum + o.principal_amount, 0n) : null
  const lockedUsd =
    locked === null ? null : formatUsdRounded(locked, collateralAsset.decimals, btcUsd)

  return (
    <AppShell
      section='Lending — Borrow'
      title='Your borrowing'
      lede={`Offers you made and the loans they became. Repay each by its expiry to get your ${collateralAsset.symbol} back.`}
      back={{ to: RoutePath.Overview, label: 'Overview' }}
      aside={
        <Link className='button primary button--lg' to={RoutePath.CreateOffer}>
          Create offer <ArrowRight />
        </Link>
      }
    >
      {!isReady ? (
        <NoWalletNotice doing='borrow' />
      ) : (
        <div className='stack-xl'>
          <Figures
            items={[
              {
                term: 'Collateral locked',
                value: locked === null ? '—' : formatWbtc(locked, denomination),
                unit: wbtcUnit(denomination),
                sub: lockedUsd ? `≈ ${lockedUsd}` : undefined,
              },
              {
                term: 'Borrowed',
                value: borrowed === null ? '—' : formatPrincipal(borrowed),
                unit: principalAsset.symbol,
                sub: loans.data ? `in ${active.length} active loans` : undefined,
              },
              {
                term: 'Owed at expiry',
                value: formatPrincipal(owed),
                unit: principalAsset.symbol,
                sub:
                  nextDue === undefined ? 'nothing due' : `next due in ${formatDuration(nextDue)}`,
              },
              {
                term: 'Open offers',
                value: overview.data ? String(overview.data.pending_offers) : '—',
                sub: 'waiting for a lender',
              },
            ]}
          />
          <section className='stack-md'>
            <div className='toolbar'>
              <StatusChips
                filters={FILTERS}
                offers={offers}
                value={filter}
                onChange={id => {
                  setFilter(id)
                  setPage(0)
                }}
              />
              <span className='data'>
                {collateralAsset.symbol} available{' '}
                {formatWbtc(BigInt(confirmedBalances[collateralAsset.id] ?? 0), denomination)} ·{' '}
                {principalAsset.symbol}{' '}
                {formatPrincipal(BigInt(confirmedBalances[principalAsset.id] ?? 0))}
              </span>
            </div>
            {loans.isError ? (
              <p className='notice notice--danger'>Your loans could not be loaded.</p>
            ) : shown.length ? (
              <>
                <LoansTable
                  offers={shown.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)}
                  caption='Your loans and offers'
                  now={now}
                  highlighted={highlightedCreatedOfferIds}
                />
                <Pager
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={shown.length}
                  noun='loans and offers'
                  onPage={setPage}
                />
              </>
            ) : (
              <EmptyState title={loans.isLoading ? 'Loading your loans…' : 'Nothing here yet'}>
                {loans.isLoading ? undefined : (
                  <>
                    <Link to={RoutePath.CreateOffer}>Offer a loan</Link>: lock{' '}
                    {collateralAsset.symbol} and name your terms.
                  </>
                )}
              </EmptyState>
            )}
          </section>
        </div>
      )}
    </AppShell>
  )
}
