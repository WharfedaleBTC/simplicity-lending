import type { SimplicityProgram, SpendInfo } from '@/wharfedale/simplicity'

// https://en.bitcoin.it/wiki/BIP_0341#Constructing_and_spending_Taproot_outputs
export const UNSPENDABLE_TAPROOT_PUBKEY =
  '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0'

/** A stateless covenant's output: its single Simplicity leaf under the NUMS key. */
export function buildCovenantSpendInfo(program: SimplicityProgram): SpendInfo {
  return program.spendInfo()
}
