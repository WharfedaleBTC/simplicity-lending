import { useWallets } from '@/lib/wallets'
import { useWallet } from '@/providers/wallet/useWallet'

export type ChipState = 'none' | 'error' | 'loading' | 'synced'

export const CHIP_STATE_LABEL: Record<ChipState, string> = {
  none: 'No wallet',
  error: 'Sync error',
  loading: 'Syncing',
  synced: 'Synced',
}

export function useWalletChipState(): ChipState {
  const { isReady, isError, syncing, balances } = useWallet()
  const { active } = useWallets()
  if (!active) return 'none'
  if (isError) return 'error'
  if (!isReady || (syncing && Object.keys(balances).length === 0)) return 'loading'
  return 'synced'
}
