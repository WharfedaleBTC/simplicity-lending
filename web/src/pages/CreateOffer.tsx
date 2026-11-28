import { useMutation } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { LtvMeter, TxSteps } from '@/components/loans'
import {
  AppShell,
  ArrowRight,
  DetailList,
  NoWalletNotice,
  SectionHeading,
  TxLink,
} from '@/components/ui'
import { env } from '@/constants/env'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { BPS_DIVISOR, MAX_LTV, MAX_LTV_PERCENT } from '@/constants/offers'
import { RoutePath } from '@/constants/routes'
import { useBorrowerAccount } from '@/hooks/useBorrowerAccount'
import { useCreateOffer } from '@/hooks/useCreateOffer'
import { useFeeRateSatPerKvb } from '@/hooks/useFeeRate'
import { useChainNow } from '@/hooks/useLoans'
import { usePolicyAssetUtxos } from '@/hooks/usePolicyAssetUtxos'
import { useStandardTransactionFlow } from '@/hooks/useStandardTransactionFlow'
import {
  formatDateTime,
  formatPercent,
  formatPrincipal,
  formatUsdRounded,
  formatWbtc,
  wbtcUnit,
} from '@/lib/money'
import { useBtcUsd } from '@/lib/offerFigures'
import { useAssetDenomination } from '@/providers/assetDenomination/useAssetDenomination'
import { useChain } from '@/providers/chain/useChain'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { ISSUANCE_FACTORY_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/issuance-factory/program'
import { toBigintAmount } from '@/utils/bigint'
import { formatFeeReserve } from '@/utils/format'
import { computeApr, computeLtv, computeProtocolFee, feeToBps } from '@/utils/offers'
import { getBorrowerAccountPendingTx, getMempoolBlockingTx } from '@/utils/pendingTransactions'
import { formatPolicyAssetInputValue, parsePolicyAssetInput } from '@/utils/policyAssetDenomination'
import { selectByLargestFirst } from '@/utils/utxo'
import {
  estimateFeeBudgetSats,
  EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
  isConfirmedWalletUtxo,
  isPolicyAssetUtxo,
  utxoToOutpointString,
} from '@/wharfedale/utxo'

const CREATE_OFFER_WEIGHT_UNITS =
  EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY + ISSUANCE_FACTORY_MAX_WEIGHT_TO_SATISFY.IssueAssets
const MAX_INTEREST_RATE_BPS = 65_535
const MIN_PAYMENT = '0.1'
const MINUTE = 60
const DAY = 86_400

interface Term {
  seconds: number
  label: string
  demo?: boolean
}

const TERMS: Term[] = [
  ...(env.VITE_DEMO_MODE
    ? [
        { seconds: 3 * MINUTE, label: '3 minutes', demo: true },
        { seconds: 5 * MINUTE, label: '5 minutes', demo: true },
      ]
    : []),
  ...(env.DEV ? [{ seconds: 10 * MINUTE, label: '10 minutes', demo: true }] : []),
  { seconds: 7 * DAY, label: '7 days' },
  { seconds: 14 * DAY, label: '14 days' },
  { seconds: 30 * DAY, label: '30 days' },
  { seconds: 90 * DAY, label: '90 days' },
]

interface Errors {
  collateral?: string
  loan?: string
  interest?: string
}

export default function CreateOfferPage() {
  const { collateralAsset, principalAsset, protocolFeeAsset } = NETWORK_CONFIG
  const usdt = principalAsset.symbol
  const { isReady, scriptPubkey, syncWallet, getBlindedWalletUtxos } = useWallet()
  const { chainNetwork } = useChain()
  const { denomination, setDenomination } = useAssetDenomination()
  const unit = wbtcUnit(denomination)
  const btcUsd = useBtcUsd()
  const now = useChainNow()
  const { utxos, isLoading: utxosLoading } = usePolicyAssetUtxos(isReady)
  const { factoryState, hasAccount, createBorrowerAccount, refetchFactory } = useBorrowerAccount()
  const { createOffer } = useCreateOffer()
  const runStandardTransactionFlow = useStandardTransactionFlow()
  const { pendingTxs, addPendingTx } = usePendingTransactions()
  const feeRate = useFeeRateSatPerKvb(isReady)
  const feeBudget = useMemo(
    () => estimateFeeBudgetSats(CREATE_OFFER_WEIGHT_UNITS, feeRate, Math.max(utxos.length, 1)),
    [feeRate, utxos.length],
  )

  const [collateralText, setCollateralText] = useState('')
  const [loanText, setLoanText] = useState('')
  const [interestText, setInterestText] = useState('')
  const [term, setTerm] = useState(30 * DAY)
  const [touched, setTouched] = useState(false)
  // A first offer is two transactions, one click: the borrower account, then (once indexed)
  // the offer.
  const [postAfterAccount, setPostAfterAccount] = useState(false)

  const collateral = parsePolicyAssetInput(collateralText, denomination, collateralAsset)
  const loanValid = new RegExp(`^\\d+(\\.\\d{0,${principalAsset.decimals}})?$`)
  const loan = loanValid.test(loanText.trim())
    ? toBigintAmount(loanText.trim(), principalAsset.decimals)
    : null
  const interest = loanValid.test(interestText.trim())
    ? toBigintAmount(interestText.trim(), principalAsset.decimals)
    : null
  const balance = utxos.reduce((sum, utxo) => sum + utxo.value, 0n)
  const maxCollateral = balance > feeBudget ? balance - feeBudget : 0n
  const minPayment = toBigintAmount(MIN_PAYMENT, principalAsset.decimals)
  const bps = loan && interest ? feeToBps(interest, loan) : 0
  const ltv =
    collateral && loan
      ? computeLtv({
          principal: loan,
          principalDecimals: principalAsset.decimals,
          collateral,
          collateralDecimals: collateralAsset.decimals,
          collateralUsd: btcUsd,
        })
      : null

  const errors: Errors = {}
  if (collateral === null) {
    errors.collateral =
      denomination === 'sats' ? `Enter a whole number of ${unit}.` : 'Enter a valid amount.'
  } else if (collateral <= 0n) {
    errors.collateral = `Enter the ${unit} to lock.`
  } else if (!utxosLoading && collateral > maxCollateral) {
    errors.collateral = `At most ${formatWbtc(maxCollateral, denomination)} ${unit}: the rest pays network fees.`
  }
  if (loan === null || loan <= 0n) errors.loan = 'Enter the loan amount.'
  else if (loan < minPayment) errors.loan = `At least ${MIN_PAYMENT} ${usdt}.`
  else if (ltv !== null && ltv > MAX_LTV) {
    errors.loan = `Above the ${MAX_LTV_PERCENT}% LTV maximum: borrow less or lock more.`
  }
  if (interest === null || interest <= 0n) errors.interest = 'Enter the interest.'
  else if (interest < minPayment) errors.interest = `At least ${MIN_PAYMENT} ${usdt}.`
  else if (loan && bps > MAX_INTEREST_RATE_BPS) {
    const max = (loan * BigInt(MAX_INTEREST_RATE_BPS + 1) - 1n) / BPS_DIVISOR
    errors.interest = `At most ${formatPrincipal(max)} ${usdt} for this loan (${(MAX_INTEREST_RATE_BPS / 100).toFixed(2)}%).`
  }
  const valid = !errors.collateral && !errors.loan && !errors.interest

  const accountTx = scriptPubkey ? getBorrowerAccountPendingTx(scriptPubkey, pendingTxs) : null
  const accountPending = !hasAccount && accountTx !== null
  const blocking = getMempoolBlockingTx(pendingTxs)

  const account = useMutation({
    mutationFn: () => runStandardTransactionFlow(createBorrowerAccount),
    onSuccess: result => {
      void addPendingTx({
        txid: result.txid,
        kind: 'create_borrower_account',
        walletScriptPubkey: scriptPubkey ?? '',
      })
      refetchFactory()
    },
  })

  const post = async () => {
    const { txid } = await runStandardTransactionFlow(async () => {
      if (!factoryState) throw new Error('No borrower account yet: create it first.')
      if (!collateral || !loan) throw new Error('Fill in the offer first.')
      // Coins as they are now, not as the form read them: a borrower account made a moment ago
      // spent one and left change.
      await syncWallet()
      const policyAsset = chainNetwork.policyAsset()
      const fresh = (await getBlindedWalletUtxos())
        .filter(coin => isConfirmedWalletUtxo(coin) && isPolicyAssetUtxo(coin, policyAsset))
        .map(coin => ({ outpoint: utxoToOutpointString(coin), value: coin.unblinded().value() }))
      const coins = selectByLargestFirst(fresh, collateral + feeBudget)
      if (!coins) {
        throw new Error(
          `Not enough confirmed ${collateralAsset.symbol} for the collateral and a fee reserve of ${formatFeeReserve(feeBudget)}.`,
        )
      }
      return createOffer({
        factoryAuthOutpoint: factoryState.factoryAuthOutpoint,
        issuanceFactoryOutpoint: factoryState.issuanceFactoryOutpoint,
        factoryAssetId: factoryState.factoryAssetId,
        collateralOutpoints: coins.map(utxo => utxo.outpoint),
        collateralAmount: collateral,
        principalAssetId: principalAsset.id,
        principalAmount: loan,
        principalInterestRate: bps,
        loanDurationSeconds: term,
        protocolFeeKeeperAssetId: protocolFeeAsset.id,
      })
    })
    refetchFactory()
    return txid
  }

  const offer = useMutation({
    mutationFn: post,
    onSuccess: txid => {
      void addPendingTx({ txid, kind: 'create_offer', walletScriptPubkey: scriptPubkey ?? '' })
    },
  })

  const running = account.isPending || offer.isPending
  const activeTx = offer.status !== 'idle' ? offer : account
  const expires = now + term
  const collateralUsd =
    collateral && collateral > 0n
      ? formatUsdRounded(collateral, collateralAsset.decimals, btcUsd)
      : null
  const protocolFee = interest ? computeProtocolFee(interest) : 0n
  const apr = bps ? computeApr(bps, term) : null

  const switchUnit = (next: 'lbtc' | 'sats') => {
    if (next === denomination) return
    if (collateral !== null && collateral > 0n) {
      setCollateralText(formatPolicyAssetInputValue(collateral, next, collateralAsset))
    }
    setDenomination(next)
  }

  const lockLabel = `Lock ${collateral && collateral > 0n ? `${formatWbtc(collateral, denomination)} ${unit}` : unit} and post`
  const waitingForAccount = postAfterAccount && offer.status === 'idle'
  const button = {
    label: waitingForAccount && !running ? 'Waiting for the account…' : lockLabel,
    disabled:
      !isReady ||
      running ||
      waitingForAccount ||
      offer.isSuccess ||
      (blocking !== null && !(accountPending && !hasAccount)),
    onClick: () => {
      setTouched(true)
      if (!valid) return
      if (hasAccount) {
        offer.mutate()
        return
      }
      setPostAfterAccount(true)
      if (!accountPending) account.mutate()
    },
  }

  // Post the offer as soon as the account it needs is indexed and its transaction is in a block.
  const readyToPost =
    postAfterAccount &&
    hasAccount &&
    factoryState !== null &&
    offer.status === 'idle' &&
    blocking === null &&
    valid
  const postOffer = offer.mutate
  useEffect(() => {
    if (readyToPost) postOffer()
  }, [readyToPost, postOffer])

  const twoSteps = postAfterAccount || account.status !== 'idle' || !hasAccount
  const stage =
    offer.status !== 'idle'
      ? twoSteps
        ? 'Transaction 2 of 2 · the offer'
        : 'The offer'
      : 'Transaction 1 of 2 · borrower account'

  const show = (field: keyof Errors, text: string) =>
    touched || text.trim() !== '' ? errors[field] : undefined

  return (
    <AppShell
      section='Borrow — New offer'
      title='Offer a loan'
      lede={`Lock ${collateralAsset.symbol} and name your terms. When a lender accepts, you claim the ${usdt}; repay it with the interest by the expiry and the ${collateralAsset.symbol} comes back.`}
      back={{ to: RoutePath.Borrow, label: 'Your borrowing' }}
    >
      {!isReady ? (
        <NoWalletNotice doing='borrow' />
      ) : (
        <div className='split'>
          <div className='split__main stack-xl'>
            <form
              className='form-stack'
              noValidate
              onSubmit={event => {
                event.preventDefault()
                button.onClick()
              }}
            >
              <section className='stack-md'>
                <SectionHeading label='01' title='Collateral' />
                <div className='field'>
                  <div className='field-row'>
                    <label htmlFor='collateral'>{collateralAsset.symbol} to lock</label>
                    <div className='unit-toggle' role='group' aria-label='Unit'>
                      <button
                        type='button'
                        aria-pressed={denomination === 'lbtc'}
                        onClick={() => switchUnit('lbtc')}
                      >
                        {collateralAsset.symbol}
                      </button>
                      <button
                        type='button'
                        aria-pressed={denomination === 'sats'}
                        onClick={() => switchUnit('sats')}
                      >
                        {NETWORK_CONFIG.policyAssetSatsUnit}
                      </button>
                    </div>
                  </div>
                  <div className='amount'>
                    <input
                      id='collateral'
                      inputMode='decimal'
                      autoComplete='off'
                      placeholder='0'
                      value={collateralText}
                      aria-invalid={Boolean(show('collateral', collateralText))}
                      aria-describedby='collateral-hint'
                      onChange={event => setCollateralText(event.target.value)}
                    />
                    <span className='amount__unit'>{unit}</span>
                    <button
                      className='button accent button--sm'
                      type='button'
                      onClick={() =>
                        setCollateralText(
                          formatPolicyAssetInputValue(maxCollateral, denomination, collateralAsset),
                        )
                      }
                    >
                      Max
                    </button>
                  </div>
                  <span className='hint' id='collateral-hint'>
                    {collateralUsd ? `≈ ${collateralUsd} · ` : ''}available{' '}
                    {formatWbtc(balance, denomination)} {unit}; Max keeps{' '}
                    {formatFeeReserve(feeBudget)} for network fees
                  </span>
                  {show('collateral', collateralText) && (
                    <span className='field-error'>{errors.collateral}</span>
                  )}
                </div>
              </section>

              <section className='stack-md'>
                <SectionHeading label='02' title='Loan' />
                <div className='grid2'>
                  <div className='field'>
                    <label htmlFor='loan'>Loan amount</label>
                    <div className='amount'>
                      <input
                        id='loan'
                        inputMode='decimal'
                        autoComplete='off'
                        placeholder='0'
                        value={loanText}
                        aria-invalid={Boolean(show('loan', loanText))}
                        onChange={event => setLoanText(event.target.value)}
                      />
                      <span className='amount__unit'>{usdt}</span>
                    </div>
                    <span className='hint'>
                      At least {MIN_PAYMENT} {usdt}, and at most {MAX_LTV_PERCENT}% of the
                      collateral value.
                    </span>
                    {show('loan', loanText) && <span className='field-error'>{errors.loan}</span>}
                  </div>
                  <div className='field'>
                    <label htmlFor='interest'>Interest</label>
                    <div className='amount'>
                      <input
                        id='interest'
                        inputMode='decimal'
                        autoComplete='off'
                        placeholder='0'
                        value={interestText}
                        aria-invalid={Boolean(show('interest', interestText))}
                        onChange={event => setInterestText(event.target.value)}
                      />
                      <span className='amount__unit'>{usdt}</span>
                    </div>
                    <span className='hint'>
                      The total the lender earns, paid with the repayment. At least {MIN_PAYMENT}{' '}
                      {usdt}.
                    </span>
                    {show('interest', interestText) && (
                      <span className='field-error'>{errors.interest}</span>
                    )}
                  </div>
                </div>
              </section>

              <section className='stack-md'>
                <SectionHeading label='03' title='Term' />
                <fieldset className='term-grid'>
                  <legend className='sr-only'>Term</legend>
                  {TERMS.map(t => (
                    <label key={t.seconds} className='radio-card' aria-label={t.label}>
                      <input
                        type='radio'
                        name='term'
                        checked={term === t.seconds}
                        onChange={() => setTerm(t.seconds)}
                      />
                      <span>
                        <strong>{t.label}</strong>
                        <small>
                          {t.demo
                            ? 'demo only'
                            : `until ${new Date((now + t.seconds) * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
                        </small>
                      </span>
                    </label>
                  ))}
                </fieldset>
              </section>
            </form>
          </div>

          <aside className='split__aside sticky'>
            <div className='panel panel--dark on-dark stack-lg'>
              <span className='label label--mark'>Your offer</span>
              <LtvMeter ltv={ltv} />
              <DetailList
                rows={[
                  ['Collateral value', collateralUsd ?? '—'],
                  ['APR', apr === null ? '—' : formatPercent(apr)],
                  [
                    'You repay',
                    loan && interest ? `${formatPrincipal(loan + interest)} ${usdt}` : '—',
                    'total',
                  ],
                  ['By', formatDateTime(expires)],
                  [
                    'Lender keeps',
                    interest
                      ? `${formatPrincipal(interest - protocolFee)} ${usdt} after the 10% fee`
                      : '—',
                  ],
                ]}
              />
              <button
                className='button accent button--lg button--full'
                type='button'
                disabled={button.disabled}
                aria-busy={running}
                onClick={button.onClick}
              >
                {running ? 'Working…' : button.label}
                {!running && <ArrowRight />}
              </button>
              {twoSteps && (
                <ol className='steps-list steps-list--compact'>
                  <li data-state={hasAccount ? 'done' : 'active'}>
                    <span className='index-no'>01</span>
                    <span>Borrower account: your first offer only</span>
                  </li>
                  <li
                    data-state={
                      offer.isSuccess
                        ? 'done'
                        : hasAccount || offer.status !== 'idle'
                          ? 'active'
                          : undefined
                    }
                  >
                    <span className='index-no'>02</span>
                    <span>Lock the {collateralAsset.symbol} and post the offer</span>
                  </li>
                </ol>
              )}
              {activeTx.status !== 'idle' && <span className='label'>{stage}</span>}
              {activeTx.status !== 'idle' && (
                <TxSteps
                  status={activeTx.status}
                  txid={
                    activeTx.data &&
                    (typeof activeTx.data === 'string' ? activeTx.data : activeTx.data.txid)
                  }
                />
              )}
              {offer.isSuccess && (
                <p className='notice notice--ok'>
                  Offer posted: transaction <TxLink txid={offer.data} />.{' '}
                  <Link className='text-link' to={RoutePath.Borrow}>
                    Your borrowing →
                  </Link>
                </p>
              )}
              {activeTx.isError && (
                <button
                  type='button'
                  className='button outline-light'
                  onClick={() => {
                    activeTx.reset()
                    setPostAfterAccount(false)
                  }}
                >
                  Try again
                </button>
              )}
              {waitingForAccount && !running && (
                <p className='hint'>
                  The account is in; the offer posts by itself once it is indexed, in a few seconds.
                </p>
              )}
              {blocking !== null && !running && !activeTx.isSuccess && !waitingForAccount && (
                <p className='hint'>
                  A transaction of this wallet is waiting for a block; one at a time.
                </p>
              )}
            </div>
          </aside>
        </div>
      )}
    </AppShell>
  )
}
