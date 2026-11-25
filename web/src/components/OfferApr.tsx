import { useBlockTimestamps } from '@/api/esplora/hooks'
import type { OfferShort } from '@/api/indexer/schemas'
import { computeApr, getOfferDurationSeconds } from '@/utils/offers'

/**
 * An offer's APR. Its term runs from the creation block's timestamp (loaded here, so the cell
 * updates on its own) to the expiry.
 */
export function OfferApr({ offer }: { offer: OfferShort }) {
  const createdTimes = useBlockTimestamps([offer.created_at_height])
  const created = createdTimes[offer.created_at_height]
  if (created === undefined) return <>–</>
  return <>{computeApr(offer.interest_rate, getOfferDurationSeconds(offer, created)).toFixed(2)}%</>
}
