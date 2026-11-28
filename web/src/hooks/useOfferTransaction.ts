// One offer action (accept, cancel, repay, liquidate, claim) as a transaction: picks the
// wallet's coins, builds through the action's hook, signs, broadcasts and records it as pending.
// The offer page shows the result; the steps come from the transaction progress provider.
import { useMutation, useQuery } from '@tanstack/react-query'

import { FALLBACK_FEE_RATE_SAT_PER_KVB, fetchFeeRateSatPerKvb } from '@/api/esplora/fee'
import { esploraQueryKeys } from '@/api/esplora/queryKeys'
import { fetchOffer } from '@/api/indexer/methods'
import type { OfferShort, OfferStatus } from '@/api/indexer/schemas'
import {
  resolveActiveOutpoint,
  resolveBorrowerNftOutpoint,
  resolveLenderNftOutpoint,
  resolveNftOutpoints,
  resolvePendingOutpoint,
  resolveRepaymentOutpoint,
  toOutpoint,
} from '@/api/indexer/utils'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useAcceptOffer } from '@/hooks/useAcceptOffer'
import { useCancelOffer } from '@/hooks/useCancelOffer'
import { useClaimPrincipal } from '@/hooks/useClaimPrincipal'
import { useLenderVaultClaim } from '@/hooks/useLenderVaultClaim'
import { useLiquidateOffer } from '@/hooks/useLiquidateOffer'
import { useRepayOffer } from '@/hooks/useRepayOffer'
import { useStandardTransactionFlow } from '@/hooks/useStandardTransactionFlow'
import { useChain } from '@/providers/chain/useChain'
import type { PendingTxKind } from '@/providers/pendingTransactions/types'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { ASSET_AUTH_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/asset-auth/program'
import { ASSET_AUTH_VAULT_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/asset-auth-vault/program'
import { LENDING_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/lending/program'
import { SCRIPT_AUTH_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/script-auth/program'
import type { OfferAction } from '@/utils/offerActions'
import { calcInterest } from '@/utils/offers'
import type { PreparedTransaction } from '@/wharfedale/tx'
import {
  estimateFeeBudgetSats,
  EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
  selectAssetUtxos,
  selectFeeUtxos,
  utxoToOutpointString,
} from '@/wharfedale/utxo'

export type TxAction = Exclude<OfferAction, 'none'>

const WEIGHT_UNITS: Record<TxAction, number> = {
  accept: LENDING_MAX_WEIGHT_TO_SATISFY.OfferAcceptance + SCRIPT_AUTH_MAX_WEIGHT_TO_SATISFY,
  cancel:
    LENDING_MAX_WEIGHT_TO_SATISFY.OfferCancellation +
    SCRIPT_AUTH_MAX_WEIGHT_TO_SATISFY +
    EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
  repay: LENDING_MAX_WEIGHT_TO_SATISFY.FullRepayment + EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
  liquidate: LENDING_MAX_WEIGHT_TO_SATISFY.Liquidation + EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
  'claim-interest':
    ASSET_AUTH_VAULT_MAX_WEIGHT_TO_SATISFY.WithdrawAll + EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
  'claim-principal': ASSET_AUTH_MAX_WEIGHT_TO_SATISFY + EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
}

const PENDING: Record<TxAction, { kind: PendingTxKind; expected?: OfferStatus }> = {
  accept: { kind: 'accept_offer', expected: 'active' },
  cancel: { kind: 'cancel_offer', expected: 'cancelled' },
  repay: { kind: 'repay_offer', expected: 'repaid' },
  liquidate: { kind: 'liquidate_offer', expected: 'liquidated' },
  'claim-interest': { kind: 'claim_interest', expected: 'claimed' },
  'claim-principal': { kind: 'claim_principal' },
}

/** USDT the action spends from the wallet (accept: the loan; repay: loan plus interest). */
export function principalNeeded(offer: OfferShort, action: TxAction): bigint {
  if (action === 'accept') return offer.principal_amount
  if (action === 'repay') {
    return offer.principal_amount + calcInterest(offer.principal_amount, offer.interest_rate)
  }
  return 0n
}

export function useOfferTransaction(offer: OfferShort, action: TxAction) {
  const { principalAsset } = NETWORK_CONFIG
  const { syncWallet, getBlindedWalletUtxos, getReceiveAddress, scriptPubkey, confirmedBalances } =
    useWallet()
  const { chainNetwork } = useChain()
  const runStandardTransactionFlow = useStandardTransactionFlow()
  const { addPendingTx } = usePendingTransactions()
  const { acceptOffer } = useAcceptOffer()
  const { cancelOffer } = useCancelOffer()
  const { repayOffer } = useRepayOffer()
  const { liquidateOffer } = useLiquidateOffer()
  const { claimLenderVault } = useLenderVaultClaim()
  const { claimPrincipal } = useClaimPrincipal()
  const weight = WEIGHT_UNITS[action]

  const { data: feeRate = FALLBACK_FEE_RATE_SAT_PER_KVB } = useQuery({
    queryKey: esploraQueryKeys.feeRate,
    queryFn: () => fetchFeeRateSatPerKvb(),
  })
  const policyIsPrincipal = principalAsset.id === chainNetwork.policyAsset().toString()
  const needed =
    principalNeeded(offer, action) +
    (policyIsPrincipal ? estimateFeeBudgetSats(weight, feeRate) : 0n)
  const insufficient =
    needed > 0n && BigInt(confirmedBalances[principalAsset.id] ?? 0) < needed
      ? `Not enough ${principalAsset.symbol} in this wallet.`
      : null

  const build = async (): Promise<PreparedTransaction<unknown>> => {
    const fullOffer = await fetchOffer(offer.id)
    await syncWallet()
    const [coins, rate] = await Promise.all([getBlindedWalletUtxos(), fetchFeeRateSatPerKvb()])
    const feeOutpoints = selectFeeUtxos(
      coins,
      chainNetwork.policyAsset(),
      estimateFeeBudgetSats(weight, rate),
      rate,
    ).map(utxoToOutpointString)
    const principalOutpoints = (amount: bigint) =>
      selectAssetUtxos(coins, principalAsset.id, amount, principalAsset.symbol).map(
        utxoToOutpointString,
      )
    const nfts = () => {
      const found = resolveNftOutpoints(fullOffer)
      if (!found) throw new Error('Offer NFT participants not found')
      return found
    }
    const need = (value: string | null, what: string): string => {
      if (!value) throw new Error(`${what} not found`)
      return value
    }

    switch (action) {
      case 'accept':
        return acceptOffer({
          pendingOfferOutpoint: need(resolvePendingOutpoint(fullOffer), 'Pending offer UTXO'),
          lenderNftOutpoint: nfts().lenderNft,
          borrowerNftReferenceOutpoint: nfts().borrowerNft,
          principalOutpoints: principalOutpoints(offer.principal_amount),
          feeOutpoints,
        })
      case 'cancel': {
        const collateralRecipientAddress = await getReceiveAddress()
        if (!collateralRecipientAddress) throw new Error('Missing wallet receive address')
        return cancelOffer({
          pendingOfferOutpoint: need(resolvePendingOutpoint(fullOffer), 'Pending offer UTXO'),
          lenderNftOutpoint: nfts().lenderNft,
          borrowerNftOutpoint: nfts().borrowerNft,
          collateralRecipientAddress,
          feeOutpoints,
        })
      }
      case 'repay':
        return repayOffer({
          activeOfferOutpoint: need(resolveActiveOutpoint(fullOffer), 'Active offer UTXO'),
          borrowerNftOutpoint: need(resolveBorrowerNftOutpoint(fullOffer), 'Borrower NFT UTXO'),
          principalOutpoints: principalOutpoints(principalNeeded(offer, 'repay')),
          feeOutpoints,
        })
      case 'liquidate':
        return liquidateOffer({
          activeOfferOutpoint: need(resolveActiveOutpoint(fullOffer), 'Active offer UTXO'),
          createOfferTxid: offer.created_at_txid,
          lenderNftOutpoint: need(resolveLenderNftOutpoint(fullOffer), 'Lender NFT UTXO'),
          feeOutpoints,
        })
      case 'claim-interest':
        return claimLenderVault({
          lenderVaultOutpoint: need(resolveRepaymentOutpoint(fullOffer), 'Lender vault UTXO'),
          lenderNftOutpoint: need(resolveLenderNftOutpoint(fullOffer), 'Lender NFT UTXO'),
          feeOutpoints,
        })
      case 'claim-principal':
        if (!offer.borrower_principal_utxo) throw new Error('Borrower principal UTXO not found')
        return claimPrincipal({
          principalOutpoint: toOutpoint(offer.borrower_principal_utxo),
          borrowerNftOutpoint: nfts().borrowerNft,
          feeOutpoints,
        })
    }
  }

  const mutation = useMutation({
    mutationFn: () => runStandardTransactionFlow(build),
    onSuccess: result => {
      const { kind, expected } = PENDING[action]
      void addPendingTx({
        txid: result.txid,
        kind,
        walletScriptPubkey: scriptPubkey ?? '',
        offerId: offer.id,
        previousOfferStatus: offer.status,
        expectedOfferStatus: expected ?? offer.status,
      })
    },
  })

  return { ...mutation, insufficient }
}
