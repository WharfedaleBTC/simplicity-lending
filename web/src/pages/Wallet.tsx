import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { AppShell, ArrowRight, Badge, CopyButton, SectionHeading } from '@/components/ui'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { RoutePath } from '@/constants/routes'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useWalletChipState } from '@/hooks/useWalletChipState'
import { formatFixed, formatPrincipal, formatUsdRounded, shortId } from '@/lib/money'
import { useBtcUsd } from '@/lib/offerFigures'
import {
  secretFromKeyText,
  secretFromPhrase,
  suggestedWalletName,
  useWallets,
  wallets,
} from '@/lib/wallets'
import { useWallet } from '@/providers/wallet/useWallet'
import { downloadKeyFile } from '@/utils/keyFile'
import { requireWasm } from '@/wharfedale/wasm'

const KEY_PATH_HINT =
  'BIP39, key at m/86′/1′/0′/0/0: the same wallet as the Wharfedale web app for this phrase. Stored unencrypted in this browser: testing only.'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function NoWallet() {
  return (
    <ol className='index'>
      {(
        [
          [
            RoutePath.WalletNew,
            'Create a wallet',
            'A new 12-word recovery phrase. Write it down; it is the only way back in.',
          ],
          [
            RoutePath.WalletImport,
            'Import a wallet',
            'From a recovery phrase, such as your Wharfedale web wallet’s, or a key file.',
          ],
        ] as const
      ).map(([to, title, text], index) => (
        <li key={to}>
          <Link to={to} className='index__row'>
            <span className='index-no'>{String(index + 1).padStart(2, '0')}</span>
            <span>
              <span className='index__title'>{title}</span>
              <span className='index__text'>{text}</span>
            </span>
            <ArrowRight />
          </Link>
        </li>
      ))}
    </ol>
  )
}

