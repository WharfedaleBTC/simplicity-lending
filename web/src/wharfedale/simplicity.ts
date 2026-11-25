// SimplicityHL programs as Taproot outputs, compiled by the WebAssembly module (SimplicityHL
// 0.9, as the node). Shaped like the LWK classes the app used before: arguments and witnesses
// are SimplicityHL literals by name; types come from the program.
import { hexToBytes } from '@/utils/hex'

import { Script } from './types'
import { call } from './wasm'

export class SimplicityTypedValue {
  constructor(readonly literal: string) {}
  /** A `u256` from 64 hex digits (the program's byte order). */
  static fromU256Hex(hex: string): SimplicityTypedValue {
    return new SimplicityTypedValue(`0x${hex.replace(/^0x/, '').toLowerCase()}`)
  }
  static fromU64(value: bigint): SimplicityTypedValue {
    return new SimplicityTypedValue(value.toString())
  }
  static fromU32(value: number): SimplicityTypedValue {
    return new SimplicityTypedValue(String(value))
  }
  static fromU8(value: number): SimplicityTypedValue {
    return new SimplicityTypedValue(String(value))
  }
  static fromBoolean(value: boolean): SimplicityTypedValue {
    return new SimplicityTypedValue(value ? 'true' : 'false')
  }
  /**
   * A SimplicityHL expression, parsed at the type the program declares (the type argument is
   * kept for readability at call sites).
   */
  static parse(expression: string, type?: SimplicityType): SimplicityTypedValue {
    void type
    return new SimplicityTypedValue(expression)
  }
}

/** Kept for call sites that name a type; the program's declaration decides. */
export class SimplicityType {
  private constructor(readonly text: string) {}
  static fromString(text: string): SimplicityType {
    return new SimplicityType(text)
  }
}

class Values {
  readonly values: Record<string, string> = {}
  addValue(name: string, value: SimplicityTypedValue): this {
    this.values[name] = value.literal
    return this
  }
}

export class SimplicityArguments extends Values {}
export class SimplicityWitnessValues extends Values {}

interface ProgramJson {
  cmr: string
  scriptPubkey: string
  scriptHash: string
  address: string
  controlBlock: string
}

/** The Taproot output of a program with some storage slots (hidden `TapData` leaves). */
export interface SpendInfo {
  scriptPubkey: Script
  scriptHash: Uint8Array
  address: string
  controlBlock: string
  storage: string[]
}

const cache = new Map<string, ProgramJson>()

export class SimplicityProgram {
  private constructor(
    readonly source: string,
    readonly arguments_: Record<string, string>,
  ) {}

  static load(source: string, args: SimplicityArguments): SimplicityProgram {
    const p = new SimplicityProgram(source, { ...args.values })
    p.spendInfo() // compile now: errors surface where the program is built
    return p
  }

  /** Same as `load` (the WebAssembly module keeps no debug symbols). */
  static loadWithDebugSymbols(
    source: string,
    args: SimplicityArguments,
    debug?: boolean,
  ): SimplicityProgram {
    void debug
    return SimplicityProgram.load(source, args)
  }

  /** Commitment Merkle root (hex). */
  get cmr(): string {
    return this.info([]).cmr
  }

  private info(storage: string[]): ProgramJson {
    const key = JSON.stringify([this.source, this.arguments_, storage])
    let info = cache.get(key)
    if (!info) {
      info = call<ProgramJson>(w =>
        w.programInfo(this.source, JSON.stringify(this.arguments_), JSON.stringify(storage)),
      )
      cache.set(key, info)
    }
    return info
  }

  /** The program's output, with `storage` slots (32 bytes each) beside its leaf. */
  spendInfo(storage: Uint8Array[] = []): SpendInfo {
    const slots = storage.map(slot => {
      if (slot.length !== 32) throw new Error('Storage slots are 32 bytes')
      return Array.from(slot, b => b.toString(16).padStart(2, '0')).join('')
    })
    const info = this.info(slots)
    return {
      scriptPubkey: Script.fromHex(info.scriptPubkey),
      scriptHash: hexToBytes(info.scriptHash),
      address: info.address,
      controlBlock: info.controlBlock,
      storage: slots,
    }
  }
}
