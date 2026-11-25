import { call, requireWasm } from '@/wharfedale/wasm'

/**
 * Downloads a recovery phrase's key file: `{"secret": "<hex>"}`, the format the Wharfedale web
 * app (Wallet → Import), `wharfedale-wallet` and both SDKs read. It holds the derived key, not
 * the phrase. Named after the end of the wallet's address.
 */
export function downloadKeyFile(phrase: string): void {
  const secret = requireWasm().secretFromMnemonic(phrase)
  const { address } = call<{ address: string }>(w => w.walletInfo(secret))
  const blob = new Blob([JSON.stringify({ secret }, null, 2)], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `wharfedale-key-${address.slice(-8)}.json`
  link.click()
  URL.revokeObjectURL(link.href)
}
