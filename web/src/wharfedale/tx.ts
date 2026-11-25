// A transaction to complete: inputs and outputs in their final order, as the covenants check
// them. The wallet completes it (fee-asset coins, change, fee, blinding, signatures, program
// witnesses) in one call to the WebAssembly module.
import { fetchTxHex } from '@/api/esplora/methods'

import type { SimplicityProgram, SimplicityWitnessValues } from './simplicity'
import { type AssetId, type OutPoint, type Script, Transaction, type TxOut } from './types'

export interface ProgramSpend {
  program: SimplicityProgram
  /** Storage slots of the spent output (32 bytes each), as in `program.spendInfo(storage)`. */
  storage?: Uint8Array[]
  witness: SimplicityWitnessValues
}

export interface IssuanceSpec {
  assetAmount: bigint
  tokenAmount: bigint
  /** Zero hash when the asset has no contract. */
  contractHash: Uint8Array
}

export interface InputSpec {
  outpoint: OutPoint
  /** The spent output, from the transaction that created it. */
  prevout: TxOut
  sequence?: number
  /** The transaction's nLockTime must be at least this (a unix time or a height). */
  lockTime?: number
  /** A coin of the wallet: signed on the key path (the default for inputs without `program`). */
  walletCoin?: boolean
  program?: ProgramSpend
  issuance?: IssuanceSpec
}

export interface OutputSpec {
  script: Script
  amount: bigint
  asset: AssetId
  /** Hex public key: blind the output to it. */
  blindingPubkey?: string
}

export interface TxSpec {
  inputs: InputSpec[]
  outputs: OutputSpec[]
  /** Use only `inputs` for the fee (they must cover it); otherwise the wallet adds coins. */
  strict?: boolean
}

/**
 * A built transaction waiting for the wallet; `summary` describes it for the UI (a function
 * when it names the transaction's own txid, known only once it is signed).
 */
export interface PreparedTransaction<TSummary> {
  spec: TxSpec
  summary: TSummary | ((txid: string) => TSummary)
  feeRateSatPerKvb: number
}

const txCache = new Map<string, Promise<Transaction>>()

export function fetchTransactionById(txid: string): Promise<Transaction> {
  let tx = txCache.get(txid)
  if (!tx) {
    tx = fetchTxHex(txid).then(hex => Transaction.fromHex(hex))
    tx.catch(() => txCache.delete(txid))
    txCache.set(txid, tx)
  }
  return tx
}

export function fetchTransaction(outpoint: OutPoint): Promise<Transaction> {
  return fetchTransactionById(outpoint.txid().toString())
}

export function requireTxOut(tx: Transaction, vout: number, label: string): TxOut {
  const txOut = tx.outputs[vout]
  if (!txOut) throw new Error(`${label} transaction does not have output ${vout}`)
  return txOut
}

export function requireExplicitAsset(txOut: TxOut, label: string): AssetId {
  const asset = txOut.asset()
  if (!asset) throw new Error(`${label} output must have an explicit asset`)
  return asset
}

export function requireExplicitAmount(txOut: TxOut, label: string): bigint {
  const amount = txOut.value()
  if (amount === undefined) throw new Error(`${label} output must have an explicit amount`)
  return amount
}

export function assertExplicitAmount(txOut: TxOut, expectedAmount: bigint, label: string): void {
  const amount = requireExplicitAmount(txOut, label)
  if (amount !== expectedAmount) {
    throw new Error(`${label} output must have amount ${expectedAmount.toString()}`)
  }
}

export function assertDistinctOutpoints(outpoints: OutPoint[], message: string): void {
  const values = outpoints.map(outpoint => outpoint.toString())
  if (new Set(values).size !== values.length) {
    throw new Error(message)
  }
}

export function assertScriptMatches(actual: Script, expected: Script, message: string): void {
  if (!actual.equals(expected)) throw new Error(message)
}
