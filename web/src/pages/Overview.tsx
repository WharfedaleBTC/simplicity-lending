import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { useOffersOverview } from '@/api/indexer/hooks'
import { OffersTable } from '@/components/loans'
import { AppShell, ArrowRight, Badge, EmptyState, Figures, SectionHeading } from '@/components/ui'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { offerPath, RoutePath } from '@/constants/routes'
import {
  type Attention,
  byNewest,
  useAttention,
  useBorrowerLoans,
  useChainNow,
  useLenderLoans,
  useMarketOffers,
} from '@/hooks/useLoans'
import {
  formatDuration,
  formatPercent,
  formatPrincipal,
  formatUsdRounded,
  formatWbtc,
  offerLabel,
  wbtcUnit,
} from '@/lib/money'
import {
  lenderInterest,
  offerApr,
  offerInterest,
  useBtcUsd,
  useCreatedTimes,
} from '@/lib/offerFigures'
import { useAssetDenomination } from '@/providers/assetDenomination/useAssetDenomination'
import { useWallet } from '@/providers/wallet/useWallet'
import { findAssetAmount } from '@/utils/offers'

const LATEST = 5

function AttentionRow({ item, index, now }: { item: Attention; index: number; now: number }) {
  const { denomination } = useAssetDenomination()
  const { offer, action, role } = item
  const id = <span className='mono'>{offerLabel(offer.id)}</span>
  const usdt = NETWORK_CONFIG.principalAsset.symbol
  const collateral = `${formatWbtc(offer.collateral_amount, denomination)} ${wbtcUnit(denomination)}`
  const left = offer.loan_expiration_time - now
  let title: string
  let text: React.ReactNode
  let button: { label: string; className: string }
  switch (action) {
    case 'repay': {
      const total = formatPrincipal(offer.principal_amount + offerInterest(offer))
      title = left > 0 ? 'Repayment due soon' : 'Repayment overdue'
      text =
        left > 0 ? (
          <>
            Loan {id} is due in {formatDuration(left)}. Repay {total} {usdt} to get your{' '}
            {collateral} back.
          </>
        ) : (
          <>
            Loan {id} expired {formatDuration(left)} ago. You can still repay {total} {usdt} until
            the lender liquidates it.
          </>
        )
      button = { label: 'Repay', className: 'button primary button--sm' }
      break
    }
    case 'liquidate':
      title = 'Collateral can be taken'
      text = (
        <>
          Loan {id} expired {formatDuration(left)} ago unpaid. Liquidate it to take {collateral}.
        </>
      )
      button = { label: 'Liquidate', className: 'button danger button--sm' }
      break
    case 'claim-interest':
      title = 'Repayment to claim'
      text = (
        <>
          Loan {id} was repaid. Claim{' '}
          {formatPrincipal(offer.principal_amount + lenderInterest(offer))} {usdt}.
        </>
      )
      button = { label: 'Claim', className: 'button secondary button--sm' }
      break
    case 'claim-principal':
      title = 'Principal to claim'
      text = (
        <>
          Loan {id} was funded. Claim the {formatPrincipal(offer.principal_amount)} {usdt} the
          lender sent.
        </>
      )
      button = { label: 'Claim', className: 'button secondary button--sm' }
      break
    case 'cancel':
      title = 'Offer expired'
      text = (
        <>
          Nobody accepted offer {id}. Cancel it to get your {collateral} back.
        </>
      )
      button = { label: 'Cancel offer', className: 'button danger button--sm' }
      break
  }
  return (
    <li>
      <div className='index__row index__row--static'>
        <span className='index-no'>{String(index + 1).padStart(2, '0')}</span>
        <span>
          <span className='row'>
            <span className='index__title'>{title}</span>
            <Badge
              tone={
                action === 'claim-principal' || action === 'claim-interest'
                  ? 'accent'
                  : action === 'liquidate' || left <= 0
                    ? 'danger'
                    : 'warn'
              }
            >
              {role === 'borrower' ? 'Borrower' : 'Lender'}
            </Badge>
          </span>
          <span className='index__text'>{text}</span>
        </span>
        <span className='row'>
          <Link className={button.className} to={offerPath(offer.id)}>
            {button.label}
          </Link>
        </span>
      </div>
    </li>
  )
}

