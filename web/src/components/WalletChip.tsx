import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { ChevronDown } from '@/components/ui'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { RoutePath } from '@/constants/routes'
import { CHIP_STATE_LABEL as STATE_LABEL, useWalletChipState } from '@/hooks/useWalletChipState'
import { formatFixed, formatPrincipal, shortId } from '@/lib/money'
import { useWallets, wallets } from '@/lib/wallets'
import { useWallet } from '@/providers/wallet/useWallet'

/** The header's wallet chip: the active wallet, its balances, and switching between wallets. */
export function WalletChip() {
  const { store, active } = useWallets()
  const { confirmedBalances, receiveAddress, error } = useWallet()
  const state = useWalletChipState()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { collateralAsset, principalAsset } = NETWORK_CONFIG

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', keyboard)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', keyboard)
    }
  }, [open])

  const close = () => setOpen(false)

  return (
    <div className='wallet-chip' ref={containerRef}>
      <button
        ref={triggerRef}
        type='button'
        className='wallet-chip__trigger'
        aria-haspopup='dialog'
        aria-expanded={open}
        aria-controls='wallet-chip-panel'
        aria-label={
          active ? `Wallet ${active.name}, ${STATE_LABEL[state]}` : 'Open or create a wallet'
        }
        onClick={() => setOpen(value => !value)}
      >
        <span className={`status-dot status-dot--${state}`} aria-hidden='true' />
        <span className='wallet-chip__name'>{active?.name ?? 'No wallet'}</span>
        <ChevronDown />
      </button>
      {open && (
        <div
          id='wallet-chip-panel'
          className='wallet-chip__panel'
          role='dialog'
          aria-label='Wallets'
        >
          {active ? (
            <div className='wallet-chip__summary'>
              <span className='label'>Active wallet · {STATE_LABEL[state]}</span>
              <strong className='wallet-chip__balance'>
                {formatFixed(BigInt(confirmedBalances[collateralAsset.id] ?? 0), 8)}{' '}
                <small>{collateralAsset.symbol}</small>
              </strong>
              <span className='data'>
                {formatPrincipal(BigInt(confirmedBalances[principalAsset.id] ?? 0))}{' '}
                {principalAsset.symbol}
              </span>
              {receiveAddress && (
                <span className='data' title={receiveAddress}>
                  {shortId(receiveAddress, 10, 6)}
                </span>
              )}
              {error && <p className='hint'>{error}</p>}
            </div>
          ) : (
            <p className='hint'>
              Create a wallet or import one with its recovery phrase. It stays in this browser.
            </p>
          )}
          {store.wallets.length > 1 && (
            <div className='wallet-chip__list' role='group' aria-label='Switch wallet'>
              <span className='label'>Switch wallet</span>
              {store.wallets.map(candidate => (
                <button
                  key={candidate.name}
                  type='button'
                  className='wallet-chip__option'
                  aria-pressed={candidate.name === active?.name}
                  onClick={() => {
                    wallets.select(candidate.name)
                    close()
                  }}
                >
                  {candidate.name}
                </button>
              ))}
            </div>
          )}
          <nav className='wallet-chip__links' aria-label='Wallet actions'>
            <Link to={RoutePath.Wallet} className='text-button' onClick={close}>
              Overview
            </Link>
            <Link to={RoutePath.WalletNew} className='text-button' onClick={close}>
              New
            </Link>
            <Link to={RoutePath.WalletImport} className='text-button' onClick={close}>
              Import
            </Link>
            {active && (
              <Link to={RoutePath.WalletBackup} className='text-button' onClick={close}>
                Back up
              </Link>
            )}
          </nav>
        </div>
      )}
    </div>
  )
}
