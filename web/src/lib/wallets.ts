// Test wallets, kept in this browser only (localStorage, unencrypted), as in the Wharfedale web
// app and the DAMP console: named wallets, one of them active. A wallet holds its 32-byte key,
// and its recovery phrase when it was made or imported from one.
import { useSyncExternalStore } from 'react'
import { z as zod } from 'zod'

import { requireWasm } from '@/wharfedale/wasm'

export interface StoredWallet {
  name: string
  secret: string
  phrase?: string
}
export interface WalletStore {
  active: string | null
  wallets: StoredWallet[]
}

export const WALLET_STORAGE_KEY = 'lending.wallets.v1'
const EMPTY_STORE: WalletStore = { active: null, wallets: [] }

const storeSchema = zod.object({
  active: zod.string().nullable(),
  wallets: zod
    .array(
      zod.object({
        name: zod.string().min(1).max(64),
        secret: zod.string().regex(/^[0-9a-f]{64}$/),
        phrase: zod.string().min(1).max(512).optional(),
      }),
    )
    .max(50),
})

const listeners = new Set<() => void>()
let cache: WalletStore | undefined

/** Lowercase words separated by single spaces: the form BIP39 checks. */
export function normalizePhrase(text: string): string {
  return text.trim().split(/\s+/).filter(Boolean).join(' ').toLowerCase()
}

export function normalizeWalletName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, ' ')
  if (!normalized) throw new Error('Name the wallet.')
  if (normalized.length > 64) throw new Error('Wallet names are limited to 64 characters.')
  return normalized
}

/** The key of a recovery phrase (BIP39, m/86'/1'/0'/0/0); throws if the phrase is invalid. */
export function secretFromPhrase(phrase: string): string {
  return requireWasm().secretFromMnemonic(normalizePhrase(phrase))
}

/** The key in a `{"secret": "<hex>"}` key file or a bare 64-hex secret; throws otherwise. */
export function secretFromKeyText(text: string): string {
  const trimmed = text.trim()
  let secret = trimmed
  if (trimmed.startsWith('{')) {
    const parsed = zod.object({ secret: zod.string() }).safeParse(JSON.parse(trimmed))
    if (!parsed.success) throw new Error('The key file has no "secret".')
    secret = parsed.data.secret
  }
  secret = secret.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(secret)) throw new Error('A secret is 64 hex characters.')
  return secret
}

export function readWallets(): WalletStore {
  if (cache) return cache
  try {
    const parsed = storeSchema.safeParse(JSON.parse(localStorage.getItem(WALLET_STORAGE_KEY) ?? ''))
    cache = parsed.success ? parsed.data : EMPTY_STORE
  } catch {
    cache = EMPTY_STORE
  }
  return cache
}

function write(store: WalletStore): void {
  cache = store
  try {
    localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Storage unavailable: the wallet lasts for this page only.
  }
  for (const listener of listeners) listener()
}

export function activeWallet(store: WalletStore = readWallets()): StoredWallet | null {
  return store.wallets.find(wallet => wallet.name === store.active) ?? null
}

export const wallets = {
  add(wallet: StoredWallet): void {
    const store = readWallets()
    const name = normalizeWalletName(wallet.name)
    if (store.wallets.some(existing => existing.name === name)) {
      throw new Error(`A wallet named "${name}" exists.`)
    }
    const added: StoredWallet = {
      name,
      secret: wallet.secret,
      ...(wallet.phrase ? { phrase: normalizePhrase(wallet.phrase) } : {}),
    }
    write({ active: name, wallets: [...store.wallets, added] })
  },
  remove(name: string): void {
    const store = readWallets()
    const rest = store.wallets.filter(wallet => wallet.name !== name)
    write({
      active: store.active === name ? (rest[0]?.name ?? null) : store.active,
      wallets: rest,
    })
  },
  select(name: string): void {
    const store = readWallets()
    if (!store.wallets.some(wallet => wallet.name === name)) {
      throw new Error(`No wallet named "${name}".`)
    }
    write({ ...store, active: name })
  },
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useWallets(): { store: WalletStore; active: StoredWallet | null } {
  const store = useSyncExternalStore(subscribe, readWallets, readWallets)
  return { store, active: activeWallet(store) }
}

export function suggestedWalletName(store: WalletStore, base = 'wallet'): string {
  if (!store.wallets.length) return 'my wallet'
  for (let index = store.wallets.length + 1; ; index += 1) {
    const name = `${base} ${index}`
    if (!store.wallets.some(wallet => wallet.name === name)) return name
  }
}
