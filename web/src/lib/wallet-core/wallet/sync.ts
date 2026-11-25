import type { WalletCoin } from '@/lib/wallet-core/types'
import { isConfirmedWalletUtxo } from '@/wharfedale/utxo'

export interface WalletBalances {
  total: Record<string, string>
  confirmed: Record<string, string>
  /** total - confirmed per assetId. Only present for assets with a nonzero pending amount. */
  pending: Record<string, string>
}

function toWalletBalances(totals: Map<string, bigint>, coins: WalletCoin[]): WalletBalances {
  const confirmedAmounts = new Map<string, bigint>()
  for (const coin of coins) {
    if (!isConfirmedWalletUtxo(coin)) continue
    const unblinded = coin.unblinded()
    const assetId = unblinded.asset().toString()
    confirmedAmounts.set(assetId, (confirmedAmounts.get(assetId) ?? 0n) + unblinded.value())
  }

  const total: Record<string, string> = {}
  const pending: Record<string, string> = {}
  for (const [assetId, totalAmount] of totals) {
    total[assetId] = totalAmount.toString()
    const pendingAmount = totalAmount - (confirmedAmounts.get(assetId) ?? 0n)
    if (pendingAmount !== 0n) pending[assetId] = pendingAmount.toString()
  }
  const confirmed: Record<string, string> = {}
  for (const [assetId, amount] of confirmedAmounts) {
    confirmed[assetId] = amount.toString()
  }

  return { total, confirmed, pending }
}

export function readCoinBalances(coins: WalletCoin[]): WalletBalances {
  const totals = new Map<string, bigint>()
  for (const coin of coins) {
    const unblinded = coin.unblinded()
    const assetId = unblinded.asset().toString()
    totals.set(assetId, (totals.get(assetId) ?? 0n) + unblinded.value())
  }
  return toWalletBalances(totals, coins)
}
