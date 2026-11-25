import type { AssetId, OutPoint } from '@/wharfedale/types'

export type ConnectionStatus = 'disconnected' | 'locked' | 'ready'

export interface WalletCoin {
  outpoint(): OutPoint
  /** Undefined while unconfirmed. */
  height(): number | undefined
  unblinded(): { asset(): AssetId; value(): bigint }
}
