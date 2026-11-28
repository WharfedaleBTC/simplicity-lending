import { useEffect, useState } from 'react'

import { fetchBlockHashAtHeight } from '@/api/esplora/methods'
import { env } from '@/constants/env'
import { applyRuntimeConfig, NETWORK_CONFIG, runtimeConfigSchema } from '@/constants/network-config'
import { Network } from '@/wharfedale/network'
import { AssetId } from '@/wharfedale/types'
import { loadWasm } from '@/wharfedale/wasm'

import { ChainContext } from './ChainContext'

const MIN_LOADER_DURATION_MS = 0

/** Loads the WebAssembly module, /config.json and the chain's genesis hash, then renders. */
async function loadChain(): Promise<Network> {
  const [, config, genesisHash] = await Promise.all([
    loadWasm(),
    fetch('/config.json', { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error(`/config.json: HTTP ${response.status}`)
      return runtimeConfigSchema.parse(await response.json())
    }),
    fetchBlockHashAtHeight(0),
  ])
  applyRuntimeConfig(config)
  return new Network(AssetId.fromString(NETWORK_CONFIG.collateralAsset.id), genesisHash.trim())
}

export function ChainProvider({ children }: { children: React.ReactNode }) {
  const [chainNetwork, setChainNetwork] = useState<Network | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loaderDone, setLoaderDone] = useState(false)

  if (error) throw error

  useEffect(() => {
    let cancelled = false
    const started = Date.now()
    loadChain()
      .then(n => {
        if (cancelled) return
        setChainNetwork(n)
        setTimeout(
          () => setLoaderDone(true),
          Math.max(0, MIN_LOADER_DURATION_MS - (Date.now() - started)),
        )
      })
      .catch(err =>
        setError(new Error('Failed to reach the Wharfedale node or load the app', { cause: err })),
      )
    return () => {
      cancelled = true
    }
  }, [])

  if (!chainNetwork || !loaderDone) {
    return (
      <main className='loading-screen' aria-busy='true'>
        Connecting to Wharfedale…
      </main>
    )
  }

  return (
    <ChainContext.Provider value={{ chainNetwork, network: env.VITE_NETWORK }}>
      {children}
    </ChainContext.Provider>
  )
}
