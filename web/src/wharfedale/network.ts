import type { AssetId } from './types'

/** A Wharfedale chain: its fee asset (WBTC on the demo chain) and genesis hash. */
export class Network {
  constructor(
    private readonly feeAsset: AssetId,
    /** Display hex. */
    readonly genesisHash: string,
  ) {}

  /** The fee asset: fees, wallet funding, change. */
  policyAsset(): AssetId {
    return this.feeAsset
  }
}
