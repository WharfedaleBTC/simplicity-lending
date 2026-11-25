import { useCallback, useEffect, useRef, useState } from 'react'

import { useSessionStorage } from '@/hooks/useSessionStorage'
import { readCoinBalances } from '@/lib/wallet-core/wallet/sync'
import { useChain } from '@/providers/chain/useChain'
import type { TxSpec } from '@/wharfedale/tx'
import type { Address, Transaction } from '@/wharfedale/types'
import { type CompletedTransaction, SeedWallet } from '@/wharfedale/wallet'

import {
  type CachePolicy,
  INITIAL_WALLET_STATE,
  type SavedSession,
  type WalletState,
} from './types'
import { WalletContext } from './WalletContext'

const SESSION_STORAGE_KEY = 'wharfedale_lending_wallet'
const BALANCE_POLL_INTERVAL_MS = 15_000
// The node indexes a transaction within a block (about a second when there's work).
const POST_BROADCAST_SYNC_MS = [1_500, 4_000]

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { chainNetwork } = useChain()
  const walletRef = useRef<SeedWallet | null>(null)
  const syncInFlightRef = useRef<Promise<void> | null>(null)

  const [state, setState] = useState<WalletState>(INITIAL_WALLET_STATE)
  const [savedSession, setSavedSession] = useSessionStorage<SavedSession>(SESSION_STORAGE_KEY)

  const requireWallet = useCallback((): SeedWallet => {
    const wallet = walletRef.current
    if (!wallet) throw new Error('Wallet is not connected')
    return wallet
  }, [])

  const sync = useCallback((): Promise<void> => {
    if (syncInFlightRef.current) return syncInFlightRef.current
    const wallet = walletRef.current
    if (!wallet) return Promise.reject(new Error('Wallet is not connected'))
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

  const connect = useCallback(
    async (mnemonic: string) => {
      setState(s => ({ ...s, error: null, isError: false }))
      let wallet: SeedWallet
      try {
        wallet = SeedWallet.fromMnemonic(mnemonic)
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        setState(s => ({ ...s, error, isError: true }))
        throw err
      }
      walletRef.current = wallet
      setSavedSession({ mnemonic })
      setState(s => ({
        ...s,
        connectionStatus: 'ready',
        connectorId: wallet.info.xonlyPublicKey,
        signerType: 'seed',
        receiveAddress: wallet.info.address,
        scriptPubkey: wallet.info.scriptPubkey,
      }))
      await sync().catch(console.warn)
    },
    [setSavedSession, sync],
  )

  const disconnect = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (_options: { cachePolicy?: CachePolicy } = {}) => {
      walletRef.current = null
      syncInFlightRef.current = null
      setSavedSession(null)
      setState(INITIAL_WALLET_STATE)
    },
    [setSavedSession],
  )

  // Reconnect within the tab's session.
  const resumedRef = useRef(false)
  useEffect(() => {
    if (resumedRef.current || !savedSession || state.connectionStatus !== 'disconnected') return
    resumedRef.current = true
    setState(s => ({ ...s, reconnecting: true }))
    connect(savedSession.mnemonic)
      .catch(() => disconnect())
      .finally(() => setState(s => ({ ...s, reconnecting: false })))
  }, [savedSession, state.connectionStatus, connect, disconnect])

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

  return (
    <WalletContext.Provider
      value={{
        ...state,
        isReady: state.connectionStatus === 'ready',
        connect,
        cancelPendingRequest: async () => {},
        disconnect,
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
