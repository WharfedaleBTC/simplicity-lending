import type { ComponentType, SVGProps } from 'react'
import { z as zod } from 'zod'

import TestAssetIcon from '@/components/icons/TestAssetIcon'
import WbtcIcon from '@/components/icons/WbtcIcon'

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

export interface ConfigAsset {
  id: string
  decimals: number
  symbol: string
  icon: IconComponent
}

export interface NetworkConfig {
  /** The chain's fee asset (WBTC): collateral, fees and change. */
  collateralAsset: ConfigAsset
  principalAsset: ConfigAsset
  /** The asset whose holder collects protocol fees (as the indexer's protocol_fee_keeper_asset_id). */
  protocolFeeAsset: ConfigAsset
  /** Display unit for the fee asset's base unit. */
  policyAssetSatsUnit: string
  /** Block explorer for transaction links (the Wharfedale web app), without a trailing slash. */
  explorerUrl: string
  /** USD price per asset id from the config; WBTC's is the fallback for the live BTC/USD price. */
  pricesUsd: Record<string, number>
  /** The Wharfedale web app's faucet, if the chain has one. */
  faucetUrl: string
}

const assetSchema = zod.object({
  id: zod.string().regex(/^[0-9a-f]{64}$/),
  symbol: zod.string().min(1),
  decimals: zod.number().int().min(0).max(8),
})

/**
 * /config.json, rendered per deployment (docker/web-entrypoint.sh) or kept in web/public for
 * `pnpm dev`. Covenants are asset-agnostic; this is the one place that pins the assets.
 */
export const runtimeConfigSchema = zod.object({
  collateralAsset: assetSchema,
  principalAsset: assetSchema,
  protocolFeeAsset: assetSchema,
  explorerUrl: zod.string().default(''),
  /** USD price per asset symbol: `{"WBTC": 100000, "USDT": 1}`. WBTC's is used only when the
   *  live BTC/USD price can't be fetched (api/prices/methods.ts). */
  pricesUsd: zod.record(zod.string(), zod.number()).default({}),
  faucetUrl: zod.string().default(''),
})

export type RuntimeConfig = zod.infer<typeof runtimeConfigSchema>

const placeholder = (symbol: string): ConfigAsset => ({
  id: '0'.repeat(64),
  decimals: 8,
  symbol,
  icon: TestAssetIcon,
})

// Filled from /config.json before the app renders (providers/chain/ChainProvider.tsx).
export const NETWORK_CONFIG: NetworkConfig = {
  collateralAsset: placeholder('WBTC'),
  principalAsset: placeholder('USD'),
  protocolFeeAsset: placeholder('USD'),
  policyAssetSatsUnit: 'sats',
  explorerUrl: '',
  pricesUsd: {},
  faucetUrl: '',
}

export function applyRuntimeConfig(config: RuntimeConfig): void {
  NETWORK_CONFIG.collateralAsset = { ...config.collateralAsset, icon: WbtcIcon }
  NETWORK_CONFIG.principalAsset = { ...config.principalAsset, icon: TestAssetIcon }
  NETWORK_CONFIG.protocolFeeAsset = { ...config.protocolFeeAsset, icon: TestAssetIcon }
  NETWORK_CONFIG.explorerUrl = config.explorerUrl.replace(/\/$/, '')
  NETWORK_CONFIG.faucetUrl = config.faucetUrl
  NETWORK_CONFIG.pricesUsd = Object.fromEntries(
    [config.collateralAsset, config.principalAsset, config.protocolFeeAsset].flatMap(asset =>
      asset.symbol in config.pricesUsd ? [[asset.id, config.pricesUsd[asset.symbol]]] : [],
    ),
  )
}
