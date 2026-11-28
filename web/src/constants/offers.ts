// Active loans with less than this left (seconds) are "nearing deadline".
export const REPAYMENT_DUE_THRESHOLD_SECONDS = 144 * 60

export const BPS_DIVISOR = 10_000n

export const PROTOCOL_FEE_BPS = 1000

/** The highest loan-to-value an offer may ask for (priced at the live BTC/USD). */
export const MAX_LTV = 0.55
export const MAX_LTV_PERCENT = Math.round(MAX_LTV * 100)
