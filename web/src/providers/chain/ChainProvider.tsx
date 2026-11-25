import { Spinner } from '@heroui/react'
import { useEffect, useState } from 'react'

import { fetchBlockHashAtHeight } from '@/api/esplora/methods'
import { env } from '@/constants/env'
import { applyRuntimeConfig, NETWORK_CONFIG, runtimeConfigSchema } from '@/constants/network-config'
import { Network } from '@/wharfedale/network'
import { AssetId } from '@/wharfedale/types'
import { loadWasm } from '@/wharfedale/wasm'

import { ChainContext } from './ChainContext'

const MIN_LOADER_DURATION_MS = 600

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
      <main className='bg-surface text-foreground flex min-h-screen flex-col items-center justify-center gap-5'>
        <Spinner size='lg' color='accent' />
        <div className='flex flex-col items-center gap-1.5'>
          <h1 className='text-2xl leading-none font-black tracking-tight uppercase'>Lending</h1>
          <p className='text-muted text-xs font-medium tracking-[0.16em] uppercase'>
            Connecting to Wharfedale…
          </p>
        </div>
      </main>
    )
  }

  return (
    <ChainContext.Provider value={{ chainNetwork, network: env.VITE_NETWORK }}>
      {children}
    </ChainContext.Provider>
  )
}
