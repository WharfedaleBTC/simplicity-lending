// Amounts as the pages show them: fixed decimals (0.03000000 WBTC, 1,000.00 USDT), grouped.
import { NETWORK_CONFIG } from '@/constants/network-config'
import type { PolicyAssetDenomination } from '@/providers/assetDenomination/constants'

const LOCALE = 'en-US'

/** Base units → a grouped decimal string with all `decimals` places. */
export function formatFixed(amount: bigint, decimals: number): string {
  const negative = amount < 0n
  const abs = negative ? -amount : amount
  const base = 10n ** BigInt(decimals)
  const whole = (abs / base).toLocaleString(LOCALE)
  const frac = decimals > 0 ? `.${(abs % base).toString().padStart(decimals, '0')}` : ''
  return `${negative ? '-' : ''}${whole}${frac}`
}

/** WBTC in the chosen unit: 8 decimals, or whole sats. */
export function formatWbtc(amount: bigint, denomination: PolicyAssetDenomination): string {
  if (denomination === 'sats') return amount.toLocaleString(LOCALE)
  return formatFixed(amount, NETWORK_CONFIG.collateralAsset.decimals)
}

export function wbtcUnit(denomination: PolicyAssetDenomination): string {
  return denomination === 'sats'
    ? NETWORK_CONFIG.policyAssetSatsUnit
    : NETWORK_CONFIG.collateralAsset.symbol
}

export function formatPrincipal(amount: bigint): string {
  return formatFixed(amount, NETWORK_CONFIG.principalAsset.decimals)
}

export const principalSymbol = (): string => NETWORK_CONFIG.principalAsset.symbol

/** USD value of base units at `price` per whole unit, rounded to dollars; null without a price. */
export function formatUsdRounded(
  amount: bigint,
  decimals: number,
  price: number | null | undefined,
): string | null {
  if (price === null || price === undefined) return null
  const value = (Number(amount) / 10 ** decimals) * price
  if (!Number.isFinite(value)) return null
  return `$${Math.round(value).toLocaleString(LOCALE)}`
}

export function formatPercent(value: number, digits = 2): string {
  return `${value.toFixed(digits)}%`
}

/** Seconds → "1 h 52 m", "29 d", "3 h": the largest two units that matter. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(Math.abs(seconds)))
  const days = Math.floor(s / 86_400)
  const hours = Math.floor((s % 86_400) / 3_600)
  const minutes = Math.floor((s % 3_600) / 60)
  if (days >= 2) return `${Math.round(s / 86_400)} d`
  if (days === 1) return hours ? `1 d ${hours} h` : '1 d'
  if (hours >= 1) return minutes ? `${hours} h ${minutes} m` : `${hours} h`
  if (minutes >= 1) return `${minutes} m`
  return `${s} s`
}

/** Unix seconds → "28 Nov 2026, 16:10" (local time). */
export function formatDateTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Unix seconds → "28 Nov, 16:10" (local time). */
export function formatShortDateTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** An offer's label: "#12" for the indexer's numeric ids, else the id shortened. */
export function offerLabel(id: string): string {
  return /^\d+$/.test(id) ? `#${id}` : shortId(id)
}

/** A hash or id shortened to its ends: "a3f2…91c0". */
export function shortId(value: string, start = 4, end = 4): string {
  if (value.length <= start + end + 1) return value
  return `${value.slice(0, start)}…${value.slice(-end)}`
}
