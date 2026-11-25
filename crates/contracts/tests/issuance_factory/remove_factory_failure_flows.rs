use lending_contracts::programs::program::SimplicityProgram;

use lending_sdk::transaction::{FinalTransaction, PartialInput, RequiredSignature};

use super::setup::setup_issuance_factory;

#[test]
fn fails_to_remove_issuance_factory_with_invalid_inputs_order() -> anyhow::Result<()> {
    let context = lending_sdk::TestContext::new();
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let (factory_asset_id, issuance_factory, _) = setup_issuance_factory(&context, 2, 0)?;

    let random_signer = context.random_signer();

    let mut ft = FinalTransaction::new();

    let issuance_factory_utxo =
        provider.fetch_scripthash_utxos(&issuance_factory.get_script_pubkey())?[0].clone();

    let auth_nft_utxo = signer.get_utxos_asset(factory_asset_id)?[0].clone();

    ft.add_input(PartialInput::new(auth_nft_utxo), RequiredSignature::KeyPath);

    issuance_factory.attach_factory_removing(&mut ft, issuance_factory_utxo);

    let result = random_signer.finalize(&ft);

    assert!(
        result.is_err(),
        "expected finalize to fail, but it succeeded"
    );

    Ok(())
}
