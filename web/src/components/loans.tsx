// Loan parts shared by the pages: status badges, the LTV meter, the transaction steps and the
// two tables (open offers; a wallet's loans with each one's next step).
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import type { OfferShort } from '@/api/indexer/schemas'
import { Badge } from '@/components/ui'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { MAX_LTV, MAX_LTV_PERCENT, REPAYMENT_DUE_THRESHOLD_SECONDS } from '@/constants/offers'
import { offerPath } from '@/constants/routes'
import { useTxStatus } from '@/hooks/useTxStatus'
import {
  formatDuration,
  formatPercent,
  formatPrincipal,
  formatShortDateTime,
  formatUsdRounded,
  formatWbtc,
  offerLabel,
  wbtcUnit,
} from '@/lib/money'
import {
  lenderInterest,
  offerApr,
  offerInterest,
  offerLtv,
  useBtcUsd,
  useCreatedTimes,
} from '@/lib/offerFigures'
import { useAssetDenomination } from '@/providers/assetDenomination/useAssetDenomination'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useTxProgress } from '@/providers/txProgress/useTxProgress'
import { useWallet } from '@/providers/wallet/useWallet'
import { type OfferAction, resolveActorRole, resolveOfferAction } from '@/utils/offerActions'
import { getOfferPendingTx } from '@/utils/pendingTransactions'

// ─────────────────────────────────────────────── badges

/** The offer's status, plus "Expired" or "Due soon" where it matters. */
export function StatusBadges({ offer, now }: { offer: OfferShort; now: number }) {
  const left = offer.loan_expiration_time - now
  const out: ReactNode[] = []
  switch (offer.status) {
    case 'pending':
      out.push(
        <Badge key='s' tone='warn'>
          Open offer
        </Badge>,
      )
      if (left <= 0) out.push(<Badge key='e'>Expired</Badge>)
      break
    case 'active':
      out.push(
        <Badge key='s' tone='good'>
          Active
        </Badge>,
      )
      if (left <= 0) {
        out.push(
          <Badge key='e' tone='danger'>
            Expired
          </Badge>,
        )
      } else if (left < REPAYMENT_DUE_THRESHOLD_SECONDS) {
        out.push(
          <Badge key='e' tone='warn'>
            Due soon
          </Badge>,
        )
      }
      break
    case 'repaid':
      out.push(
        <Badge key='s' tone='accent'>
          Repaid
        </Badge>,
      )
      break
    case 'liquidated':
      out.push(
        <Badge key='s' tone='danger'>
          Liquidated
        </Badge>,
      )
      break
    case 'cancelled':
      out.push(<Badge key='s'>Cancelled</Badge>)
      break
    case 'claimed':
      out.push(<Badge key='s'>Claimed</Badge>)
      break
  }
  return <span className='row'>{out}</span>
}

// ─────────────────────────────────────────────── LTV meter

