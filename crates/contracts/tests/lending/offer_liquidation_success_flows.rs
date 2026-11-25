use lending_contracts::programs::program::SimplicityProgram;
use lending_sdk::provider::ProviderTrait;
use lending_sdk::signer::Signer;
use lending_sdk::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use lending_contracts::programs::lending::{LendingOffer, LendingOfferParameters, OfferParameters};

use super::common::wallet::split_first_signer_utxo;
use super::setup::{
    accept_pending_offer, fund_lender, setup_issuance_factory, setup_pending_offer,
};

fn default_offer_liquidation_setup(
    context: &lending_sdk::TestContext,
    lender: &Signer,
) -> anyhow::Result<(LendingOffer, LendingOfferParameters)> {
    let provider = context.get_default_provider();

    split_first_signer_utxo(context, vec![5000, 10000]);

    let issuance_factory = setup_issuance_factory(context)?;

    let principal_asset_amount = 200000;
    // Loans end at a unix time (an hour from the tip block).
    let current_time = u32::try_from(provider.fetch_tip_timestamp()?)?;

    let offer_parameters = OfferParameters {
        collateral_amount: 3000,
        principal_amount: 10000,
        loan_expiration_time: current_time + 3600,
        principal_interest_rate: 1000,
    };

    let (pending_offer_creation_txid, mut offer, offer_parameters) = setup_pending_offer(
        context,
        offer_parameters,
        issuance_factory,
        principal_asset_amount,
    )?;

    fund_lender(
        context,
        lender,
        offer_parameters.principal_asset_id,
        offer_parameters.offer_parameters.principal_amount,
    )?;

    let _ = accept_pending_offer(context, &mut offer, pending_offer_creation_txid, lender)?;

    Ok((offer, offer_parameters))
}

fn liquidation_ft(
    lending_offer: &LendingOffer,
    offer_parameters: &LendingOfferParameters,
    provider: &dyn ProviderTrait,
    lender: &Signer,
) -> anyhow::Result<FinalTransaction> {
    let active_offer_utxo =
        provider.fetch_scripthash_utxos(&lending_offer.get_script_pubkey())?[0].clone();
    let lender_nft_utxo = lender.get_utxos_asset(offer_parameters.lender_nft_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    lending_offer.attach_liquidation(&mut ft, active_offer_utxo);

    ft.add_input(
        PartialInput::new(lender_nft_utxo),
        RequiredSignature::KeyPath,
    );

    ft.add_output(PartialOutput::new(
        lender.get_address().script_pubkey(),
        offer_parameters.offer_parameters.collateral_amount,
        offer_parameters.collateral_asset_id,
    ));

    Ok(ft)
}

#[test]
fn offer_liquidation_succeeds_after_expiration_time() -> anyhow::Result<()> {
    let context = lending_sdk::TestContext::new();
    let provider = context.get_default_provider();
    let lender = context.random_signer();

    let (lending_offer, offer_parameters) = default_offer_liquidation_setup(&context, &lender)?;

    // An idle chain makes no blocks; the clock still moves, and the block that includes the
    // liquidation is stamped after the expiry.
    context.advance_time(3600);

    let ft = liquidation_ft(&lending_offer, &offer_parameters, provider, &lender)?;
    lender.broadcast(&ft)?.wait()?;

    assert!(
        provider.fetch_tip_timestamp()?
            > u64::from(offer_parameters.offer_parameters.loan_expiration_time)
    );

    Ok(())
}

#[test]
fn offer_liquidation_fails_before_expiration_time() -> anyhow::Result<()> {
    let context = lending_sdk::TestContext::new();
    let provider = context.get_default_provider();
    let lender = context.random_signer();

    let (lending_offer, offer_parameters) = default_offer_liquidation_setup(&context, &lender)?;

    let ft = liquidation_ft(&lending_offer, &offer_parameters, provider, &lender)?;
    let err = lender.broadcast(&ft).unwrap_err().to_string();
    assert!(err.contains("lock_time not reached"), "{err}");

    Ok(())
}
