import { fetchFeeRateSatPerKvbAbovePending } from '@/api/esplora/fee'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useChain } from '@/providers/chain/useChain'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import {
  buildIssuanceFactoryWitness,
  loadIssuanceFactoryProgram,
} from '@/simplicity/issuance-factory/program'
import { encodePendingOfferMetadata } from '@/simplicity/lending/metadata'
import {
  buildDerivedLendingOfferProgramParams,
  buildLendingOfferSpendInfo,
  loadLendingProgram,
} from '@/simplicity/lending/program'
import { loadScriptAuthProgram } from '@/simplicity/script-auth/program'
import { buildCovenantSpendInfo } from '@/simplicity/taproot'
import { bytesToHex, hexToBytes } from '@/utils/hex'
import { getProcessingTxids } from '@/utils/pendingTransactions'
import { toBytes32, toUint8, toUint16, toUint32, toUint64 } from '@/utils/uint'
import {
  assetIdFromIssuance,
  AssetKind,
  buildAssetContract,
  contractHashOrEmpty,
} from '@/wharfedale/assetContract'
import {
  assertExplicitAmount,
  fetchTransaction,
  type PreparedTransaction,
  requireExplicitAsset,
  requireTxOut,
  type TxSpec,
} from '@/wharfedale/tx'
import { Address, AssetId, OutPoint, Script } from '@/wharfedale/types'
import {
  assertWalletUtxoAssetAndMinimumAmount,
  requireWalletUtxo,
  WALLET_INPUT_RBF_SEQUENCE,
} from '@/wharfedale/utxo'

const ISSUING_UTXOS_COUNT = 2
const REISSUANCE_FLAGS = 0n
const REISSUANCE_TOKEN_AMOUNT = 0n
const NFT_AMOUNT = 1n
const MAX_PRINCIPAL_INTEREST_RATE_BPS = 65_535

export interface CreateOfferParams {
  factoryAuthOutpoint: string
  issuanceFactoryOutpoint: string
  factoryAssetId: string
  collateralOutpoints: string[]
  collateralAmount: bigint
  principalAssetId: string
  principalAmount: bigint
  principalInterestRate: number
  loanDurationSeconds: number
  protocolFeeKeeperAssetId: string
}

export interface CreateOfferSummary {
  inputs: Record<string, string>
  outputs: Record<string, string>
  assetIds: Record<string, string>
  scripts: Record<string, string>
  offerParameters: Record<string, string>
  metadataOpReturnHex: string
}

