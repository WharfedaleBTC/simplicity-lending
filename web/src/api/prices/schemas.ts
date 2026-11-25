import { z as zod } from 'zod'

/** Coinbase's public spot price: `{"data":{"amount":"58478.24","base":"BTC","currency":"USD"}}`. */
export const coinbaseSpotSchema = zod.object({
  data: zod.object({
    amount: zod.string(),
    base: zod.literal('BTC'),
    currency: zod.literal('USD'),
  }),
})

export type AssetPricesUsd = Record<string, number>
