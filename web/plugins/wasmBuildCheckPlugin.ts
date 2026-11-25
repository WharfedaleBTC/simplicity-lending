import fs from 'node:fs'
import path from 'node:path'

import type { Plugin } from 'vite'

// Stops `pnpm dev` / `pnpm build` when the WebAssembly module (crates/wasm) isn't built.
export function wasmBuildCheckPlugin(webRoot: string): Plugin {
  return {
    name: 'wasm-build-check',
    config() {
      if (!fs.existsSync(path.join(webRoot, 'src/wasm/pkg/lending_wasm.js'))) {
        throw new Error('The WebAssembly module is not built: run `make wasm` in the repo root.')
      }
    },
  }
}
