// Figures of one offer: interest, what the lender keeps, LTV and APR, and the inputs they need.
import { useBlockTimestamps } from '@/api/esplora/hooks'
import type { OfferShort } from '@/api/indexer/schemas'
import { useAssetPriceUsd } from '@/api/prices/hooks'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { calcInterest, computeApr, computeLtv, computeProtocolFee } from '@/utils/offers'

export function offerInterest(offer: OfferShort): bigint {
  return calcInterest(offer.principal_amount, offer.interest_rate)
}

/** What the lender keeps of the interest after the protocol fee. */
export function lenderInterest(offer: OfferShort): bigint {
  const interest = offerInterest(offer)
  return interest - computeProtocolFee(interest)
}

export function offerLtv(offer: OfferShort, btcUsd: number | null): number | null {
  return computeLtv({
    principal: offer.principal_amount,
    principalDecimals: NETWORK_CONFIG.principalAsset.decimals,
    collateral: offer.collateral_amount,
    collateralDecimals: NETWORK_CONFIG.collateralAsset.decimals,
    collateralUsd: btcUsd,
  })
}

export function offerApr(offer: OfferShort, createdAt: number | undefined): number | null {
  if (createdAt === undefined) return null
  return computeApr(offer.interest_rate, offer.loan_expiration_time - createdAt)
}

export function useCreatedTimes(offers: OfferShort[]): Record<number, number> {
  return useBlockTimestamps(offers.map(offer => offer.created_at_height))
}

export function useBtcUsd(): number | null {
  return useAssetPriceUsd(NETWORK_CONFIG.collateralAsset.id)
}
