// Issued assets. Liquid's ELIP-0100 asset registry doesn't exist on Wharfedale, so the
// lending flow issues its factory asset and NFTs without a contract (zero contract hash).
import type { OutPoint } from './types'
import { AssetId } from './types'
import { call } from './wasm'

/** Protocol assets the lending flow issues. */
export const AssetKind = {
  Factory: 'factory',
  BorrowerNft: 'borrower-nft',
  LenderNft: 'lender-nft',
} as const

export type AssetKind = (typeof AssetKind)[keyof typeof AssetKind]

/** A 32-byte contract hash. */
export type ContractHash = Uint8Array

/** No asset contracts on Wharfedale. */
export function buildAssetContract(fundingOutpoint: OutPoint, kind: AssetKind): null {
  void fundingOutpoint
  void kind
  return null
}

/** The all-zero hash: no contract committed. */
export async function contractHashOrEmpty(contract: null): Promise<ContractHash> {
  void contract
  return new Uint8Array(32)
}

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

/** The asset issued by a new issuance spending `outpoint` with `contractHash`. */
export function assetIdFromIssuance(outpoint: OutPoint, contractHash: ContractHash): AssetId {
  const ids = call<{ asset: string; token: string }>(w =>
    w.issuedAssetIds(outpoint.txid().toString(), outpoint.vout(), hex(contractHash)),
  )
  return AssetId.fromString(ids.asset)
}

/** The reissuance token of that issuance. */
export function reissuanceTokenFromIssuance(
  outpoint: OutPoint,
  contractHash: ContractHash,
): AssetId {
  const ids = call<{ asset: string; token: string }>(w =>
    w.issuedAssetIds(outpoint.txid().toString(), outpoint.vout(), hex(contractHash)),
  )
  return AssetId.fromString(ids.token)
}
