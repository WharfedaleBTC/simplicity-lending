use lending_contracts::programs::lending::{LendingOffer, LendingOfferParameters};
use lending_sdk::elements::Txid;
use lending_sdk::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use lending_contracts::programs::lending::OfferParameters;

use super::common::wallet::split_first_signer_utxo;
use super::setup::{
    accept_pending_offer, fund_lender, get_active_offer_utxos, get_pending_offer_utxos,
    setup_issuance_factory, setup_pending_offer,
};

fn default_offer_cancellation_setup(
    context: &lending_sdk::TestContext,
) -> anyhow::Result<(Txid, LendingOffer, LendingOfferParameters)> {
    let provider = context.get_default_provider();

    split_first_signer_utxo(context, vec![5000, 10000]);

    let issuance_factory = setup_issuance_factory(context)?;

    let principal_asset_amount = 20000;
    // Loans end at a unix time (an hour from the tip block).
    let current_time = u32::try_from(provider.fetch_tip_timestamp()?)?;

    let offer_parameters = OfferParameters {
        collateral_amount: 3000,
        principal_amount: 10000,
        loan_expiration_time: current_time + 3600,
        principal_interest_rate: 1000,
    };

    setup_pending_offer(
        context,
        offer_parameters,
        issuance_factory,
        principal_asset_amount,
    )
}

#[test]
fn offer_cancellation_fails_when_offer_is_not_pending() -> anyhow::Result<()> {
    let context = lending_sdk::TestContext::new();
    let borrower = context.get_default_signer();
    let lender = context.random_signer();

    let (pending_offer_creation_txid, mut pending_offer, offer_parameters) =
        default_offer_cancellation_setup(&context)?;

    fund_lender(
        &context,
        &lender,
        offer_parameters.principal_asset_id,
        offer_parameters.offer_parameters.principal_amount,
    )?;

    let offer_acceptance_txid = accept_pending_offer(
        &context,
        &mut pending_offer,
        pending_offer_creation_txid,
        &lender,
    )?;

    let (active_offer_utxo, lender_nft_utxo) =
        get_active_offer_utxos(&context, &pending_offer, offer_acceptance_txid)?;
    let borrower_nft_utxo =
        borrower.get_utxos_asset(offer_parameters.borrower_nft_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    pending_offer.attach_cancellation(&mut ft, active_offer_utxo, lender_nft_utxo);

    ft.add_input(
        PartialInput::new(borrower_nft_utxo),
        RequiredSignature::KeyPath,
    );

    ft.add_output(PartialOutput::new(
        borrower.get_address().script_pubkey(),
        offer_parameters.offer_parameters.collateral_amount,
        offer_parameters.collateral_asset_id,
    ));

    let result = borrower.finalize(&ft);

    assert!(
        result.is_err(),
        "expected finalize to fail, but it succeeded"
    );

    Ok(())
}

#[test]
fn offer_cancellation_fails_when_pending_offer_utxo_is_not_0_input_index() -> anyhow::Result<()> {
    let context = lending_sdk::TestContext::new();
    let borrower = context.get_default_signer();

    let (pending_offer_creation_txid, pending_offer, pending_offer_parameters) =
        default_offer_cancellation_setup(&context)?;

    let (pending_offer_utxo, lender_nft_utxo) =
        get_pending_offer_utxos(&context, &pending_offer, pending_offer_creation_txid)?;

    let borrower_nft_utxo =
        borrower.get_utxos_asset(pending_offer_parameters.borrower_nft_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(borrower_nft_utxo),
        RequiredSignature::KeyPath,
    );

    pending_offer.attach_cancellation(&mut ft, pending_offer_utxo, lender_nft_utxo);

    ft.add_output(PartialOutput::new(
        borrower.get_address().script_pubkey(),
        pending_offer_parameters.offer_parameters.collateral_amount,
        pending_offer_parameters.collateral_asset_id,
    ));

    let result = borrower.finalize(&ft);

    assert!(
        result.is_err(),
        "expected finalize to fail, but it succeeded"
    );

    Ok(())
}

#[test]
fn offer_cancellation_fails_when_collateral_utxo_is_on_0_output_index() -> anyhow::Result<()> {
    let context = lending_sdk::TestContext::new();
    let borrower = context.get_default_signer();

    let (pending_offer_creation_txid, pending_offer, pending_offer_parameters) =
        default_offer_cancellation_setup(&context)?;

    let (pending_offer_utxo, lender_nft_utxo) =
        get_pending_offer_utxos(&context, &pending_offer, pending_offer_creation_txid)?;

    let borrower_nft_utxo =
        borrower.get_utxos_asset(pending_offer_parameters.borrower_nft_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    ft.add_output(PartialOutput::new(
        borrower.get_address().script_pubkey(),
        pending_offer_parameters.offer_parameters.collateral_amount,
        pending_offer_parameters.collateral_asset_id,
    ));

    pending_offer.attach_cancellation(&mut ft, pending_offer_utxo, lender_nft_utxo);

    ft.add_input(
        PartialInput::new(borrower_nft_utxo),
        RequiredSignature::KeyPath,
    );

    let result = borrower.finalize(&ft);

    assert!(
        result.is_err(),
        "expected finalize to fail, but it succeeded"
    );

    Ok(())
}