export function WalletPage() {
  const { collateralAsset, principalAsset } = NETWORK_CONFIG
  const { active } = useWallets()
  const { confirmedBalances, pendingBalances, receiveAddress, error } = useWallet()
  const state = useWalletChipState()
  const btcUsd = useBtcUsd()
  const wbtc = BigInt(confirmedBalances[collateralAsset.id] ?? 0)
  const usdt = BigInt(confirmedBalances[principalAsset.id] ?? 0)
  const pending = (id: string) => BigInt(pendingBalances[id] ?? 0)
  const wbtcUsd = formatUsdRounded(wbtc, collateralAsset.decimals, btcUsd)

  return (
    <AppShell
      section='Wallet — Overview'
      title={active?.name ?? 'Your wallet'}
      lede={`${collateralAsset.symbol} is your collateral and pays network fees; ${principalAsset.symbol} is what you lend and repay. The same phrase opens this wallet in the Wharfedale web app.`}
      aside={
        active ? (
          <div className='stack-md'>
            <div className='row'>
              {state === 'synced' ? (
                <Badge tone='good'>Synced</Badge>
              ) : state === 'error' ? (
                <Badge tone='danger'>Sync error</Badge>
              ) : (
                <Badge tone='warn'>Syncing</Badge>
              )}
            </div>
            <nav aria-label='Wallet actions' className='row row--links'>
              <Link to={RoutePath.WalletNew} className='text-button'>
                New
              </Link>
              <Link to={RoutePath.WalletImport} className='text-button'>
                Import
              </Link>
              <Link to={RoutePath.WalletBackup} className='text-button'>
                Back up
              </Link>
            </nav>
          </div>
        ) : undefined
      }
    >
      {!active ? (
        <NoWallet />
      ) : (
        <div className='split'>
          <div className='split__main stack-xl'>
            <section className='stack-md'>
              <SectionHeading label='Assets' title='Balances' />
              <ul className='asset-list'>
                <li className='asset-row'>
                  <div className='asset-row__name'>
                    <span className='index__title'>Wrapped Bitcoin</span>
                    <span className='data'>
                      {collateralAsset.symbol}
                      {wbtcUsd ? ` · ≈ ${wbtcUsd}` : ''}
                      {pending(collateralAsset.id) > 0n
                        ? ` · +${formatFixed(pending(collateralAsset.id), 8)} pending`
                        : ''}
                    </span>
                  </div>
                  <div className='asset-row__amount'>
                    {formatFixed(wbtc, collateralAsset.decimals)}
                    <span className='amount__unit'>{collateralAsset.symbol}</span>
                  </div>
                </li>
                <li className='asset-row'>
                  <div className='asset-row__name'>
                    <span className='index__title'>{principalAsset.symbol}</span>
                    <span className='data'>
                      {principalAsset.symbol}
                      {pending(principalAsset.id) > 0n
                        ? ` · +${formatPrincipal(pending(principalAsset.id))} pending`
                        : ''}
                    </span>
                  </div>
                  <div className='asset-row__amount'>
                    {formatPrincipal(usdt)}
                    <span className='amount__unit'>{principalAsset.symbol}</span>
                  </div>
                </li>
              </ul>
              {error && <p className='notice notice--danger'>{error}</p>}
            </section>
          </div>
          <aside className='split__aside sticky stack-lg'>
            <div className='panel panel--dark on-dark stack-md'>
              <div className='row row--between'>
                <span className='label label--mark'>Receive</span>
                <span className='badge'>confidential</span>
              </div>
              {receiveAddress ? (
                <>
                  <div className='qr-plate qr-plate--small'>
                    <QRCodeSVG
                      value={receiveAddress}
                      size={132}
                      level='M'
                      title='QR code of this address'
                    />
                  </div>
                  <p className='mono address-line' title={receiveAddress}>
                    {shortId(receiveAddress, 18, 12)}
                  </p>
                  <div className='button-row'>
                    <CopyButton value={receiveAddress} label='address' className='button accent'>
                      Copy address
                    </CopyButton>
                    {NETWORK_CONFIG.faucetUrl && (
                      <a
                        className='button outline-light'
                        href={NETWORK_CONFIG.faucetUrl}
                        target='_blank'
                        rel='noreferrer'
                      >
                        Get {collateralAsset.symbol} ↗
                      </a>
                    )}
                  </div>
                </>
              ) : (
                <p className='hint'>The address appears once the wallet is open.</p>
              )}
            </div>
          </aside>
        </div>
      )}
    </AppShell>
  )
}

export function WalletNewPage() {
  const { store } = useWallets()
  const navigate = useNavigate()
  const [phrase, setPhrase] = useState(() => requireWasm().generateMnemonic(12))
  const [name, setName] = useState(() => suggestedWalletName(store))
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, copy] = useCopyToClipboard()

  const create = () => {
    try {
      wallets.add({ name, phrase, secret: secretFromPhrase(phrase) })
      navigate(RoutePath.Wallet)
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <AppShell
      section='Wallet — New'
      title='Your recovery phrase'
      lede='Write these 12 words down, in order. They restore this wallet, and every loan it is part of, in any browser.'
      back={{ to: RoutePath.Wallet, label: 'Wallet' }}
    >
      <div className='split'>
        <div className='split__main stack-lg'>
          <ol className='phrase' aria-label='Recovery phrase'>
            {phrase.split(' ').map((word, index) => (
              <li key={`${index}-${word}`} style={{ animationDelay: `${index * 35}ms` }}>
                <span className='n'>{String(index + 1).padStart(2, '0')}</span>
                <span className='w'>{word}</span>
              </li>
            ))}
          </ol>
          <div className='button-row'>
            <button className='button secondary' type='button' onClick={() => copy(phrase)}>
              {copied ? 'Copied' : 'Copy words'}
            </button>
            <button
              className='button secondary'
              type='button'
              onClick={() => downloadKeyFile(secretFromPhrase(phrase))}
            >
              Download key file
            </button>
            <button
              className='button secondary'
              type='button'
              onClick={() => {
                setPhrase(requireWasm().generateMnemonic(12))
                setSaved(false)
              }}
            >
              New phrase
            </button>
          </div>
        </div>
        <div className='split__aside sticky stack-lg'>
          <span className='label label--mark'>Save it</span>
          <div className='field'>
            <label htmlFor='wallet-name'>Wallet name</label>
            <input
              id='wallet-name'
              className='input'
              maxLength={64}
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <label className='check'>
            <input type='checkbox' checked={saved} onChange={e => setSaved(e.target.checked)} />I
            wrote the words down in order
          </label>
          {error && <p className='notice notice--danger'>{error}</p>}
          <button
            className='button primary button--lg button--full'
            type='button'
            disabled={!saved || !name.trim()}
            onClick={create}
          >
            Create wallet <ArrowRight />
          </button>
          <p className='hint'>{KEY_PATH_HINT}</p>
        </div>
      </div>
    </AppShell>
  )
}

