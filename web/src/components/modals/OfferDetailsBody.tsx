import { useMemo } from 'react'

import { useBlockTimestamps, useChainTime } from '@/api/esplora/hooks'
import type { OfferShort } from '@/api/indexer/schemas'
import { useAssetPriceUsd } from '@/api/prices/hooks'
import BalanceCard from '@/components/BalanceCard'
import DetailsPanel, { type DetailRow } from '@/components/DetailsPanel'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { APR_TOOLTIP, PROTOCOL_FEE_LABEL, PROTOCOL_FEE_TOOLTIP } from '@/constants/offers'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import { useWallet } from '@/providers/wallet/useWallet'
import { formatTermLeft, truncateAddress } from '@/utils/format'
import {
  calcInterest,
  computeApr,
  computeLtv,
  computeProtocolFee,
  formatOfferTermLeft,
  formatUnixTime,
  getOfferDurationSeconds,
} from '@/utils/offers'

interface OfferDetailsBodyProps {
  offer: OfferShort
  highlightTerm?: boolean
  showBalance?: boolean
}

export default function OfferDetailsBody({
  offer,
  highlightTerm,
  showBalance = true,
}: OfferDetailsBodyProps) {
  const { principalAsset, collateralAsset } = NETWORK_CONFIG
  const { confirmedBalances, pendingBalances, isReady } = useWallet()
  const { formatCollateralDisplay, formatPrincipalAmount } = useFormatAmount()
  const { data: currentTime } = useChainTime()
  const createdTimes = useBlockTimestamps([offer.created_at_height])
  const collateralUsd = useAssetPriceUsd(collateralAsset.id)

  const loanInfoRows = useMemo<DetailRow[]>(() => {
    const interest = calcInterest(offer.principal_amount, offer.interest_rate)
    const loanDurationSeconds = getOfferDurationSeconds(
      offer,
      createdTimes[offer.created_at_height],
    )
    const borrower = offer.participants.find(p => p.participant_type === 'borrower')
    const ltv = computeLtv({
      principal: offer.principal_amount,
      principalDecimals: principalAsset.decimals,
      collateral: offer.collateral_amount,
      collateralDecimals: collateralAsset.decimals,
      collateralUsd,
    })

    const rows: DetailRow[] = [
      {
        label: 'Offer ID',
        value: truncateAddress(offer.id),
        copyValue: offer.id,
        tooltip: 'The unique identifier of this offer in the system.',
      },
      {
        label: 'Collateral Amount',
        value: formatCollateralDisplay(offer.collateral_amount),
        tooltip: `The ${NETWORK_CONFIG.collateralAsset.symbol} you locked as collateral for this loan.`,
      },
      {
        label: 'Loan Amount',
        value: formatPrincipalAmount(offer.principal_amount),
        tooltip: `The ${NETWORK_CONFIG.principalAsset.symbol} you borrowed and now repay.`,
      },
      {
        label: 'Expected Earning',
        value: formatPrincipalAmount(interest),
        tooltip: 'The interest you earn when the borrower repays this loan.',
      },
      {
        label: PROTOCOL_FEE_LABEL,
        value: formatPrincipalAmount(computeProtocolFee(interest)),
        tooltip: PROTOCOL_FEE_TOOLTIP,
        multilineTooltip: true,
      },
      {
        label: 'APR',
        value: `${computeApr(offer.interest_rate, loanDurationSeconds).toFixed(2)}%`,
        tooltip: APR_TOOLTIP,
      },
      {
        label: 'LTV & Risk Level',
        value: ltv === null ? '—' : `${(ltv * 100).toFixed(2)}%`,
        tooltip:
          "Your loan as a percentage of your collateral's value. Higher percentage means higher risk.",
      },
    ]

    if (borrower) {
      rows.push({
        label: 'Borrower ID',
        value: truncateAddress(borrower.script_pubkey),
        tooltip: 'The address of the borrower who took this loan.',
      })
    }

    return rows
  }, [
    offer,
    createdTimes,
    formatCollateralDisplay,
    formatPrincipalAmount,
    principalAsset,
    collateralAsset,
    collateralUsd,
  ])

  const termRows = useMemo<DetailRow[]>(
    () => [
      {
        label: 'Term Left',
        value: formatOfferTermLeft(offer, currentTime),
        tooltip: 'Time left to repay before the loan is due.',
      },
      {
        label: 'Repayment Due',
        value: formatUnixTime(offer.loan_expiration_time),
        tooltip: 'When your repayment is due by.',
      },
      {
        label: 'Time to Liquidation',
        value: formatTermLeft(offer.loan_expiration_time - currentTime),
        tooltip:
          "Time left before the lender can claim your collateral if it's unpaid: after this, the first Wharfedale block can include the liquidation.",
      },
    ],
    [offer, currentTime],
  )

  return (
    <div className='flex flex-col gap-6'>
      {showBalance && isReady && (
        <BalanceCard
          asset={principalAsset}
          amount={BigInt(confirmedBalances[principalAsset.id] ?? 0)}
          pendingAmount={BigInt(pendingBalances[principalAsset.id] ?? 0)}
        />
      )}
      <DetailsPanel title='Loan info' rows={loanInfoRows} />
      <DetailsPanel title='Term' rows={termRows} bordered={highlightTerm} />
    </div>
  )
}
