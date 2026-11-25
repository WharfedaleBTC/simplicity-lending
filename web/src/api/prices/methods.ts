import { NETWORK_CONFIG } from '@/constants/network-config'
import { ErrorHandler } from '@/utils/errorHandler'

import { requestJson, type RequestParams } from '../client'
import { ApiAbortError } from '../errors'
import { type AssetPricesUsd, coinbaseSpotSchema } from './schemas'

/** BTC/USD spot from Coinbase's public API: no key, and it allows any origin. */
export const BTC_USD_URL = 'https://api.coinbase.com/v2/prices/BTC-USD/spot'

/** The live BTC/USD price, or null if it can't be fetched. */
export async function fetchBtcUsd(options: RequestParams = {}): Promise<number | null> {
  try {
    const { data } = await requestJson(BTC_USD_URL, coinbaseSpotSchema, {
      signal: options.signal,
    })
    const price = Number(data.amount)
    return Number.isFinite(price) && price > 0 ? price : null
  } catch (error) {
    if (error instanceof ApiAbortError) throw error
    ErrorHandler.processWithoutFeedback(error)
    return null
  }
}

/**
 * USD prices per asset id, for LTV and USD figures in the UI (the contracts don't use prices).
 * WBTC follows the live BTC/USD price; the deployment's /config.json (`pricesUsd`) gives the
 * principal's price, and WBTC's when the live price can't be fetched.
 */
export async function fetchPricesUsd(options: RequestParams = {}): Promise<AssetPricesUsd> {
  const prices = { ...NETWORK_CONFIG.pricesUsd }
  const btcUsd = await fetchBtcUsd(options)
  if (btcUsd !== null) prices[NETWORK_CONFIG.collateralAsset.id] = btcUsd
  return prices
}
