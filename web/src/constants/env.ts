import { z as zod } from 'zod'

const absoluteUrlOrPath = zod.string().refine(
  (value: string) => {
    if (value.startsWith('/')) return true
    return zod.string().url().safeParse(value).success
  },
  { message: 'must be an absolute URL or same-origin path' },
)

// Build-time settings. Chain-specific values (asset ids) come from /config.json at runtime
// (see constants/network-config.ts), so one image serves any Wharfedale chain.
const envSchema = zod.object({
  /** Lending indexer API. */
  VITE_API_URL: absoluteUrlOrPath.default('/api'),
  DEV: zod.boolean().default(false),
  PROD: zod.boolean().default(false),
  /** A Wharfedale node's Esplora API (the web server proxies it). */
  VITE_ESPLORA_BASE_URL: absoluteUrlOrPath.default('/esplora'),
  VITE_NETWORK: zod.enum(['wharfedale']).default('wharfedale'),
  /** Optional: a recovery phrase pre-filled in the connect dialog (dev only). */
  VITE_DEBUG_MNEMONIC: zod.string().optional().default(''),
  /** Unlocks demo-only UI (short offer terms). */
  VITE_DEMO_MODE: zod
    .string()
    .optional()
    .default('')
    .transform(value => value === 'true'),
  VITE_GA_MEASUREMENT_ID: zod.string().optional().default(''),
})

export const env = envSchema.parse({
  VITE_API_URL: import.meta.env.VITE_API_URL,
  VITE_ESPLORA_BASE_URL: import.meta.env.VITE_ESPLORA_BASE_URL,
  VITE_NETWORK: import.meta.env.VITE_NETWORK,
  DEV: import.meta.env.DEV,
  PROD: import.meta.env.PROD,
  VITE_DEBUG_MNEMONIC: import.meta.env.VITE_DEBUG_MNEMONIC,
  VITE_DEMO_MODE: import.meta.env.VITE_DEMO_MODE,
  VITE_GA_MEASUREMENT_ID: import.meta.env.VITE_GA_MEASUREMENT_ID,
})

export type AppEnv = zod.infer<typeof envSchema>

export type NetworkName = AppEnv['VITE_NETWORK']