export default function OverviewPage() {
  const { collateralAsset, principalAsset } = NETWORK_CONFIG
  const { denomination } = useAssetDenomination()
  const { isReady } = useWallet()
  const now = useChainNow()
  const btcUsd = useBtcUsd()
  const overview = useOffersOverview()
  const market = useMarketOffers()
  const borrower = useBorrowerLoans()
  const lender = useLenderLoans()
  const attention = useAttention()
  const open = useMemo(() => [...(market.data ?? [])].sort(byNewest), [market.data])
  const created = useCreatedTimes(open)

  const collateralLocked = overview.data
    ? findAssetAmount(overview.data.collateral_locked, collateralAsset.id)
    : null
  const lentNow = overview.data
    ? findAssetAmount(overview.data.active_loan_principal, principalAsset.id)
    : null
  const aprs = open.flatMap(offer => {
    const apr = offerApr(offer, created[offer.created_at_height])
    return apr === null ? [] : [apr]
  })
  const averageApr = aprs.length ? aprs.reduce((a, b) => a + b, 0) / aprs.length : null
  const borrowed = (borrower.data ?? [])
    .filter(offer => offer.status === 'active')
    .reduce((sum, offer) => sum + offer.principal_amount, 0n)
  const lent = (lender.data ?? [])
    .filter(offer => offer.status === 'active')
    .reduce((sum, offer) => sum + offer.principal_amount, 0n)

  return (
    <AppShell
      section='Lending — Overview'
      title={`Borrow against ${collateralAsset.symbol}. Lend ${principalAsset.symbol}.`}
      lede={`Peer-to-peer loans on Wharfedale. Borrowers lock ${collateralAsset.symbol} and set their terms; lenders pick an offer and earn its interest. A Simplicity contract holds the collateral, and only its rules move it.`}
    >
      <div className='stack-xl'>
        <Figures
          items={[
            {
              term: 'Collateral locked',
              value: collateralLocked === null ? '—' : formatWbtc(collateralLocked, denomination),
              unit: wbtcUnit(denomination),
              sub:
                collateralLocked === null
                  ? undefined
                  : formatUsdRounded(collateralLocked, collateralAsset.decimals, btcUsd)
                    ? `≈ ${formatUsdRounded(collateralLocked, collateralAsset.decimals, btcUsd)}`
                    : undefined,
            },
            {
              term: 'Lent now',
              value: lentNow === null ? '—' : formatPrincipal(lentNow),
              unit: principalAsset.symbol,
              sub: overview.data
                ? `in ${overview.data.active_loans_count} active loans`
                : undefined,
            },
            {
              term: 'Open offers',
              value: market.data ? String(market.data.length) : '—',
              sub: 'waiting for a lender',
            },
            {
              term: 'Average APR',
              value: averageApr === null ? '—' : formatPercent(averageApr),
              sub: 'open offers, before fees',
            },
          ]}
        />

        {isReady && attention.items.length > 0 && (
          <section className='stack-md'>
            <SectionHeading
              label='For my wallet'
              title='Needs your attention'
              aside={
                <span className='data'>
                  {attention.items.length} {attention.items.length === 1 ? 'action' : 'actions'}
                </span>
              }
            />
            <ul className='index attention'>
              {attention.items.map((item, index) => (
                <AttentionRow
                  key={`${item.role}-${item.offer.id}`}
                  item={item}
                  index={index}
                  now={now}
                />
              ))}
            </ul>
          </section>
        )}

        <ul className='action-cards'>
          <li>
            <Link className='action-card' to={RoutePath.Borrow}>
              <span className='action-card__no'>01</span>
              <span className='action-card__title'>Borrow</span>
              <span className='action-card__text'>
                Lock {collateralAsset.symbol} and offer a loan on your terms. Your loans, offers and
                what to do next.
              </span>
              <span className='action-card__fact'>
                <span>
                  {isReady
                    ? `${formatPrincipal(borrowed)} ${principalAsset.symbol} borrowed`
                    : 'Open a wallet to borrow'}
                </span>
                <ArrowRight />
              </span>
            </Link>
          </li>
          <li>
            <Link className='action-card' to={RoutePath.Lend}>
              <span className='action-card__no'>02</span>
              <span className='action-card__title'>Lend</span>
              <span className='action-card__text'>
                The loans you funded: interest to come, repayments to claim and collateral to take.
              </span>
              <span className='action-card__fact'>
                <span>
                  {isReady
                    ? `${formatPrincipal(lent)} ${principalAsset.symbol} lent`
                    : 'Open a wallet to lend'}
                </span>
                <ArrowRight />
              </span>
            </Link>
          </li>
          <li>
            <Link className='action-card' to={RoutePath.Market}>
              <span className='action-card__no'>03</span>
              <span className='action-card__title'>Market</span>
              <span className='action-card__text'>
                Every open offer, by APR, term and LTV. Accept one to lend its{' '}
                {principalAsset.symbol}.
              </span>
              <span className='action-card__fact'>
                <span>{market.data ? `${market.data.length} open offers` : 'Open offers'}</span>
                <ArrowRight />
              </span>
            </Link>
          </li>
        </ul>

        <section className='stack-md'>
          <SectionHeading
            label='Market'
            title='Latest offers'
            aside={
              open.length > LATEST ? (
                <Link className='text-link' to={RoutePath.Market}>
                  All {open.length} offers →
                </Link>
              ) : undefined
            }
          />
          {market.isError ? (
            <p className='notice notice--danger'>The offers could not be loaded.</p>
          ) : open.length ? (
            <OffersTable offers={open.slice(0, LATEST)} caption='Latest open offers' now={now} />
          ) : (
            <EmptyState title={market.isLoading ? 'Loading offers…' : 'No open offers'}>
              {market.isLoading ? undefined : (
                <>
                  Be the first: <Link to={RoutePath.CreateOffer}>offer a loan</Link>.
                </>
              )}
            </EmptyState>
          )}
        </section>
      </div>
    </AppShell>
  )
}