export function LtvMeter({ ltv, label = 'LTV' }: { ltv: number | null; label?: string }) {
  const value = ltv === null ? '—' : formatPercent(ltv * 100, 1)
  const position = ltv === null ? 0 : Math.min(ltv / MAX_LTV, 1) * 100
  const band =
    ltv === null ? 'unknown' : position < 100 / 3 ? 'low' : position < 200 / 3 ? 'medium' : 'high'
  const over = ltv !== null && ltv > MAX_LTV
  return (
    <div className='ltv' data-over={over || undefined}>
      <div className='ltv__head'>
        <span className='label'>{label}</span>
        <span className='ltv__value'>{value}</span>
      </div>
      <div
        className='ltv__track'
        role='img'
        aria-label={
          ltv === null
            ? 'Loan to value unknown: no BTC price'
            : `Loan to value ${value}, ${band} risk, ${MAX_LTV_PERCENT}% maximum`
        }
      >
        <span />
        <span />
        <span />
        {ltv !== null && <i className='ltv__mark' style={{ left: `${position}%` }} />}
      </div>
      <div className='ltv__scale' aria-hidden='true'>
        <span>Low</span>
        <span>Medium</span>
        <span>High · {MAX_LTV_PERCENT}% max</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────── transaction steps

const STEP_LABELS = [
  'Build the transaction',
  'Sign and prove in this browser',
  'Broadcast to the node',
  'In a block, final',
]
const STAGE_INDEX: Record<string, number> = {
  constructing: 0,
  signing: 1,
  finalizing: 1,
  broadcasting: 2,
}

/** The four steps of one transaction, for the mutation the panel runs. */
export function TxSteps({
  status,
  txid,
}: {
  status: 'idle' | 'pending' | 'success' | 'error'
  txid?: string | null
}) {
  const { currentStepId, errorMessage } = useTxProgress()
  const { status: chainStatus } = useTxStatus(status === 'success' ? txid : null)
  const final = chainStatus === 'finalized' || chainStatus === 'confirmed'
  const current = currentStepId ? (STAGE_INDEX[currentStepId] ?? 0) : 0
  const stateOf = (index: number): string | undefined => {
    if (status === 'idle') return undefined
    if (status === 'success') return index < 3 || final ? 'done' : 'active'
    if (index < current) return 'done'
    if (index === current) return status === 'error' ? 'error' : 'active'
    return undefined
  }
  return (
    <>
      <ol className='steps-list steps-list--compact'>
        {STEP_LABELS.map((label, index) => (
          <li key={label} data-state={stateOf(index)}>
            <span className='index-no'>{String(index + 1).padStart(2, '0')}</span>
            <span>{label}</span>
          </li>
        ))}
      </ol>
      {status === 'error' && errorMessage && (
        <p className='notice notice--danger' role='alert'>
          {errorMessage}
        </p>
      )}
    </>
  )
}

// ─────────────────────────────────────────────── amount cells

export function WbtcCell({ amount, usd }: { amount: bigint; usd?: string | null }) {
  const { denomination } = useAssetDenomination()
  return (
    <>
      <span className='num'>{formatWbtc(amount, denomination)}</span>{' '}
      <span className='data'>{wbtcUnit(denomination)}</span>
      {usd && <span className='usd'>≈ {usd}</span>}
    </>
  )
}

export function UsdtCell({ amount }: { amount: bigint }) {
  return (
    <>
      <span className='num'>{formatPrincipal(amount)}</span>{' '}
      <span className='data'>{NETWORK_CONFIG.principalAsset.symbol}</span>
    </>
  )
}

// ─────────────────────────────────────────────── open offers

export function OffersTable({
  offers,
  caption,
  now,
  highlighted,
}: {
  offers: OfferShort[]
  caption: string
  now: number
  highlighted?: ReadonlySet<string>
}) {
  const created = useCreatedTimes(offers)
  const btcUsd = useBtcUsd()
  return (
    <div className='table-wrap'>
      <table className='table'>
        <caption className='sr-only'>{caption}</caption>
        <thead>
          <tr>
            <th scope='col'>Offer</th>
            <th scope='col' className='num'>
              Collateral
            </th>
            <th scope='col' className='num'>
              Loan
            </th>
            <th scope='col' className='num'>
              Interest
            </th>
            <th scope='col' className='num'>
              APR
            </th>
            <th scope='col' className='num'>
              LTV
            </th>
            <th scope='col' className='num'>
              Term left
            </th>
            <th scope='col'>
              <span className='sr-only'>Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {offers.map(offer => {
            const apr = offerApr(offer, created[offer.created_at_height])
            const ltv = offerLtv(offer, btcUsd)
            const left = offer.loan_expiration_time - now
            return (
              <tr key={offer.id} data-new={highlighted?.has(offer.id) || undefined}>
                <td data-label='Offer'>
                  <Link className='id' to={offerPath(offer.id)}>
                    {offerLabel(offer.id)}
                  </Link>
                </td>
                <td data-label='Collateral' className='num'>
                  <WbtcCell
                    amount={offer.collateral_amount}
                    usd={formatUsdRounded(
                      offer.collateral_amount,
                      NETWORK_CONFIG.collateralAsset.decimals,
                      btcUsd,
                    )}
                  />
                </td>
                <td data-label='Loan' className='num'>
                  <UsdtCell amount={offer.principal_amount} />
                </td>
                <td data-label='Interest' className='num'>
                  <UsdtCell amount={offerInterest(offer)} />
                </td>
                <td data-label='APR' className='num'>
                  <span className='num'>{apr === null ? '—' : formatPercent(apr)}</span>
                </td>
                <td data-label='LTV' className='num'>
                  <span className='num'>{ltv === null ? '—' : formatPercent(ltv * 100, 1)}</span>
                </td>
                <td data-label='Term left' className='num'>
                  <span className='num'>{left > 0 ? formatDuration(left) : 'Expired'}</span>
                </td>
                <td data-label=''>
                  <Link className='button secondary button--sm' to={offerPath(offer.id)}>
                    Open
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────── a wallet's loans

const ACTION_LABEL: Record<Exclude<OfferAction, 'none'>, (offer: OfferShort) => string> = {
  accept: () => 'Accept',
  cancel: () => 'Cancel offer',
  repay: offer => `Repay ${formatPrincipal(offer.principal_amount + offerInterest(offer))}`,
  'claim-principal': offer => `Claim ${formatPrincipal(offer.principal_amount)}`,
  'claim-interest': offer =>
    `Claim ${formatPrincipal(offer.principal_amount + lenderInterest(offer))}`,
  liquidate: () => 'Liquidate',
}

function restingText(
  offer: OfferShort,
  role: 'borrower' | 'lender' | 'guest',
  now: number,
): string {
  switch (offer.status) {
    case 'pending':
      return offer.loan_expiration_time > now ? 'Waiting for a lender' : 'Expired'
    case 'active':
      return role === 'lender' ? 'Waiting for repayment' : 'Active'
    case 'repaid':
      return role === 'borrower' ? 'Collateral returned' : 'Repaid'
    case 'cancelled':
      return 'Collateral returned'
    case 'liquidated':
      return role === 'lender' ? 'Collateral taken' : 'Collateral liquidated'
    case 'claimed':
      return 'Done'
  }
}

function dueText(offer: OfferShort, now: number): ReactNode {
  const left = offer.loan_expiration_time - now
  if (offer.status !== 'active' && offer.status !== 'pending') {
    return <span className='hint'>{formatShortDateTime(offer.loan_expiration_time)}</span>
  }
  return (
    <>
      {formatShortDateTime(offer.loan_expiration_time)}
      <span className='usd'>
        {left > 0 ? `in ${formatDuration(left)}` : `${formatDuration(left)} ago`}
      </span>
    </>
  )
}

/** The wallet's offers and loans, each with the step it waits on (a link to its page). */
export function LoansTable({
  offers,
  caption,
  now,
  highlighted,
}: {
  offers: OfferShort[]
  caption: string
  now: number
  highlighted?: ReadonlySet<string>
}) {
  const { scriptPubkey } = useWallet()
  const { pendingTxs } = usePendingTransactions()
  return (
    <div className='table-wrap'>
      <table className='table'>
        <caption className='sr-only'>{caption}</caption>
        <thead>
          <tr>
            <th scope='col'>Loan</th>
            <th scope='col' className='num'>
              Collateral
            </th>
            <th scope='col' className='num'>
              Loan
            </th>
            <th scope='col' className='num'>
              Interest
            </th>
            <th scope='col'>Due</th>
            <th scope='col'>Status</th>
            <th scope='col'>Next step</th>
          </tr>
        </thead>
        <tbody>
          {offers.map(offer => {
            const role = resolveActorRole(offer, scriptPubkey)
            const action = resolveOfferAction(offer, scriptPubkey, now)
            const pending = getOfferPendingTx(offer.id, pendingTxs)
            const expired = offer.loan_expiration_time <= now
            const danger = action === 'liquidate' || (action === 'repay' && expired)
            const attention =
              !danger &&
              (action === 'claim-principal' ||
                action === 'claim-interest' ||
                (action === 'repay' &&
                  offer.loan_expiration_time - now < REPAYMENT_DUE_THRESHOLD_SECONDS))
            const buttonClass =
              action === 'liquidate' || action === 'cancel'
                ? 'button danger button--sm'
                : attention || danger
                  ? 'button primary button--sm'
                  : 'button secondary button--sm'
            return (
              <tr
                key={offer.id}
                data-danger={(danger && !pending) || undefined}
                data-attention={(attention && !pending) || undefined}
                data-new={highlighted?.has(offer.id) || undefined}
              >
                <td data-label='Loan'>
                  <Link className='id' to={offerPath(offer.id)}>
                    {offerLabel(offer.id)}
                  </Link>
                </td>
                <td data-label='Collateral' className='num'>
                  <WbtcCell amount={offer.collateral_amount} />
                </td>
                <td data-label='Loan' className='num'>
                  <UsdtCell amount={offer.principal_amount} />
                </td>
                <td data-label='Interest' className='num'>
                  <UsdtCell amount={offerInterest(offer)} />
                </td>
                <td data-label='Due'>{dueText(offer, now)}</td>
                <td data-label='Status'>
                  <StatusBadges offer={offer} now={now} />
                </td>
                <td data-label='Next step'>
                  {pending ? (
                    <Badge tone='warn'>Processing</Badge>
                  ) : action === 'none' ? (
                    <span className='hint'>{restingText(offer, role, now)}</span>
                  ) : (
                    <Link className={buttonClass} to={offerPath(offer.id)}>
                      {ACTION_LABEL[action](offer)}
                    </Link>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
