// Small value types for chain data, shaped like the LWK classes the app used before.
// Asset ids and txids print in display order (as explorers show them); `toBytes()` gives the
// internal byte order, which is what Simplicity programs see.
import { bytesToHex, hexToBytes } from '@/utils/hex'

import { call, requireWasm } from './wasm'

const reversed = (bytes: Uint8Array): Uint8Array => Uint8Array.from(bytes).reverse()

function check32(hex: string, what: string): string {
  const h = hex.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error(`Invalid ${what}: ${hex}`)
  return h
}

export class AssetId {
  private constructor(private readonly hex: string) {}
  static fromString(hex: string): AssetId {
    return new AssetId(check32(hex, 'asset id'))
  }
  /** From internal byte order. */
  static fromBytes(bytes: Uint8Array): AssetId {
    if (bytes.length !== 32) throw new Error('Asset id must be 32 bytes')
    return new AssetId(bytesToHex(reversed(bytes)))
  }
  toString(): string {
    return this.hex
  }
  /** Internal byte order. */
  toBytes(): Uint8Array {
    return reversed(hexToBytes(this.hex))
  }
  equals(other: AssetId | string): boolean {
    return this.hex === other.toString().toLowerCase()
  }
}

export class Txid {
  private constructor(private readonly hex: string) {}
  static fromString(hex: string): Txid {
    return new Txid(check32(hex, 'txid'))
  }
  toString(): string {
    return this.hex
  }
}

export class OutPoint {
  private readonly _txid: Txid
  private readonly _vout: number
  /** `txid:vout`. */
  constructor(outpoint: string) {
    const [txid, vout] = outpoint.trim().split(':')
    const n = Number(vout)
    if (!txid || !Number.isInteger(n) || n < 0) throw new Error(`Invalid outpoint: ${outpoint}`)
    this._txid = Txid.fromString(txid)
    this._vout = n
  }
  static from(txid: string, vout: number): OutPoint {
    return new OutPoint(`${txid}:${vout}`)
  }
  txid(): Txid {
    return this._txid
  }
  vout(): number {
    return this._vout
  }
  toString(): string {
    return `${this._txid.toString()}:${this._vout}`
  }
}

export class Script {
  private constructor(private readonly raw: Uint8Array) {}
  static fromHex(hex: string): Script {
    return new Script(hexToBytes(hex))
  }
  static fromBytes(bytes: Uint8Array): Script {
    return new Script(Uint8Array.from(bytes))
  }
  /** The empty script: a fee output. */
  static empty(): Script {
    return new Script(new Uint8Array())
  }
  /** `OP_RETURN <data>` (one push). */
  static opReturn(data: Uint8Array): Script {
    if (data.length > 75) throw new Error('OP_RETURN data above 75 bytes needs OP_PUSHDATA1')
    return new Script(Uint8Array.from([0x6a, ...(data.length ? [data.length, ...data] : [])]))
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.raw)
  }
  toString(): string {
    return bytesToHex(this.raw)
  }
  isOpReturn(): boolean {
    return this.raw[0] === 0x6a
  }
  /** SHA-256 of the script: what `jet::input_script_hash` / `jet::output_script_hash` return. */
  jet_sha256_hex(): string {
    return requireWasm().scriptHash(this.toString())
  }
  equals(other: Script): boolean {
    return this.toString() === other.toString()
  }
  /** Explicit address `wf1…`, if the script has one. */
  address(): string | null {
    return requireWasm().scriptAddress(this.toString()) ?? null
  }
}

export class Address {
  private constructor(
    private readonly text: string,
    private readonly script: Script,
    private readonly blinding: string | null,
    private readonly explicit: string,
  ) {}
  /** A `wfc1…` (confidential) or `wf1…` (explicit) address. */
  static parse(address: string): Address {
    const info = call<{
      scriptPubkey: string
      blindingKey: string | null
      explicitAddress: string
    }>(w => w.addressInfo(address))
    return new Address(
      address.trim(),
      Script.fromHex(info.scriptPubkey),
      info.blindingKey,
      info.explicitAddress,
    )
  }
  scriptPubkey(): Script {
    return this.script
  }
  /** Hex public key the receiver unblinds with, if confidential. */
  blindingPubkey(): string | undefined {
    return this.blinding ?? undefined
  }
  isConfidential(): boolean {
    return this.blinding !== null
  }
  toUnconfidential(): Address {
    return new Address(this.explicit, this.script, null, this.explicit)
  }
  toString(): string {
    return this.text
  }
}

interface OutputJson {
  script: string
  asset: string | null
  value: number | null
  isOpReturn: boolean
  opReturnData: string | null
  isFee: boolean
}

export class TxOut {
  constructor(
    private readonly o: OutputJson,
    /** The transaction that created this output (consensus hex) and its index there. */
    readonly parentTxHex: string,
    readonly vout: number,
  ) {}
  scriptPubkey(): Script {
    return Script.fromHex(this.o.script)
  }
  /** Undefined when confidential. */
  asset(): AssetId | undefined {
    return this.o.asset ? AssetId.fromString(this.o.asset) : undefined
  }
  /** Undefined when confidential. */
  value(): bigint | undefined {
    return this.o.value === null ? undefined : BigInt(this.o.value)
  }
  isOpReturn(): boolean {
    return this.o.isOpReturn
  }
  /** The pushed bytes of an `OP_RETURN` output. */
  opReturnData(): Uint8Array | undefined {
    return this.o.opReturnData === null ? undefined : hexToBytes(this.o.opReturnData)
  }
  isFee(): boolean {
    return this.o.isFee
  }
}

export class TxIn {
  constructor(
    readonly txid: string,
    readonly vout: number,
  ) {}
  /** The output this input spends. */
  outpoint(): OutPoint {
    return OutPoint.from(this.txid, this.vout)
  }
}

export class Transaction {
  readonly outputs: TxOut[]
  readonly inputs: TxIn[]
  private readonly _txid: Txid
  readonly lockTime: number
  private constructor(private readonly hex: string) {
    const info = call<{
      txid: string
      lockTime: number
      inputs: { txid: string; vout: number }[]
      outputs: OutputJson[]
    }>(w => w.txInfo(hex))
    this._txid = Txid.fromString(info.txid)
    this.lockTime = info.lockTime
    this.inputs = info.inputs.map(i => new TxIn(i.txid, i.vout))
    this.outputs = info.outputs.map((o, i) => new TxOut(o, hex, i))
  }
  static fromHex(hex: string): Transaction {
    return new Transaction(hex.trim().toLowerCase())
  }
  static fromBytes(bytes: Uint8Array): Transaction {
    return new Transaction(bytesToHex(bytes))
  }
  txid(): Txid {
    return this._txid
  }
  /** Consensus hex. */
  toString(): string {
    return this.hex
  }
}
