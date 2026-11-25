import type { AssetAmount, OfferShort } from '@/api/indexer/schemas'
import { BPS_DIVISOR, PROTOCOL_FEE_BPS } from '@/constants/offers'

import { formatTermLeft } from './format'
import { normalizeHex } from './hex'

// Wharfedale loans end at a unix time (the covenant's time lock), not a block height: blocks
// come only when there is work, so heights don't measure time.
const SECONDS_PER_DAY = 24 * 60 * 60
const SECONDS_PER_YEAR = 365 * SECONDS_PER_DAY

export function calcInterest(principal: bigint, bps: number): bigint {
  return (principal * BigInt(Math.round(bps))) / BPS_DIVISOR
}

export function computeProtocolFee(feeBaseUnits: bigint): bigint {
  return (feeBaseUnits * BigInt(PROTOCOL_FEE_BPS)) / BPS_DIVISOR
}

export function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`
}

export function daysToSeconds(days: number): number {
  return Math.round(days * SECONDS_PER_DAY)
}

export function feeToBps(feeBaseUnits: bigint, principalBaseUnits: bigint): number {
  if (principalBaseUnits <= 0n) return 0
  return Number((feeBaseUnits * BPS_DIVISOR) / principalBaseUnits)
}

export function computeApr(bps: number, loanDurationSeconds: number): number {
  if (loanDurationSeconds <= 0) return 0
  return (bps / Number(BPS_DIVISOR)) * (SECONDS_PER_YEAR / loanDurationSeconds) * 100
}

export function computeLtv({
  principal,
  principalDecimals,
  collateral,
  collateralDecimals,
  collateralUsd,
}: {
  principal: bigint
  principalDecimals: number
  collateral: bigint
  collateralDecimals: number
  collateralUsd: number | null
}): number | null {
  if (collateralUsd === null || collateral <= 0n) return null
  const principalValue = Number(principal) / 10 ** principalDecimals
  const collateralValue = (Number(collateral) / 10 ** collateralDecimals) * collateralUsd
  return principalValue / collateralValue
}

/** Seconds until the loan expires (negative once expired). */
export function getOfferTermLeft(offer: OfferShort, currentTime: number): number {
  return offer.loan_expiration_time - currentTime
}

export function formatOfferTermLeft(offer: OfferShort, currentTime: number | null): string {
  if (!currentTime) return '–'
  return formatTermLeft(getOfferTermLeft(offer, currentTime))
}

export function findAssetAmount(amounts: AssetAmount[], assetId: string): bigint {
  return amounts.find(a => normalizeHex(a.asset) === normalizeHex(assetId))?.amount ?? 0n
}

/**
 * The loan's term in seconds: from its creation block's timestamp to its expiry. Unknown
 * (0) until that timestamp has loaded.
 */
export function getOfferDurationSeconds(offer: OfferShort, createdAt: number | undefined): number {
  return createdAt === undefined ? 0 : offer.loan_expiration_time - createdAt
}

/** Unix seconds → local date and time. */
export function formatUnixTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
