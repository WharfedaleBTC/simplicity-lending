// The page frame and the small parts every page uses, in the Wharfedale design language
// (styles.css): header, masthead, section heads, badges, figures, pager, copy buttons.
import { type ReactNode, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { usePricesUsd } from '@/api/prices/hooks'
import { WalletChip } from '@/components/WalletChip'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { offerPath, RoutePath } from '@/constants/routes'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { shortId } from '@/lib/money'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'

// ─────────────────────────────────────────────── icons (stroke, currentColor)

function Svg({ size = 15, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      {children}
    </svg>
  )
}

export const ArrowRight = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d='M5 12h14' />
    <path d='m12 5 7 7-7 7' />
  </Svg>
)
export const ArrowLeft = ({ size = 16 }: { size?: number }) => (
  <Svg size={size}>
    <path d='m12 19-7-7 7-7' />
    <path d='M19 12H5' />
  </Svg>
)
export const ChevronDown = () => (
  <Svg size={14}>
    <path d='m6 9 6 6 6-6' />
  </Svg>
)
export const CopyIcon = () => (
  <Svg>
    <rect width='14' height='14' x='8' y='8' rx='2' ry='2' />
    <path d='M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' />
  </Svg>
)
export const RefreshIcon = () => (
  <Svg>
    <path d='M21 12a9 9 0 1 1-3-6.7L21 8' />
    <path d='M21 3v5h-5' />
  </Svg>
)

// ─────────────────────────────────────────────── header

function Logo() {
  return (
    <Link to={RoutePath.Overview} className='logo' aria-label='Lending on Wharfedale, overview'>
      <span className='logo__mark' aria-hidden='true'>
        L
      </span>
      <span className='logo__name'>Lending</span>
      <span className='logo__sub'>on Wharfedale</span>
    </Link>
  )
}

const NAV = [
  { to: RoutePath.Overview, label: 'Overview' },
  { to: RoutePath.Wallet, label: 'Wallet' },
]

/** Overview owns every page except the wallet's. */
function isNavActive(to: string, pathname: string): boolean {
  const inWallet = pathname.startsWith(RoutePath.Wallet)
  return to === RoutePath.Wallet ? inWallet : !inWallet
}

