import type { AssetId, OutPoint } from '@/wharfedale/types'

export type ConnectionStatus = 'disconnected' | 'locked' | 'ready' | 'error'

export interface WalletCoin {
  outpoint(): OutPoint
  /** Undefined while unconfirmed. */
  height(): number | undefined
  unblinded(): { asset(): AssetId; value(): bigint }
}
