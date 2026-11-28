// A recovery-phrase wallet, as in the Wharfedale web app: one key at m/86'/1'/0'/0/0 (key-path
// Taproot), its coins at one output script, explicit or blinded to its blinding key. The
// secret stays in this page; the WebAssembly module unblinds coins and signs.
import { fetchAddressUtxo } from '@/api/esplora/methods'
import type { WalletCoin } from '@/lib/wallet-core/types'

import type { Network } from './network'
import { fetchTransactionById, type TxSpec } from './tx'
import { Address, AssetId, OutPoint, Transaction } from './types'
import { call, requireWasm } from './wasm'

/** Whether `phrase` is a valid English BIP39 recovery phrase. */
export function isValidMnemonic(phrase: string): boolean {
  try {
    requireWasm().secretFromMnemonic(phrase)
    return true
  } catch {
    return false
  }
}

export interface WalletInfo {
  scriptPubkey: string
  /** Confidential `wfc1…`. */
  address: string
  /** Explicit `wf1…`. */
  explicitAddress: string
  blindingPublicKey: string
  xonlyPublicKey: string
}

class Coin implements WalletCoin {
  constructor(
    private readonly op: OutPoint,
    private readonly asset: AssetId,
    private readonly amount: bigint,
    private readonly blockHeight: number | undefined,
    readonly confidential: boolean,
  ) {}
  outpoint(): OutPoint {
    return this.op
  }
  height(): number | undefined {
    return this.blockHeight
  }
  unblinded(): { asset(): AssetId; value(): bigint } {
    return { asset: () => this.asset, value: () => this.amount }
  }
}

export interface CompletedTransaction {
  tx: Transaction
  fee: bigint
}

export class SeedWallet {
  readonly info: WalletInfo

  private constructor(private readonly secret: string) {
    this.info = call<WalletInfo>(w => w.walletInfo(secret))
  }

  static fromMnemonic(phrase: string): SeedWallet {
    return new SeedWallet(requireWasm().secretFromMnemonic(phrase))
  }

  /** From the 32-byte key itself (64 hex), as a `{"secret"}` key file holds it. */
  static fromSecret(secret: string): SeedWallet {
    return new SeedWallet(secret.trim().toLowerCase())
  }

  receiveAddress(): Address {
    return Address.parse(this.info.address)
  }

  /** This wallet's coins (confirmed ones carry a height), unblinded. */
  async coins(): Promise<WalletCoin[]> {
    const utxos = await fetchAddressUtxo(this.info.explicitAddress)
    const coins = await Promise.all(
      utxos.map(async u => {
        const tx = await fetchTransactionById(u.txid)
        const opened = JSON.parse(
          requireWasm().unblindOutput(tx.toString(), u.vout, this.secret),
        ) as {
          asset: string
          value: number
          confidential: boolean
        } | null
        if (!opened) return null
        return new Coin(
          OutPoint.from(u.txid, u.vout),
          AssetId.fromString(opened.asset),
          BigInt(opened.value),
          u.status.confirmed ? u.status.block_height : undefined,
          opened.confidential,
        )
      }),
    )
    return coins.filter((c): c is Coin => c !== null)
  }

  /**
   * Completes `spec`: adds this wallet's fee-asset coins (unless `spec.strict`), change and the
   * fee output; blinds; signs the wallet's inputs; satisfies program inputs.
   */
  async complete(
    spec: TxSpec,
    network: Network,
    feeRateSatPerKvb: number,
    feeCoins: WalletCoin[],
  ): Promise<CompletedTransaction> {
    const used = new Set(spec.inputs.map(i => i.outpoint.toString()))
    const coins = await Promise.all(
      feeCoins
        .filter(c => !used.has(c.outpoint().toString()))
        .map(async c => ({
          txHex: (await fetchTransactionById(c.outpoint().txid().toString())).toString(),
          vout: c.outpoint().vout(),
        })),
    )
    const request = {
      network: { policyAsset: network.policyAsset().toString(), genesisHash: network.genesisHash },
      secret: this.secret,
      feeRate: Math.max(1, Math.ceil(feeRateSatPerKvb)),
      strict: spec.strict ?? false,
      coins,
      inputs: spec.inputs.map(i => ({
        txHex: i.prevout.parentTxHex,
        vout: i.prevout.vout,
        sequence: i.sequence,
        lockTime: i.lockTime,
        // Inputs without a covenant are this wallet's coins (NFTs, principal, fee coins).
        keyPath: i.walletCoin ?? !i.program,
        program: i.program && {
          source: i.program.program.source,
          arguments: i.program.program.arguments_,
          storage: i.program.program.spendInfo(i.program.storage ?? []).storage,
          witness: i.program.witness.values,
        },
        issuance: i.issuance && {
          new: {
            amount: Number(i.issuance.assetAmount),
            tokens: Number(i.issuance.tokenAmount),
            contractHash: Array.from(i.issuance.contractHash, b =>
              b.toString(16).padStart(2, '0'),
            ).join(''),
          },
        },
      })),
      outputs: spec.outputs.map(o => ({
        script: o.script.toString(),
        amount: Number(o.amount),
        asset: o.asset.toString(),
        blindingKey: o.blindingPubkey,
      })),
    }
    const out = call<{ txHex: string; txid: string; fee: number }>(w =>
      w.completeTransaction(JSON.stringify(request)),
    )
    return { tx: Transaction.fromHex(out.txHex), fee: BigInt(out.fee) }
  }
}
