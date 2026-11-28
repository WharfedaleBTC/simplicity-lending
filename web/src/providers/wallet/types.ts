import type { ConnectionStatus, WalletCoin } from '@/lib/wallet-core/types'
import type { TxSpec } from '@/wharfedale/tx'
import type { Address, Transaction } from '@/wharfedale/types'
import type { CompletedTransaction } from '@/wharfedale/wallet'

export interface WalletContextValue extends WalletState {
  isReady: boolean
  /** The active wallet's name in this browser's wallet list, or null with none. */
  walletName: string | null
  /** The active wallet's recovery phrase, for backing it up; null for one imported from a key. */
  recoveryPhrase: string | null
  syncWallet(): Promise<void>
  /** Re-reads coins soon after a broadcast (the node indexes it within a block). */
  applyBroadcastTransaction(tx: Transaction): void
  /** Funds (wallet fee-asset coins, change, fee), blinds, signs and satisfies `spec`. */
  completeTransaction(spec: TxSpec, feeRateSatPerKvb: number): Promise<CompletedTransaction>
  getBlindedWalletUtxos(): Promise<WalletCoin[]>
  getReceiveAddress(): Promise<string | null>
  getChangeAddress(): Promise<Address>
  verifyReceiveAddress(): Promise<string>
}

export type WalletSignerType = 'seed'

export interface WalletState {
  connectionStatus: ConnectionStatus
  connectorId: string | null
  signerType: WalletSignerType | null
  balances: Record<string, string>
  confirmedBalances: Record<string, string>
  pendingBalances: Record<string, string>
  // Resolved once on connect; null until ready.
  receiveAddress: string | null
  scriptPubkey: string | null
  syncing: boolean
  reconnecting: boolean
  /** Last error message. Persists even after isError is cleared. */
  error: string | null
  /** Whether the error should be shown to the user. Cleared on reconnect or new connect attempt. */
  isError: boolean
}

export const INITIAL_WALLET_STATE: WalletState = {
  connectionStatus: 'disconnected',
  connectorId: null,
  signerType: null,
  balances: {},
  confirmedBalances: {},
  pendingBalances: {},
  receiveAddress: null,
  scriptPubkey: null,
  syncing: false,
  reconnecting: false,
  error: null,
  isError: false,
}
