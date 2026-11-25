import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import { STALE_TIME_MS } from '../staleTime'
import { fetchPricesUsd } from './methods'
import { pricesQueryKeys } from './queryKeys'
import type { AssetPricesUsd } from './schemas'

export function usePricesUsd(): UseQueryResult<AssetPricesUsd> {
  return useQuery({
    queryKey: pricesQueryKeys.usd,
    queryFn: ({ signal }) => fetchPricesUsd({ signal }),
    staleTime: STALE_TIME_MS.short,
    refetchInterval: STALE_TIME_MS.short,
  })
}

export function useAssetPriceUsd(assetId: string): number | null {
  const { data } = usePricesUsd()
  return data?.[assetId] ?? null
}
