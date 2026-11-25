const fs = require('node:fs')
const path = require('node:path')

const WASM_PKG = path.join(__dirname, 'src/wasm/pkg/lending_wasm.js')

module.exports = {
  hooks: {
    preResolution() {
      if (fs.existsSync(WASM_PKG)) return
      console.error(
        [
          '',
          'ERROR: the WebAssembly module (crates/wasm) is not built yet.',
          '',
          'Fix (run from the repo root):',
          '  make wasm',
          '',
        ].join('\n'),
      )
      process.exit(1)
    },
  },
}
