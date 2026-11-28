import { useMemo, useState } from 'react'

import type { OfferShort } from '@/api/indexer/schemas'
import { OffersTable } from '@/components/loans'
import { AppShell, DetailList, EmptyState, Pager, RefreshIcon } from '@/components/ui'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { RoutePath } from '@/constants/routes'
import { byNewest, useChainNow, useMarketOffers } from '@/hooks/useLoans'
import { formatPrincipal } from '@/lib/money'
import { offerApr, offerLtv, useBtcUsd, useCreatedTimes } from '@/lib/offerFigures'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'

const PAGE_SIZE = 10
const DAY = 86_400

const TERMS = [
  { id: 'any', label: 'Any', max: Infinity },
  { id: '7', label: 'Up to 7 days', max: 7 * DAY },
  { id: '30', label: 'Up to 30 days', max: 30 * DAY },
  { id: '90', label: 'Up to 90 days', max: 90 * DAY },
] as const
type TermId = (typeof TERMS)[number]['id']

const SORTS = {
  apr: 'APR, highest first',
  ending: 'Term left, shortest first',
  loan: 'Loan, largest first',
  ltv: 'LTV, lowest first',
  newest: 'Newest first',
} as const
type SortId = keyof typeof SORTS

export default function MarketPage() {
  const { principalAsset } = NETWORK_CONFIG
  const { confirmedBalances, isReady } = useWallet()
  const { highlightedCreatedOfferIds } = usePendingTransactions()
  const now = useChainNow()
  const btcUsd = useBtcUsd()
  const market = useMarketOffers()
  const offers = useMemo(() => market.data ?? [], [market.data])
  const created = useCreatedTimes(offers)
  const [term, setTerm] = useState<TermId>('any')
  const [sort, setSort] = useState<SortId>('apr')
  const [page, setPage] = useState(0)

  const counts = useMemo(
    () =>
      Object.fromEntries(
        TERMS.map(t => [t.id, offers.filter(o => o.loan_expiration_time - now <= t.max).length]),
      ) as Record<TermId, number>,
    [offers, now],
  )

  const shown = useMemo(() => {
    const max = TERMS.find(t => t.id === term)?.max ?? Infinity
    const apr = (o: OfferShort) => offerApr(o, created[o.created_at_height]) ?? -1
    const ltv = (o: OfferShort) => offerLtv(o, btcUsd) ?? Infinity
    const compare: Record<SortId, (a: OfferShort, b: OfferShort) => number> = {
      apr: (a, b) => apr(b) - apr(a),
      ending: (a, b) => a.loan_expiration_time - b.loan_expiration_time,
      loan: (a, b) => Number(b.principal_amount - a.principal_amount),
      ltv: (a, b) => ltv(a) - ltv(b),
      newest: byNewest,
    }
    return offers.filter(o => o.loan_expiration_time - now <= max).sort(compare[sort])
  }, [offers, term, sort, now, created, btcUsd])

  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const current = Math.min(page, pageCount - 1)

  return (
    <AppShell
      section='Lending — Market'
      title='Open offers'
      lede={`Loans borrowers are asking for, each secured by ${NETWORK_CONFIG.collateralAsset.symbol} already locked in its contract. Accept one to lend its ${principalAsset.symbol}; your own offers are on Borrow.`}
      back={{ to: RoutePath.Overview, label: 'Overview' }}
      aside={
        isReady ? (
          <DetailList
            rows={[
              [
                `Your ${principalAsset.symbol}`,
                formatPrincipal(BigInt(confirmedBalances[principalAsset.id] ?? 0)),
              ],
            ]}
          />
        ) : undefined
      }
    >
      <section className='stack-md'>
        <div className='toolbar'>
          <div className='toolbar__group'>
            <span className='label'>Term left</span>
            <div className='chips' role='group' aria-label='Term left'>
              {TERMS.map(t => (
                <button
                  key={t.id}
                  className='chip'
                  type='button'
                  aria-pressed={term === t.id}
                  onClick={() => {
                    setTerm(t.id)
                    setPage(0)
                  }}
                >
                  {t.label} <small>{counts[t.id]}</small>
                </button>
              ))}
            </div>
          </div>
          <div className='toolbar__group'>
            <label htmlFor='sort'>Sort</label>
            <select
              id='sort'
              className='select'
              value={sort}
              onChange={event => {
                setSort(event.target.value as SortId)
                setPage(0)
              }}
            >
              {Object.entries(SORTS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <button
              className='icon-button'
              type='button'
              aria-label='Refresh offers'
              aria-busy={market.isFetching}
              onClick={() => void market.refetch()}
            >
              <RefreshIcon />
            </button>
          </div>
        </div>
        {market.isError ? (
          <p className='notice notice--danger'>
            The offers could not be loaded.{' '}
            <button type='button' className='text-link' onClick={() => void market.refetch()}>
              Try again
            </button>
          </p>
        ) : shown.length ? (
          <>
            <OffersTable
              offers={shown.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)}
              caption='Open offers'
              now={now}
              highlighted={highlightedCreatedOfferIds}
            />
            <Pager
              page={current}
              pageSize={PAGE_SIZE}
              total={shown.length}
              noun='open offers'
              onPage={setPage}
            />
          </>
        ) : (
          <EmptyState title={market.isLoading ? 'Loading offers…' : 'No open offers'}>
            {market.isLoading
              ? undefined
              : term === 'any'
                ? 'Nobody is asking for a loan right now.'
                : 'None ends within this term; try a longer one.'}
          </EmptyState>
        )}
      </section>
    </AppShell>
  )
}
