import { call } from '@/wharfedale/wasm'

/**
 * Downloads a wallet's key file: `{"secret": "<hex>"}`, the format the Wharfedale web app
 * (Wallet → Import), `wharfedale-wallet` and both SDKs read. It holds the key, not the phrase.
 * Named after the end of the wallet's address.
 */
export function downloadKeyFile(secret: string): void {
  const { address } = call<{ address: string }>(w => w.walletInfo(secret))
  const blob = new Blob([JSON.stringify({ secret }, null, 2)], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `wharfedale-key-${address.slice(-8)}.json`
  link.click()
  URL.revokeObjectURL(link.href)
}
