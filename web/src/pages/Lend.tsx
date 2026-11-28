import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useLenderOverview } from '@/api/indexer/hooks'
import { LoansTable } from '@/components/loans'
import { AppShell, ArrowRight, EmptyState, Figures, NoWalletNotice, Pager } from '@/components/ui'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { RoutePath } from '@/constants/routes'
import { byNewest, useChainNow, useLenderLoans } from '@/hooks/useLoans'
import { formatPrincipal, formatWbtc, wbtcUnit } from '@/lib/money'
import { lenderInterest } from '@/lib/offerFigures'
import { StatusChips, type StatusFilter } from '@/pages/Borrow'
import { useAssetDenomination } from '@/providers/assetDenomination/useAssetDenomination'
import { useWallet } from '@/providers/wallet/useWallet'
import { resolveOfferAction } from '@/utils/offerActions'
import { findAssetAmount } from '@/utils/offers'

const PAGE_SIZE = 10

const FILTERS: StatusFilter[] = [
  { id: 'all', label: 'All', statuses: null },
  { id: 'active', label: 'Active', statuses: ['active'] },
  { id: 'repaid', label: 'Repaid', statuses: ['repaid'] },
  { id: 'closed', label: 'Closed', statuses: ['claimed', 'liquidated'] },
]

export default function LendPage() {
  const { principalAsset } = NETWORK_CONFIG
  const { isReady, scriptPubkey, confirmedBalances } = useWallet()
  const { denomination } = useAssetDenomination()
  const now = useChainNow()
  const overview = useLenderOverview(scriptPubkey ?? '')
  const loans = useLenderLoans()
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)

  const offers = useMemo(() => [...(loans.data ?? [])].sort(byNewest), [loans.data])
  const statuses = FILTERS.find(f => f.id === filter)?.statuses ?? null
  const shown = statuses ? offers.filter(o => statuses.includes(o.status)) : offers
  const repaid = offers.filter(o => o.status === 'repaid')
  const toClaim = repaid.reduce((sum, o) => sum + o.principal_amount + lenderInterest(o), 0n)
  const toLiquidate = offers.filter(o => resolveOfferAction(o, scriptPubkey, now) === 'liquidate')
  const liquidateCollateral = toLiquidate.reduce((sum, o) => sum + o.collateral_amount, 0n)
  const supplied = overview.data
    ? findAssetAmount(overview.data.supplied_loans, principalAsset.id)
    : null
  const outstanding = offers
    .filter(o => o.status === 'active')
    .reduce((sum, o) => sum + lenderInterest(o), 0n)

  return (
    <AppShell
      section='Lending — Lend'
      title='Your lending'
      lede='Loans you funded. Claim each repayment when it comes; if a loan expires unpaid, take its collateral.'
      back={{ to: RoutePath.Overview, label: 'Overview' }}
      aside={
        <Link className='button primary button--lg' to={RoutePath.Market}>
          Find an offer <ArrowRight />
        </Link>
      }
    >
      {!isReady ? (
        <NoWalletNotice doing='lend' />
      ) : (
        <div className='stack-xl'>
          <Figures
            items={[
              {
                term: 'Lent now',
                value: supplied === null ? '—' : formatPrincipal(supplied),
                unit: principalAsset.symbol,
                sub: overview.data ? `in ${overview.data.active_loans} active loans` : undefined,
              },
              {
                term: 'Interest to come',
                value: formatPrincipal(outstanding),
                unit: principalAsset.symbol,
                sub: 'after the 10% fee',
              },
              {
                term: 'To claim',
                value: formatPrincipal(toClaim),
                unit: principalAsset.symbol,
                sub: `${repaid.length} repaid ${repaid.length === 1 ? 'loan' : 'loans'}`,
              },
              {
                term: 'To liquidate',
                value: String(toLiquidate.length),
                sub: toLiquidate.length
                  ? `${formatWbtc(liquidateCollateral, denomination)} ${wbtcUnit(denomination)}`
                  : 'none expired unpaid',
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
                {principalAsset.symbol} available{' '}
                {formatPrincipal(BigInt(confirmedBalances[principalAsset.id] ?? 0))}
              </span>
            </div>
            {loans.isError ? (
              <p className='notice notice--danger'>Your loans could not be loaded.</p>
            ) : shown.length ? (
              <>
                <LoansTable
                  offers={shown.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)}
                  caption='Loans you funded'
                  now={now}
                />
                <Pager
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={shown.length}
                  noun='loans'
                  onPage={setPage}
                />
              </>
            ) : (
              <EmptyState title={loans.isLoading ? 'Loading your loans…' : 'No loans yet'}>
                {loans.isLoading ? undefined : (
                  <>
                    Pick one in the <Link to={RoutePath.Market}>market</Link> to lend its{' '}
                    {principalAsset.symbol}.
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
