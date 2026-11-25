import type { NetworkName } from '@/constants/env'
import type { Network } from '@/wharfedale/network'

export interface ChainContextValue {
  chainNetwork: Network
  network: NetworkName
}