export function WalletImportPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'phrase' | 'key'>('phrase')
  const [text, setText] = useState('')
  const [name, setName] = useState('imported')
  const [error, setError] = useState<string | null>(null)
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  let phraseValid = false
  if (tab === 'phrase' && (words === 12 || words === 24)) {
    try {
      secretFromPhrase(text)
      phraseValid = true
    } catch {
      phraseValid = false
    }
  }

  const importWallet = () => {
    setError(null)
    try {
      if (tab === 'phrase') wallets.add({ name, phrase: text, secret: secretFromPhrase(text) })
      else wallets.add({ name, secret: secretFromKeyText(text) })
      navigate(RoutePath.Wallet)
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <AppShell
      section='Wallet — Import'
      title='Import a wallet'
      lede='From its recovery phrase, such as your Wharfedale web wallet’s, or from a key file. It stays in this browser.'
      back={{ to: RoutePath.Wallet, label: 'Wallet' }}
    >
      <div className='split'>
        <div className='split__main stack-lg'>
          <div className='chips' role='group' aria-label='Import from'>
            <button
              className='chip'
              type='button'
              aria-pressed={tab === 'phrase'}
              onClick={() => setTab('phrase')}
            >
              Recovery phrase
            </button>
            <button
              className='chip'
              type='button'
              aria-pressed={tab === 'key'}
              onClick={() => setTab('key')}
            >
              Key file or secret
            </button>
          </div>
          <div className='field'>
            <label htmlFor='wallet-secret'>
              {tab === 'phrase'
                ? '12 or 24 words, separated by spaces'
                : 'Key file contents ({"secret": "…"}) or 64 hex characters'}
            </label>
            <textarea
              id='wallet-secret'
              className='textarea'
              rows={5}
              spellCheck={false}
              autoComplete='off'
              autoCapitalize='none'
              value={text}
              onChange={e => setText(e.target.value)}
            />
            {tab === 'phrase' && words > 0 && (
              <span>
                <Badge tone={phraseValid ? 'good' : 'neutral'}>
                  {words} words · {phraseValid ? 'checksum valid' : 'not a valid phrase yet'}
                </Badge>
              </span>
            )}
            {tab === 'key' && (
              <label className='button secondary' style={{ alignSelf: 'flex-start' }}>
                Open key file…
                <input
                  type='file'
                  accept='application/json,.json'
                  className='sr-only'
                  onChange={async e => setText((await e.target.files?.[0]?.text()) ?? '')}
                />
              </label>
            )}
          </div>
        </div>
        <div className='split__aside sticky stack-lg'>
          <span className='label label--mark'>Name it</span>
          <div className='field'>
            <label htmlFor='wallet-import-name'>Wallet name</label>
            <input
              id='wallet-import-name'
              className='input'
              maxLength={64}
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          {error && <p className='notice notice--danger'>{error}</p>}
          <button
            className='button primary button--lg button--full'
            type='button'
            disabled={!name.trim() || (tab === 'phrase' ? !phraseValid : !text.trim())}
            onClick={importWallet}
          >
            Import <ArrowRight />
          </button>
          <p className='hint'>{KEY_PATH_HINT}</p>
        </div>
      </div>
    </AppShell>
  )
}