function PrimaryNav() {
  const { pathname } = useLocation()
  return (
    <nav className='primary-nav' aria-label='Main'>
      <div className='nav-group'>
        <span className='nav-group__label'>Lending</span>
        {NAV.map(item => (
          <Link
            key={item.to}
            to={item.to}
            className='nav-link'
            aria-current={isNavActive(item.to, pathname) ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}

function Menu({ close }: { close: () => void }) {
  const { pathname } = useLocation()
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [close])
  return (
    <div id='menu' className='menu on-dark' role='dialog' aria-modal='true' aria-label='Menu'>
      <nav className='menu__group' aria-label='Lending'>
        <span className='label'>Lending</span>
        {NAV.map(item => (
          <Link
            key={item.to}
            to={item.to}
            className='menu__link'
            aria-current={isNavActive(item.to, pathname) ? 'page' : undefined}
            onClick={close}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}

/** The live BTC/USD price LTVs use (Coinbase; the config's price when it can't be fetched). */
function PriceChip() {
  const { data } = usePricesUsd()
  const price = data?.[NETWORK_CONFIG.collateralAsset.id]
  if (price === undefined) return null
  const fallback = price === NETWORK_CONFIG.pricesUsd[NETWORK_CONFIG.collateralAsset.id]
  return (
    <span
      className='price'
      data-fallback={fallback || undefined}
      title={
        fallback
          ? 'BTC/USD from the deployment config: the live price could not be fetched'
          : 'BTC/USD from Coinbase, refreshed every minute'
      }
    >
      <span className='price__dot' aria-hidden='true' />
      BTC ${Math.round(price).toLocaleString('en-US')}
    </span>
  )
}

/** Transactions of this wallet still waiting for a block; links to the offer of the first. */
function PendingLink() {
  const { pendingTxs } = usePendingTransactions()
  const processing = pendingTxs.filter(tx => tx.confirmationStatus === 'processing')
  if (!processing.length) return null
  const first = processing[0]
  const to = first.offerId ? offerPath(first.offerId) : RoutePath.Borrow
  const label =
    processing.length === 1
      ? '1 transaction waiting for a block'
      : `${processing.length} transactions waiting for a block`
  return (
    <Link className='pending-link' to={to} aria-label={label} title={label}>
      <Badge tone='warn'>{processing.length} pending</Badge>
    </Link>
  )
}

// ─────────────────────────────────────────────── shell

export function AppShell({
  children,
  section,
  title,
  lede,
  aside,
  back,
}: {
  children: ReactNode
  section: string
  title: ReactNode
  lede?: ReactNode
  aside?: ReactNode
  back?: { to: string; label: string }
}) {
  const { pathname } = useLocation()
  const [menu, setMenu] = useState(false)
  const [menuPath, setMenuPath] = useState(pathname)
  if (menuPath !== pathname) {
    setMenuPath(pathname)
    setMenu(false)
  }
  useEffect(() => {
    document.title = typeof title === 'string' ? `${title} · Lending` : 'Lending · Wharfedale'
  }, [title])
  return (
    <>
      <a className='skip-link' href='#content'>
        Skip to content
      </a>
      <header className='site-header'>
        <div className='site-header__bar'>
          <Logo />
          <div className='header-tools'>
            <PriceChip />
            <PendingLink />
            <WalletChip />
            <button
              type='button'
              className='menu-toggle'
              aria-expanded={menu}
              aria-controls='menu'
              aria-label={menu ? 'Close menu' : 'Open menu'}
              onClick={() => setMenu(!menu)}
            >
              <span className='menu-toggle__bar' />
              <span className='menu-toggle__bar' />
            </button>
          </div>
        </div>
        <div className='site-header__nav'>
          <PrimaryNav />
        </div>
      </header>
      {menu && <Menu close={() => setMenu(false)} />}
      <main id='content' className='main'>
        <Masthead section={section} title={title} lede={lede} aside={aside} back={back} />
        <div className='shell page-body'>{children}</div>
      </main>
      <footer className='site-footer'>
        <div className='shell site-footer__row'>
          <span>
            Lending · peer-to-peer loans of {NETWORK_CONFIG.principalAsset.symbol} against{' '}
            {NETWORK_CONFIG.collateralAsset.symbol} on Wharfedale, enforced by Simplicity contracts.
            Wallets are stored unencrypted in this browser: testing only.
          </span>
          <a
            className='text-link'
            href='https://github.com/WharfedaleBTC/simplicity-lending'
            target='_blank'
            rel='noreferrer'
          >
            Protocol source ↗
          </a>
        </div>
      </footer>
    </>
  )
}

export function Masthead({
  section,
  title,
  lede,
  aside,
  back,
}: {
  section: string
  title: ReactNode
  lede?: ReactNode
  aside?: ReactNode
  back?: { to: string; label: string }
}) {
  return (
    <header className='masthead shell'>
      <div className='masthead__grid'>
        <div className='masthead__main'>
          {back && (
            <Link to={back.to} className='back'>
              <ArrowLeft /> {back.label}
            </Link>
          )}
          <span className='label label--mark'>{section}</span>
          <h1 className='masthead__title'>{title}</h1>
          {lede && <div className='masthead__lede'>{lede}</div>}
        </div>
        {aside && <div className='masthead__aside'>{aside}</div>}
      </div>
      <div className='masthead__rule' aria-hidden='true' />
    </header>
  )
}

export function SectionHeading({
  label,
  title,
  aside,
}: {
  label?: string
  title: ReactNode
  aside?: ReactNode
}) {
  return (
    <div className='section-head'>
      <div className='section-head__main'>
        {label && <span className='label label--mark'>{label}</span>}
        <h2 className='section-head__title'>{title}</h2>
      </div>
      {aside && <div className='section-head__aside'>{aside}</div>}
    </div>
  )
}

export type BadgeTone = 'neutral' | 'good' | 'warn' | 'danger' | 'accent'

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: BadgeTone }) {
  const variant = {
    neutral: '',
    good: ' badge--signal',
    warn: ' badge--caution',
    danger: ' badge--danger',
    accent: ' badge--accent',
  }[tone]
  return (
    <span className={`badge${variant}`}>
      {tone !== 'neutral' && <span className='badge__dot' aria-hidden='true' />}
      {children}
    </span>
  )
}

export interface Figure {
  term: string
  value: ReactNode
  unit?: string
  sub?: ReactNode
}

export function Figures({ items }: { items: Figure[] }) {
  return (
    <dl className='big-figures'>
      {items.map(item => (
        <div key={item.term}>
          <dt>{item.term}</dt>
          <dd>
            {item.value}
            {item.unit && <small> {item.unit}</small>}
            {item.sub && <span className='sub'>{item.sub}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Definition rows; a row marked `total` is the panel's bottom line. */
export function DetailList({
  rows,
}: {
  rows: Array<[string, ReactNode] | [string, ReactNode, 'total']>
}) {
  return (
    <dl className='dl'>
      {rows.map(([term, value, mark]) => (
        <div key={term} className={mark}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Pager({
  page,
  pageSize,
  total,
  noun,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  noun: string
  onPage: (page: number) => void
}) {
  if (total === 0) return null
  const from = page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)
  return (
    <div className='pager'>
      <span className='hint'>
        {from}–{to} of {total} {noun}
      </span>
      {total > pageSize && (
        <span className='button-row'>
          <button
            className='button secondary button--sm'
            type='button'
            disabled={page === 0}
            onClick={() => onPage(page - 1)}
          >
            ← Previous
          </button>
          <button
            className='button secondary button--sm'
            type='button'
            disabled={to >= total}
            onClick={() => onPage(page + 1)}
          >
            Next →
          </button>
        </span>
      )}
    </div>
  )
}

/** A small copy button; `label` names what it copies for screen readers. */
export function CopyButton({
  value,
  label,
  className = 'copy-button',
  children,
}: {
  value: string
  label: string
  className?: string
  children?: ReactNode
}) {
  const [copied, copy] = useCopyToClipboard()
  return (
    <button
      type='button'
      className={className}
      aria-label={`Copy ${label}`}
      onClick={() => copy(value)}
    >
      <CopyIcon />
      <span aria-live='polite'>{copied ? 'Copied' : (children ?? 'Copy')}</span>
    </button>
  )
}

/** A hash or id: shortened, full value on hover, with a copy button. */
export function Hash({
  value,
  label,
  start = 8,
  end = 8,
}: {
  value: string
  label: string
  start?: number
  end?: number
}) {
  return (
    <span className='hash'>
      <code title={value}>{shortId(value, start, end)}</code>
      <CopyButton value={value} label={label} />
    </span>
  )
}

/** A transaction id linked to the explorer (the Wharfedale web app), when one is configured. */
export function TxLink({ txid }: { txid: string }) {
  const text = shortId(txid)
  if (!NETWORK_CONFIG.explorerUrl) return <span className='mono'>{text}</span>
  return (
    <a
      className='text-link mono'
      href={`${NETWORK_CONFIG.explorerUrl}/tx/${txid}`}
      target='_blank'
      rel='noreferrer'
      title={txid}
    >
      {text} ↗
    </a>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className='empty-state'>
      <strong>{title}</strong>
      {children && <span className='hint'>{children}</span>}
    </div>
  )
}

/** Shown where a page needs a wallet and none is open. */
export function NoWalletNotice({ doing }: { doing: string }) {
  return (
    <div className='notice'>
      Open a wallet to {doing}.{' '}
      <Link className='text-link' to={RoutePath.WalletNew}>
        Create one
      </Link>{' '}
      or{' '}
      <Link className='text-link' to={RoutePath.WalletImport}>
        import one
      </Link>
      ; it stays in this browser.
    </div>
  )
}
