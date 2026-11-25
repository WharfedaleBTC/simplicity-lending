// Active loans with less than this left (seconds) are "nearing deadline".
export const REPAYMENT_DUE_THRESHOLD_SECONDS = 144 * 60

export const BPS_DIVISOR = 10_000n

export const PROTOCOL_FEE_BPS = 1000

export const PROTOCOL_FEE_LABEL = `Protocol Fee (${PROTOCOL_FEE_BPS / 100}%)`

export const PROTOCOL_FEE_TOOLTIP = 'A fixed 10% protocol fee\ndeducted from the lender fee.'

export const APR_TOOLTIP =
  'The annualized rate, based on the fee, loan amount, and term. The protocol fee is not included.'
