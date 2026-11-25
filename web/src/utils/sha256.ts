import { bytesToHex, hexToBytes } from '@/utils/hex'
import { loadWasm, requireWasm } from '@/wharfedale/wasm'

/**
 * SHA-256, computed by the WebAssembly module (`scriptHash` is SHA-256 of any bytes). Not Web
 * Crypto: `crypto.subtle` exists only on secure origins (HTTPS or localhost), and a deployment
 * may be served over plain HTTP.
 */
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  await loadWasm()
  return hexToBytes(requireWasm().scriptHash(bytesToHex(data)))
}
