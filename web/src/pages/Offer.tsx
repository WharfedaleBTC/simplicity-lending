import { type ReactNode, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useOffer } from '@/api/indexer/hooks'
import type { OfferShort } from '@/api/indexer/schemas'
import { LtvMeter, StatusBadges, TxSteps } from '@/components/loans'
import {
  AppShell,
  ArrowRight,
  Badge,
  DetailList,
  Figures,
  Hash,
  NoWalletNotice,
  SectionHeading,
  TxLink,
} from '@/components/ui'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { RoutePath } from '@/constants/routes'
import { useChainNow } from '@/hooks/useLoans'
import { useNow } from '@/hooks/useNow'
import { type TxAction, useOfferTransaction } from '@/hooks/useOfferTransaction'
import { useTxStatus } from '@/hooks/useTxStatus'
import {
  formatDateTime,
  formatDuration,
  formatPercent,
  formatPrincipal,
  formatUsdRounded,
  formatWbtc,
  offerLabel,
  shortId,
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
import { useWallet } from '@/providers/wallet/useWallet'
import { type ActorRole, resolveActorRole, resolveOfferAction } from '@/utils/offerActions'
import { computeProtocolFee } from '@/utils/offers'
import {
  getMempoolBlockingTx,
  getOfferPendingTx,
  isBlockingTxStuck,
  PENDING_TX_KIND_LABEL,
} from '@/utils/pendingTransactions'

function termText(seconds: number | null): string {
  if (seconds === null) return '—'
  const days = seconds / 86_400
  if (days >= 1 && Math.abs(days - Math.round(days)) < 0.05) {
    const whole = Math.round(days)
    return `${whole} ${whole === 1 ? 'day' : 'days'}`
  }
  // The term counts from the offer's block, a few seconds after it was set: round to minutes.
  return formatDuration(Math.round(seconds / 60) * 60)
}

function participant(offer: OfferShort, type: 'borrower' | 'lender'): string | null {
  return offer.participants.find(p => p.participant_type === type)?.script_pubkey ?? null
}

interface PanelCopy {
  label: string
  button: string
  buttonClass: string
  rows: Array<[string, ReactNode] | [string, ReactNode, 'total']>
}

/** The action panel's words and figures for one action on one offer. */
function usePanelCopy(offer: OfferShort, action: TxAction): PanelCopy {
  const { denomination } = useAssetDenomination()
  const { confirmedBalances } = useWallet()
  const usdt = NETWORK_CONFIG.principalAsset.symbol
  const btcUsd = useBtcUsd()
  const p = (amount: bigint) => `${formatPrincipal(amount)} ${usdt}`
  const w = (amount: bigint) => `${formatWbtc(amount, denomination)} ${wbtcUnit(denomination)}`
  const interest = offerInterest(offer)
  const fee = computeProtocolFee(interest)
  const available: [string, ReactNode] = [
    `Your ${usdt}`,
    `${formatPrincipal(BigInt(confirmedBalances[NETWORK_CONFIG.principalAsset.id] ?? 0))} available`,
  ]
  switch (action) {
    case 'accept':
      return {
        label: 'Accept and lend',
        button: 'Accept and lend',
        buttonClass: 'button accent button--lg button--full',
        rows: [
          ['You send', p(offer.principal_amount)],
          ['Interest', p(interest)],
          ['Protocol fee, 10%', `−${p(fee)}`],
          ['You claim on repayment', p(offer.principal_amount + interest - fee), 'total'],
          available,
        ],
      }
    case 'cancel':
      return {
        label: 'Cancel the offer',
        button: 'Cancel offer',
        buttonClass: 'button outline-light button--lg button--full',
        rows: [['You get back', w(offer.collateral_amount), 'total']],
      }
    case 'repay':
      return {
        label: 'Repay',
        button: `Repay ${p(offer.principal_amount + interest)}`,
        buttonClass: 'button accent button--lg button--full',
        rows: [
          ['Principal', p(offer.principal_amount)],
          ['Interest', p(interest)],
          ['You pay', p(offer.principal_amount + interest), 'total'],
          ['You get back', w(offer.collateral_amount)],
          available,
        ],
      }
    case 'liquidate':
      return {
        label: 'Liquidate',
        button: 'Liquidate',
        buttonClass: 'button accent button--lg button--full',
        rows: [
          ['You receive', w(offer.collateral_amount), 'total'],
          [
            'Worth now',
            formatUsdRounded(
              offer.collateral_amount,
              NETWORK_CONFIG.collateralAsset.decimals,
              btcUsd,
            ) ?? '—',
          ],
        ],
      }
    case 'claim-interest':
      return {
        label: 'Claim the repayment',
        button: `Claim ${p(offer.principal_amount + interest - fee)}`,
        buttonClass: 'button accent button--lg button--full',
        rows: [
          ['Principal', p(offer.principal_amount)],
          ['Interest, after the fee', p(interest - fee)],
          ['You receive', p(offer.principal_amount + interest - fee), 'total'],
        ],
      }
    case 'claim-principal':
      return {
        label: 'Claim the loan',
        button: `Claim ${p(offer.principal_amount)}`,
        buttonClass: 'button accent button--lg button--full',
        rows: [['You receive', p(offer.principal_amount), 'total']],
      }
  }
}

function ActionPanel({
  offer,
  action,
  onStart,
  onDone,
}: {
  offer: OfferShort
  action: TxAction
  onStart: (action: TxAction) => void
  onDone: () => void
}) {
  const { isReady } = useWallet()
  const { pendingTxs } = usePendingTransactions()
  const now = useNow(1_000)
  const tx = useOfferTransaction(offer, action)
  const copy = usePanelCopy(offer, action)
  const [retry, setRetry] = useState(false)
  const { status: chainStatus } = useTxStatus(tx.isSuccess ? tx.data?.txid : null)
  const final = chainStatus === 'finalized' || chainStatus === 'confirmed'

  const blocking = getMempoolBlockingTx(pendingTxs)
  const blocked = tx.status === 'idle' && blocking !== null && !retry
  const stuck = blocking !== null && isBlockingTxStuck(blocking, now)
  const disabled = !isReady || tx.isPending || tx.isSuccess || Boolean(tx.insufficient) || blocked

  return (
    <div className='panel panel--dark on-dark stack-lg'>
      <span className='label label--mark'>{copy.label}</span>
      <DetailList rows={copy.rows} />
      {!isReady && <NoWalletNotice doing='act on this offer' />}
      {isReady && tx.insufficient && tx.status === 'idle' && (
        <p className='notice'>{tx.insufficient}</p>
      )}
      {blocked && (
        <p className='notice'>
          {PENDING_TX_KIND_LABEL[blocking.kind]} is still waiting for a block; one transaction at a
          time.{' '}
          {stuck && (
            <button type='button' className='text-link' onClick={() => setRetry(true)}>
              Continue anyway
            </button>
          )}
        </p>
      )}
      <button
        className={copy.buttonClass}
        type='button'
        disabled={disabled}
        aria-busy={tx.isPending}
        onClick={() => {
          onStart(action)
          tx.mutate()
        }}
      >
        {tx.isPending ? 'Working…' : tx.isSuccess ? 'Sent' : copy.button}
        {tx.status === 'idle' && <ArrowRight />}
      </button>
      <TxSteps status={tx.status} txid={tx.data?.txid} />
      {tx.data?.txid && (
        <p className='hint'>
          Transaction <TxLink txid={tx.data.txid} />
        </p>
      )}
      {tx.isError && (
        <button type='button' className='button outline-light' onClick={() => tx.reset()}>
          Try again
        </button>
      )}
      {final && (
        <div className='notice notice--ok'>
          Done: in a block, final.{' '}
          <button type='button' className='text-link' onClick={onDone}>
            Continue
          </button>
        </div>
      )}
    </div>
  )
}

function WaitingPanel({ txid, kind }: { txid: string; kind: string }) {
  return (
    <div className='panel panel--dark on-dark stack-lg'>
      <span className='label label--mark'>{kind}</span>
      <p className='hint'>Broadcast; waiting for a block. This page updates when it lands.</p>
      <TxSteps status='success' txid={txid} />
      <p className='hint'>
        Transaction <TxLink txid={txid} />
      </p>
    </div>
  )
}

function restingCopy(offer: OfferShort, role: ActorRole, now: number): string {
  const expired = offer.loan_expiration_time <= now
  switch (offer.status) {
    case 'pending':
      return expired
        ? 'Nobody accepted this offer before it expired; the borrower can cancel it.'
        : 'Waiting for a lender.'
    case 'active':
      if (role === 'lender') return expired ? 'Expired.' : 'Waiting for the borrower to repay.'
      return 'Active: between the borrower and a lender.'
    case 'repaid':
      return role === 'borrower'
        ? 'Repaid: your collateral came back. The lender claims the repayment.'
        : 'Repaid: the lender can claim the repayment.'
    case 'liquidated':
      return 'Liquidated: the lender took the collateral.'
    case 'cancelled':
      return 'Cancelled: the collateral went back to the borrower.'
    case 'claimed':
      return 'Settled: the lender claimed the repayment.'
  }
}

export default function OfferPage() {
  const { offerId = '' } = useParams()
  const { scriptPubkey } = useWallet()
  const { pendingTxs } = usePendingTransactions()
  const { denomination } = useAssetDenomination()
  const now = useChainNow()
  const btcUsd = useBtcUsd()
  const { data: offer, isLoading, isError } = useOffer(offerId)
  const created = useCreatedTimes(offer ? [offer] : [])
  const liveAction = offer ? resolveOfferAction(offer, scriptPubkey, now) : 'none'
  // Keep the action the person started, as the offer's status moves on under it.
  const [startedAction, setStartedAction] = useState<TxAction | null>(null)
  // A started action belongs to the wallet that started it.
  const [startedBy, setStartedBy] = useState(scriptPubkey)
  if (startedBy !== scriptPubkey) {
    setStartedBy(scriptPubkey)
    setStartedAction(null)
  }

  if (!offer) {
    return (
      <AppShell
        section='Lending — Offer'
        title={isLoading ? 'Loading the offer…' : 'Offer not found'}
        back={{ to: RoutePath.Market, label: 'Market' }}
      >
        {isError && <p className='notice notice--danger'>The offer could not be loaded.</p>}
      </AppShell>
    )
  }

  const usdt = NETWORK_CONFIG.principalAsset.symbol
  const role = resolveActorRole(offer, scriptPubkey)
  const action: TxAction | 'none' = startedAction ?? liveAction
  const createdAt = created[offer.created_at_height]
  const duration = createdAt === undefined ? null : offer.loan_expiration_time - createdAt
  const left = offer.loan_expiration_time - now
  const interest = offerInterest(offer)
  const apr = offerApr(offer, createdAt)
  const ltv = offerLtv(offer, btcUsd)
  const pendingTx = getOfferPendingTx(offer.id, pendingTxs)
  const borrower = participant(offer, 'borrower')
  const lender = participant(offer, 'lender')
  const collateral = `${formatWbtc(offer.collateral_amount, denomination)} ${wbtcUnit(denomination)}`
  const total = formatPrincipal(offer.principal_amount + interest)

  const back =
    role === 'borrower'
      ? { to: RoutePath.Borrow, label: 'Your borrowing' }
      : role === 'lender' && offer.status !== 'pending'
        ? { to: RoutePath.Lend, label: 'Your lending' }
        : { to: RoutePath.Market, label: 'Market' }

  const loanFor = `${formatPrincipal(offer.principal_amount)} ${usdt} for ${termText(duration)}`
  const heading: Record<TxAction | 'none', { title: string; lede: string }> = {
    accept: {
      title: loanFor,
      lede: `Secured by ${collateral} locked in the loan contract. Lend it and the borrower owes ${total} ${usdt} by ${formatDateTime(offer.loan_expiration_time)}; if it isn't repaid by then, the collateral can be yours.`,
    },
    cancel: {
      title: loanFor,
      lede:
        left > 0
          ? `Your offer, waiting for a lender until ${formatDateTime(offer.loan_expiration_time)}. Cancel it to unlock your ${collateral}.`
          : `Nobody accepted your offer before it expired. Cancel it to get your ${collateral} back.`,
    },
    repay: {
      title: `Repay ${total} ${usdt}`,
      lede:
        left > 0
          ? `Due ${formatDateTime(offer.loan_expiration_time)}, in ${formatDuration(left)}. Repay by then to get your ${collateral} back.`
          : `Expired ${formatDuration(left)} ago. You can still repay until the lender liquidates, and get your ${collateral} back.`,
    },
    liquidate: {
      title: 'Take the collateral',
      lede: `This loan expired ${formatDuration(left)} ago, on ${formatDateTime(offer.loan_expiration_time)}, and was not repaid. Liquidating sends its ${collateral} to your wallet and closes the loan.`,
    },
    'claim-interest': {
      title: `Claim ${formatPrincipal(offer.principal_amount + lenderInterest(offer))} ${usdt}`,
      lede: `The borrower repaid this loan. Claim the principal and the interest, less the 10% protocol fee.`,
    },
    'claim-principal': {
      title: `Claim ${formatPrincipal(offer.principal_amount)} ${usdt}`,
      lede:
        offer.status === 'active'
          ? `A lender funded your offer. Claim the ${usdt}; repay ${total} ${usdt} by ${formatDateTime(offer.loan_expiration_time)} to get your ${collateral} back.`
          : `The lender took the collateral, but the ${usdt} they lent is still yours to claim.`,
    },
    none: { title: loanFor, lede: restingCopy(offer, role, now) },
  }

  const sectionLabel =
    offer.status === 'pending'
      ? `Open offer · ${offerLabel(offer.id)}`
      : role === 'guest'
        ? `Loan · ${offerLabel(offer.id)}`
        : `Your loan · ${offerLabel(offer.id)}`

  return (
    <AppShell
      section={sectionLabel}
      title={heading[action].title}
      lede={heading[action].lede}
      back={back}
      aside={<StatusBadges offer={offer} now={now} />}
    >
      <div className='stack-xl'>
        <Figures
          items={[
            { term: 'Loan', value: formatPrincipal(offer.principal_amount), unit: usdt },
            {
              term: 'Collateral',
              value: formatWbtc(offer.collateral_amount, denomination),
              unit: wbtcUnit(denomination),
              sub: (() => {
                const usd = formatUsdRounded(
                  offer.collateral_amount,
                  NETWORK_CONFIG.collateralAsset.decimals,
                  btcUsd,
                )
                return usd ? `≈ ${usd}` : undefined
              })(),
            },
            {
              term: 'Interest',
              value: formatPrincipal(interest),
              unit: usdt,
              sub: `lender keeps ${formatPrincipal(lenderInterest(offer))}`,
            },
            {
              term: 'APR',
              value: apr === null ? '—' : formatPercent(apr),
              sub: 'before the 10% fee',
            },
          ]}
        />
        <div className='split'>
          <div className='split__main stack-xl'>
            <section className='stack-md'>
              <SectionHeading
                label='Terms'
                title={offer.status === 'pending' ? 'The offer' : 'The loan'}
              />
              <DetailList
                rows={[
                  ['Offer', <Hash key='id' value={offer.id} label='offer id' />],
                  [
                    'Borrower',
                    borrower ? <span className='mono'>{shortId(borrower, 6, 4)}</span> : '—',
                  ],
                  ...(lender && offer.status !== 'pending'
                    ? ([
                        [
                          'Lender',
                          <span key='l' className='mono'>
                            {shortId(lender, 6, 4)}
                          </span>,
                        ],
                      ] as Array<[string, ReactNode]>)
                    : []),
                  [
                    'Offered',
                    `block ${offer.created_at_height.toLocaleString('en-US')}${createdAt ? ` · ${formatDateTime(createdAt)}` : ''}`,
                  ],
                  ['Term', termText(duration)],
                  [
                    left > 0 ? 'Expires' : 'Expired',
                    `${formatDateTime(offer.loan_expiration_time)} · ${left > 0 ? `${formatDuration(left)} left` : `${formatDuration(left)} ago`}`,
                  ],
                  ['Creation', <TxLink key='c' txid={offer.created_at_txid} />],
                ]}
              />
              {(offer.status === 'pending' || offer.status === 'active') && <LtvMeter ltv={ltv} />}
            </section>
          </div>
          <aside className='split__aside sticky'>
            {pendingTx && startedAction === null ? (
              <WaitingPanel txid={pendingTx.txid} kind={PENDING_TX_KIND_LABEL[pendingTx.kind]} />
            ) : action === 'none' ? (
              <div className='panel stack-md'>
                <span className='label label--mark'>Status</span>
                <StatusBadges offer={offer} now={now} />
                <p className='hint'>{restingCopy(offer, role, now)}</p>
                {role === 'guest' && offer.status === 'pending' && (
                  <Badge>Your own offers are on Borrow</Badge>
                )}
                <Link className='text-link' to={back.to}>
                  ← {back.label}
                </Link>
              </div>
            ) : (
              <ActionPanel
                key={`${scriptPubkey}-${action}`}
                offer={offer}
                action={action}
                onStart={setStartedAction}
                onDone={() => setStartedAction(null)}
              />
            )}
          </aside>
        </div>
      </div>
    </AppShell>
  )
}
