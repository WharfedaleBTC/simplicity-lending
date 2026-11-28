import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { readCoinBalances } from '@/lib/wallet-core/wallet/sync'
import { useWallets } from '@/lib/wallets'
import { useChain } from '@/providers/chain/useChain'
import type { TxSpec } from '@/wharfedale/tx'
import type { Address, Transaction } from '@/wharfedale/types'
import { type CompletedTransaction, SeedWallet } from '@/wharfedale/wallet'

import { INITIAL_WALLET_STATE, type WalletState } from './types'
import { WalletContext } from './WalletContext'

const BALANCE_POLL_INTERVAL_MS = 15_000
// The node indexes a transaction within a block (about a second when there's work).
const POST_BROADCAST_SYNC_MS = [1_500, 4_000]

function openWallet(secret: string | null): { wallet: SeedWallet | null; state: WalletState } {
  if (!secret) return { wallet: null, state: INITIAL_WALLET_STATE }
  try {
    const wallet = SeedWallet.fromSecret(secret)
    return {
      wallet,
      state: {
        ...INITIAL_WALLET_STATE,
        connectionStatus: 'ready',
        connectorId: wallet.info.xonlyPublicKey,
        signerType: 'seed',
        receiveAddress: wallet.info.address,
        scriptPubkey: wallet.info.scriptPubkey,
        syncing: true,
      },
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return {
      wallet: null,
      state: { ...INITIAL_WALLET_STATE, connectionStatus: 'error', error, isError: true },
    }
  }
}

/** The active wallet of this browser's list (lib/wallets): opened, synced and polled. */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { chainNetwork } = useChain()
  const { active } = useWallets()
  const walletRef = useRef<SeedWallet | null>(null)
  const syncInFlightRef = useRef<Promise<void> | null>(null)
  const [state, setState] = useState<WalletState>(INITIAL_WALLET_STATE)

  const requireWallet = useCallback((): SeedWallet => {
    const wallet = walletRef.current
    if (!wallet) throw new Error('No wallet is open')
    return wallet
  }, [])

  const sync = useCallback((): Promise<void> => {
    if (syncInFlightRef.current) return syncInFlightRef.current
    const wallet = walletRef.current
    if (!wallet) return Promise.reject(new Error('No wallet is open'))
    setState(s => ({ ...s, syncing: true, error: null }))
    const promise = wallet
      .coins()
      .then(coins => {
        if (walletRef.current !== wallet) return
        const { total, confirmed, pending } = readCoinBalances(coins)
        setState(s => ({
          ...s,
          syncing: false,
          balances: total,
          confirmedBalances: confirmed,
          pendingBalances: pending,
          error: null,
          isError: false,
        }))
      })
      .catch(err => {
        const error = err instanceof Error ? err.message : String(err)
        setState(s => ({ ...s, syncing: false, error, isError: true }))
        throw err
      })
      .finally(() => {
        syncInFlightRef.current = null
      })
    syncInFlightRef.current = promise
    return promise
  }, [])

  // Open the active wallet whenever it changes: its state resets as the render sees the new
  // secret, and the effect points the ref at it and syncs.
  const secret = active?.secret ?? null
  const opened = useMemo(() => openWallet(secret), [secret])
  const [openedSecret, setOpenedSecret] = useState<string | null>(null)
  if (secret !== openedSecret) {
    setOpenedSecret(secret)
    setState(opened.state)
  }
  useEffect(() => {
    walletRef.current = opened.wallet
    syncInFlightRef.current = null
    if (opened.wallet) sync().catch(console.warn)
  }, [opened, sync])

  useEffect(() => {
    if (state.connectionStatus !== 'ready') return
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') sync().catch(console.warn)
    }, BALANCE_POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [state.connectionStatus, sync])

  const applyBroadcastTransaction = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (_tx: Transaction) => {
      for (const delay of POST_BROADCAST_SYNC_MS) {
        setTimeout(() => sync().catch(console.warn), delay)
      }
    },
    [sync],
  )

  const getBlindedWalletUtxos = useCallback(() => requireWallet().coins(), [requireWallet])

  const completeTransaction = useCallback(
    async (spec: TxSpec, feeRateSatPerKvb: number): Promise<CompletedTransaction> => {
      const wallet = requireWallet()
      const coins = spec.strict ? [] : await wallet.coins()
      const feeCoins = coins.filter(
        c => c.height() !== undefined && c.unblinded().asset().equals(chainNetwork.policyAsset()),
      )
      return wallet.complete(spec, chainNetwork, feeRateSatPerKvb, feeCoins)
    },
    [requireWallet, chainNetwork],
  )

  const getReceiveAddress = useCallback(
    async (): Promise<string | null> => walletRef.current?.info.address ?? null,
    [],
  )

  const getChangeAddress = useCallback(
    async (): Promise<Address> => requireWallet().receiveAddress(),
    [requireWallet],
  )

  const verifyReceiveAddress = useCallback(
    async (): Promise<string> => requireWallet().info.address,
    [requireWallet],
  )

  const isReady = state.connectionStatus === 'ready'
  return (
    <WalletContext.Provider
      value={{
        ...state,
        isReady,
        walletName: active?.name ?? null,
        recoveryPhrase: isReady ? (active?.phrase ?? null) : null,
        syncWallet: sync,
        applyBroadcastTransaction,
        completeTransaction,
        getBlindedWalletUtxos,
        getReceiveAddress,
        getChangeAddress,
        verifyReceiveAddress,
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}
