// The lending protocol's Wharfedale transaction layer (crates/wasm), compiled to WebAssembly:
// program addresses, wallet keys, unblinding, and completing transactions. Built by
// `make wasm` (or the web image) into src/wasm/pkg.
import init, * as wasm from '@/wasm/pkg/lending_wasm.js'
import wasmUrl from '@/wasm/pkg/lending_wasm_bg.wasm?url'

let ready: Promise<void> | null = null
let loaded = false

/** Loads the module once; every other call in this folder needs it loaded. */
export function loadWasm(): Promise<void> {
  ready ??= init({ module_or_path: wasmUrl }).then(() => {
    loaded = true
  })
  return ready
}

export function requireWasm(): typeof wasm {
  if (!loaded) throw new Error('The WebAssembly module is not loaded yet')
  return wasm
}

/** Parses a JSON result of the module. */
export function call<T>(fn: (w: typeof wasm) => string): T {
  return JSON.parse(fn(requireWasm())) as T
}