export function useCreateOffer() {
  const { chainNetwork: lwkNetwork } = useChain()
  const { getReceiveAddress, getBlindedWalletUtxos, syncWallet } = useWallet()
  const { pendingTxs } = usePendingTransactions()

  const createOffer = async (
    params: CreateOfferParams,
  ): Promise<PreparedTransaction<CreateOfferSummary>> => {
    const receiveAddressString = await getReceiveAddress()
    if (!receiveAddressString) throw new Error('Missing receive address')
    await syncWallet()
    const blindedWalletUtxos = await getBlindedWalletUtxos()
    if (params.collateralOutpoints.length === 0) {
      throw new Error('At least one collateral UTXO is required')
    }
    if (new Set(params.collateralOutpoints).size !== params.collateralOutpoints.length) {
      throw new Error('Collateral UTXO list contains duplicates')
    }
    const collateralUtxos = params.collateralOutpoints.map(outpoint =>
      requireWalletUtxo(blindedWalletUtxos, outpoint, 'Collateral'),
    )
    const factoryAssetString = params.factoryAssetId
    const principalAssetString = params.principalAssetId
    const protocolFeeKeeperAssetString = params.protocolFeeKeeperAssetId
    const policyAssetString = lwkNetwork.policyAsset().toString()

    let collateralInputAmount = 0n
    for (const collateralUtxo of collateralUtxos) {
      assertWalletUtxoAssetAndMinimumAmount(collateralUtxo, policyAssetString, 1n, 'Collateral')
      collateralInputAmount += collateralUtxo.unblinded().value()
    }
    if (collateralInputAmount < params.collateralAmount) {
      throw new Error('Collateral UTXO amount is lower than required collateral amount')
    }
    if (collateralInputAmount === params.collateralAmount) {
      throw new Error('Collateral input total must exceed collateral amount to leave fees')
    }

    const factoryAuthOutpoint = new OutPoint(params.factoryAuthOutpoint)
    const issuanceFactoryOutpoint = new OutPoint(params.issuanceFactoryOutpoint)
    const lenderNftIssuanceOutpointString = params.collateralOutpoints[0]
    if (!lenderNftIssuanceOutpointString) {
      throw new Error('At least one collateral UTXO is required')
    }
    const collateralOutpoints = params.collateralOutpoints.map(outpoint => new OutPoint(outpoint))
    const lenderNftIssuanceOutpoint = new OutPoint(lenderNftIssuanceOutpointString)
    const [factoryAuthTx, issuanceFactoryTx, collateralTxs, currentTime, feeRate] =
      await Promise.all([
        fetchTransaction(factoryAuthOutpoint),
        fetchTransaction(issuanceFactoryOutpoint),
        Promise.all(collateralOutpoints.map(outpoint => fetchTransaction(outpoint))),
        Promise.resolve(Math.floor(Date.now() / 1000)),
        fetchFeeRateSatPerKvbAbovePending(getProcessingTxids(pendingTxs)),
      ])
    const factoryAuthTxOut = requireTxOut(factoryAuthTx, factoryAuthOutpoint.vout(), 'FactoryAuth')
    const issuanceFactoryTxOut = requireTxOut(
      issuanceFactoryTx,
      issuanceFactoryOutpoint.vout(),
      'IssuanceFactory',
    )
    const collateralTxOuts = collateralTxs.map((tx, index) => {
      const outpoint = collateralOutpoints[index]
      if (!outpoint) throw new Error('Missing collateral outpoint for fetched transaction')
      return requireTxOut(tx, outpoint.vout(), 'Collateral')
    })

    if (requireExplicitAsset(factoryAuthTxOut, 'FactoryAuth').toString() !== factoryAssetString) {
      throw new Error('FactoryAuth UTXO has unexpected asset')
    }
    assertExplicitAmount(factoryAuthTxOut, NFT_AMOUNT, 'FactoryAuth')
    const receiveExplicitAddress = Address.parse(receiveAddressString).toUnconfidential()
    const issuanceFactoryProgram = loadIssuanceFactoryProgram({
      issuingUtxosCount: toUint8(ISSUING_UTXOS_COUNT, 'issuingUtxosCount'),
      reissuanceFlags: toUint64(REISSUANCE_FLAGS, 'reissuanceFlags'),
    })
    const issuanceFactoryAddress = buildCovenantSpendInfo(issuanceFactoryProgram)

    const borrowerNftContract = buildAssetContract(issuanceFactoryOutpoint, AssetKind.BorrowerNft)
    const lenderNftContract = buildAssetContract(lenderNftIssuanceOutpoint, AssetKind.LenderNft)
    const borrowerNftContractHash = await contractHashOrEmpty(borrowerNftContract)
    const lenderNftContractHash = await contractHashOrEmpty(lenderNftContract)
    const borrowerNftAsset = assetIdFromIssuance(issuanceFactoryOutpoint, borrowerNftContractHash)
    const lenderNftAsset = assetIdFromIssuance(lenderNftIssuanceOutpoint, lenderNftContractHash)
    const borrowerNftAssetString = borrowerNftAsset.toString()
    const lenderNftAssetString = lenderNftAsset.toString()
    const loanDurationSeconds = params.loanDurationSeconds
    if (params.principalInterestRate > MAX_PRINCIPAL_INTEREST_RATE_BPS) {
      throw new Error(
        `Interest rate is too high. Max is ${MAX_PRINCIPAL_INTEREST_RATE_BPS.toString()} bps ` +
          `(${(MAX_PRINCIPAL_INTEREST_RATE_BPS / 100).toFixed(2)}%).`,
      )
    }
    const offerParameters = {
      collateralAmount: toUint64(params.collateralAmount, 'collateralAmount'),
      principalAmount: toUint64(params.principalAmount, 'principalAmount'),
      principalInterestRate: toUint16(params.principalInterestRate, 'principalInterestRate'),
      loanExpirationTime: toUint32(currentTime + loanDurationSeconds, 'loanExpirationTime'),
    }
    const collateralAssetId = toBytes32(
      AssetId.fromString(policyAssetString).toBytes(),
      'collateralAssetId',
    )
    const principalAssetId = toBytes32(
      AssetId.fromString(principalAssetString).toBytes(),
      'principalAssetId',
    )
    const borrowerNftAssetId = toBytes32(borrowerNftAsset.toBytes(), 'borrowerNftAssetId')
    const lenderNftAssetId = toBytes32(lenderNftAsset.toBytes(), 'lenderNftAssetId')
    const protocolFeeKeeperAssetId = toBytes32(
      AssetId.fromString(protocolFeeKeeperAssetString).toBytes(),
      'protocolFeeKeeperAssetId',
    )

    const derivedLendingParams = buildDerivedLendingOfferProgramParams({
      collateralAssetId,
      principalAssetId,
      borrowerNftAssetId,
      lenderNftAssetId,
      protocolFeeKeeperAssetId,
      offerParameters,
    })
    const lendingProgram = loadLendingProgram(derivedLendingParams)
    const lendingSpendInfo = buildLendingOfferSpendInfo(lendingProgram, {
      principalAmount: offerParameters.principalAmount,
      principalInterestRate: offerParameters.principalInterestRate,
    })
    const lendingScript = lendingSpendInfo.scriptPubkey
    const lendingScriptPubkeyHex = bytesToHex(lendingScript.bytes())
    const lendingScriptHash = toBytes32(
      hexToBytes(lendingScript.jet_sha256_hex()),
      'lendingScriptHash',
    )
    const lenderNftScriptAuthProgram = loadScriptAuthProgram(lendingScriptHash)
    const lenderNftScriptAuthAddress = buildCovenantSpendInfo(lenderNftScriptAuthProgram)
    const pendingOfferMetadataPayload = await encodePendingOfferMetadata({
      principalAssetId,
      principalAmount: offerParameters.principalAmount,
      loanExpirationTime: offerParameters.loanExpirationTime,
      principalInterestRate: offerParameters.principalInterestRate,
    })
    const pendingOfferMetadataScript = Script.opReturn(pendingOfferMetadataPayload)

    const factoryAsset = AssetId.fromString(factoryAssetString)
    const policyAsset = lwkNetwork.policyAsset()
    const receiveExplicitScript = receiveExplicitAddress.scriptPubkey()

    const spec: TxSpec = {
      inputs: [
        {
          outpoint: factoryAuthOutpoint,
          prevout: factoryAuthTxOut,
        },
        {
          outpoint: issuanceFactoryOutpoint,
          prevout: issuanceFactoryTxOut,
          issuance: {
            assetAmount: NFT_AMOUNT,
            tokenAmount: REISSUANCE_TOKEN_AMOUNT,
            contractHash: borrowerNftContractHash,
          },
          program: {
            program: issuanceFactoryProgram,
            storage: buildCovenantSpendInfo(issuanceFactoryProgram).storage.map(hexToBytes),
            witness: buildIssuanceFactoryWitness({
              branch: 'IssueAssets',
              outputIndex: toUint32(0, 'outputIndex'),
            }),
          },
        },
        ...collateralUtxos.map((_utxo, index) => ({
          outpoint: collateralOutpoints[index],
          prevout: collateralTxOuts[index],
          walletCoin: true,
          sequence: index === 0 ? WALLET_INPUT_RBF_SEQUENCE : undefined,
          issuance:
            index === 0
              ? {
                  assetAmount: NFT_AMOUNT,
                  tokenAmount: REISSUANCE_TOKEN_AMOUNT,
                  contractHash: lenderNftContractHash,
                }
              : undefined,
        })),
      ],
      outputs: [
        { script: receiveExplicitScript, amount: NFT_AMOUNT, asset: factoryAsset },
        { script: issuanceFactoryAddress.scriptPubkey, amount: NFT_AMOUNT, asset: factoryAsset },
        { script: receiveExplicitScript, amount: NFT_AMOUNT, asset: borrowerNftAsset },
        {
          script: lenderNftScriptAuthAddress.scriptPubkey,
          amount: NFT_AMOUNT,
          asset: lenderNftAsset,
        },
        { script: pendingOfferMetadataScript, amount: 0n, asset: policyAsset },
        { script: lendingScript, amount: offerParameters.collateralAmount, asset: policyAsset },
      ],
    }

    return {
      spec,
      feeRateSatPerKvb: feeRate,
      // TODO: Remove debug summary before release
      summary: {
        inputs: {
          '0 FactoryAuth': params.factoryAuthOutpoint,
          '1 IssuanceFactory covenant': params.issuanceFactoryOutpoint,
          [`2+ Collateral ${NETWORK_CONFIG.collateralAsset.symbol}`]:
            params.collateralOutpoints.join(', '),
          lenderNftIssuanceOutpoint: lenderNftIssuanceOutpointString,
        },
        outputs: {
          '0 FactoryAuth back to user': receiveExplicitAddress.toString(),
          '1 IssuanceFactory back to covenant': issuanceFactoryAddress.toString(),
          '2 Borrower NFT to user': receiveExplicitAddress.toString(),
          '3 Lender NFT to ScriptAuth': lenderNftScriptAuthAddress.toString(),
          '4 Metadata OP_RETURN': bytesToHex(pendingOfferMetadataScript.bytes()),
          '5 Lending covenant': lendingScriptPubkeyHex,
        },
        assetIds: {
          factoryAssetId: factoryAssetString,
          collateralAssetId: policyAssetString,
          principalAssetId: principalAssetString,
          borrowerNftAssetId: borrowerNftAssetString,
          lenderNftAssetId: lenderNftAssetString,
          protocolFeeKeeperAssetId: protocolFeeKeeperAssetString,
        },
        scripts: {
          lendingScriptHash: bytesToHex(lendingScriptHash),
          lenderVaultCovHash: bytesToHex(derivedLendingParams.lenderVaultCovHash),
          finalizedLenderVaultCovHash: bytesToHex(derivedLendingParams.finalizedLenderVaultCovHash),
          protocolFeeVaultCovHash: bytesToHex(derivedLendingParams.protocolFeeVaultCovHash),
          finalizedProtocolFeeVaultCovHash: bytesToHex(
            derivedLendingParams.finalizedProtocolFeeVaultCovHash,
          ),
          principalOutputScriptHash: bytesToHex(derivedLendingParams.principalOutputScriptHash),
        },
        offerParameters: {
          collateralAmount: offerParameters.collateralAmount.toString(),
          principalAmount: offerParameters.principalAmount.toString(),
          principalInterestRate: offerParameters.principalInterestRate.toString(),
          currentTime: currentTime.toString(),
          loanDurationSeconds: loanDurationSeconds.toString(),
          loanExpirationTime: offerParameters.loanExpirationTime.toString(),
        },
        metadataOpReturnHex: bytesToHex(pendingOfferMetadataScript.bytes()),
      },
    }
  }

  return { createOffer }
}