export function WalletBackupPage() {
  const { active } = useWallets()
  const navigate = useNavigate()
  const [revealed, setRevealed] = useState(false)
  const [copied, copy] = useCopyToClipboard()

  if (!active) {
    return (
      <AppShell
        section='Wallet — Back up'
        title='No wallet'
        back={{ to: RoutePath.Wallet, label: 'Wallet' }}
      >
        <NoWallet />
      </AppShell>
    )
  }

  return (
    <AppShell
      section='Wallet — Back up'
      title={`Back up ${active.name}`}
      lede='Anyone who sees the recovery phrase or the key file can spend this wallet and settle its loans. Reveal them only where nobody is watching.'
      back={{ to: RoutePath.Wallet, label: 'Wallet' }}
    >
      <div className='part'>
        <div className='part__head'>
          <span className='index-no'>01</span>
          <h2 className='h2'>Recovery phrase</h2>
          <p className='hint'>
            Restores this wallet and its loans anywhere: the borrower and lender tokens are coins at
            this address.
          </p>
        </div>
        <div className='part__body'>
          {!active.phrase ? (
            <p className='hint'>
              This wallet was imported from a key, so it has no phrase. Keep its key file.
            </p>
          ) : revealed ? (
            <div className='stack-md'>
              <ol className='phrase' aria-label='Recovery phrase'>
                {active.phrase.split(' ').map((word, index) => (
                  <li key={`${index}-${word}`}>
                    <span className='n'>{String(index + 1).padStart(2, '0')}</span>
                    <span className='w'>{word}</span>
                  </li>
                ))}
              </ol>
              <div className='button-row'>
                <button
                  className='button secondary'
                  type='button'
                  onClick={() => copy(active.phrase ?? '')}
                >
                  {copied ? 'Copied' : 'Copy words'}
                </button>
                <button
                  className='button secondary'
                  type='button'
                  onClick={() => setRevealed(false)}
                >
                  Hide
                </button>
              </div>
            </div>
          ) : (
            <div className='sealed on-dark'>
              <span className='label'>{active.phrase.split(' ').length} words, sealed</span>
              <button className='button accent' type='button' onClick={() => setRevealed(true)}>
                Reveal phrase
              </button>
            </div>
          )}
        </div>
      </div>
      <div className='part'>
        <div className='part__head'>
          <span className='index-no'>02</span>
          <h2 className='h2'>Key file</h2>
          <p className='hint'>
            {'{"secret"}'} JSON for the Wharfedale web app, the CLI and the SDKs. It holds the key,
            not the phrase.
          </p>
        </div>
        <div className='part__body'>
          <button
            className='button secondary button--lg'
            type='button'
            onClick={() => downloadKeyFile(active.secret)}
          >
            Download key file
          </button>
        </div>
      </div>
      <div className='part'>
        <div className='part__head'>
          <span className='index-no'>03</span>
          <h2 className='h2'>Remove from this browser</h2>
          <p className='hint'>
            Funds and loans stay on chain; import the phrase again to restore them.
          </p>
        </div>
        <div className='part__body'>
          <button
            className='button danger button--lg'
            type='button'
            onClick={() => {
              if (
                !window.confirm(
                  `Remove ${active.name} from this browser? Without its phrase or key file it can't be restored.`,
                )
              )
                return
              wallets.remove(active.name)
              navigate(RoutePath.Wallet)
            }}
          >
            Remove {active.name}
          </button>
        </div>
      </div>
    </AppShell>
  )
}
