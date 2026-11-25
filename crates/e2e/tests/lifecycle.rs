//! The loan lifecycle on a running Wharfedale network with the lending indexer (`make e2e`):
//! a borrower and a lender (fresh keys funded by the chain's faucet key, which also issues a
//! throwaway principal asset for the test) take one offer to repayment and another to
//! liquidation, through the session flows, the node and the indexer.
//!
//! Inputs (set by `make e2e`): `NODE_URL` (a node's RPC and Esplora), `INDEXER_URL`,
//! `FAUCET_KEY` (the chain's faucet key file) and `LENDING_CONFIG` (the deployment's
//! config.json: its protocol fee keeper asset, which offers must use to be indexed).

use std::str::FromStr;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context, bail, ensure};
use lending_contracts::programs::lending::OfferParameters;
use lending_sdk::elements::{AssetId, Script};
use lending_sdk::hex::ToHex;
use lending_sdk::keys::WalletKey;
use lending_sdk::provider::NodeProvider;
use lending_sdk::signer::Signer;
use lending_sdk::transaction::{
    FinalTransaction, IssuanceInput, PartialInput, PartialOutput, RequiredSignature,
};
use lending_session::{CreateOfferParams, IndexerClient, Session};

const WBTC_COINS: [u64; 3] = [2_000_000, 2_000_000, 2_000_000];
const COLLATERAL: u64 = 3_000;
const PRINCIPAL: u64 = 10_000;
const INTEREST_BPS: u16 = 1_000;

struct Env {
    node_url: String,
    indexer_url: String,
    faucet: Signer,
    keeper: AssetId,
}

fn env() -> anyhow::Result<Env> {
    let var =
        |name: &str, default: &str| std::env::var(name).unwrap_or_else(|_| default.to_string());
    let node_url = var("NODE_URL", "http://127.0.0.1:18447");
    let indexer_url = var("INDEXER_URL", "http://127.0.0.1:8000");
    let config: serde_json::Value = serde_json::from_slice(&std::fs::read(var(
        "LENDING_CONFIG",
        "target/e2e/config.json",
    ))?)?;
    let keeper = config["protocolFeeAsset"]["id"]
        .as_str()
        .context("config has no protocolFeeAsset")?;
    Ok(Env {
        faucet: Signer::from_key(
            load_key(&var("FAUCET_KEY", "target/e2e/faucet.json"))?,
            Box::new(NodeProvider::new(&node_url)?),
        ),
        keeper: AssetId::from_str(keeper)?,
        node_url,
        indexer_url,
    })
}

/// A Wharfedale key file (`{"secret": "<hex>"}`).
fn load_key(path: &str) -> anyhow::Result<WalletKey> {
    let file: serde_json::Value = serde_json::from_slice(&std::fs::read(path)?)?;
    let secret: [u8; 32] = hex::decode(
        file["secret"]
            .as_str()
            .with_context(|| format!("{path} has no secret"))?,
    )?
    .try_into()
    .map_err(|_| anyhow::anyhow!("{path}: the secret is not 32 bytes"))?;
    Ok(WalletKey::from_secret(secret)?)
}

fn session(env: &Env, key: WalletKey) -> anyhow::Result<Session> {
    Ok(Session::new(
        Box::new(NodeProvider::new(&env.node_url)?),
        Signer::from_key(key, Box::new(NodeProvider::new(&env.node_url)?)),
        IndexerClient::new(&env.indexer_url)?,
    ))
}

fn now() -> u32 {
    u32::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs(),
    )
    .unwrap()
}

/// Pays explicit WBTC `amounts` to `to` from the faucet key.
fn fund(env: &Env, to: &Script, amounts: &[u64]) -> anyhow::Result<()> {
    let mut ft = FinalTransaction::new();
    for &amount in amounts {
        ft.add_output(PartialOutput::new(
            to.clone(),
            amount,
            env.faucet.get_network().policy_asset(),
        ));
    }
    env.faucet.broadcast(&ft)?.wait()?;
    Ok(())
}

/// Issues a new asset from a faucet coin, paid explicitly as `outputs` (script, amount).
fn issue(env: &Env, outputs: &[(Script, u64)]) -> anyhow::Result<AssetId> {
    let faucet = &env.faucet;
    let coin = faucet
        .get_utxos_asset(faucet.get_network().policy_asset())?
        .into_iter()
        .next()
        .context("the faucet key has no WBTC")?;
    let total = outputs.iter().map(|(_, amount)| amount).sum();
    let mut ft = FinalTransaction::new();
    let issued = ft.add_issuance_input(
        PartialInput::new(coin),
        IssuanceInput::new_issuance(total, 0, [0; 32]),
        RequiredSignature::KeyPath,
    );
    for (script, amount) in outputs {
        ft.add_output(PartialOutput::new(script.clone(), *amount, issued.asset_id));
    }
    faucet.broadcast(&ft)?.wait()?;
    Ok(issued.asset_id)
}

/// Retries `f` until it returns `Some`, for up to `secs` seconds (the indexer polls the node).
async fn eventually<T, F: std::future::Future<Output = anyhow::Result<Option<T>>>>(
    what: &str,
    secs: u64,
    f: impl Fn() -> F,
) -> anyhow::Result<T> {
    let deadline = Instant::now() + Duration::from_secs(secs);
    loop {
        match f().await {
            Ok(Some(v)) => return Ok(v),
            Ok(None) | Err(_) if Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(500)).await
            }
            Ok(None) => bail!("timed out waiting for {what}"),
            Err(e) => return Err(e.context(format!("waiting for {what}"))),
        }
    }
}

async fn offer_status(s: &Session, id: &str) -> anyhow::Result<String> {
    let details = s.indexer().get_offer(id).await?;
    let v = serde_json::to_value(&details)?;
    Ok(v["status"].as_str().unwrap_or_default().to_string())
}

/// Broadcasts and confirms a session transaction.
fn send(s: &Session, ft: &FinalTransaction) -> anyhow::Result<()> {
    s.signer().broadcast(ft)?.wait()?;
    Ok(())
}

/// Creates a factory and an offer for `borrower`; returns the offer id once indexed.
async fn create_offer(
    env: &Env,
    borrower: &Session,
    principal: AssetId,
    expires_at: u32,
) -> anyhow::Result<String> {
    let script = borrower.signer().key().script_pubkey().to_hex();
    let before = borrower
        .indexer()
        .get_offer_ids_by_script(&script)
        .await
        .unwrap_or_default();

    // One factory (the borrower's account) issues the NFTs of all their offers.
    if borrower
        .indexer()
        .get_factories_by_script(&script)
        .await
        .unwrap_or_default()
        .is_empty()
    {
        let factory = borrower.create_factory().await?;
        send(borrower, &factory.transaction)?;
        eventually("the factory to be indexed", 60, || async {
            Ok(
                Some(borrower.indexer().get_factories_by_script(&script).await?)
                    .filter(|f| !f.is_empty()),
            )
        })
        .await?;
    }

    let create = borrower
        .create_offer(CreateOfferParams {
            principal_asset_id: principal,
            protocol_fee_keeper_asset_id: env.keeper,
            offer_parameters: OfferParameters {
                collateral_amount: COLLATERAL,
                principal_amount: PRINCIPAL,
                loan_expiration_time: expires_at,
                principal_interest_rate: INTEREST_BPS,
            },
        })
        .await?;
    send(borrower, &create.transaction)?;
    eventually("the offer to be indexed", 60, || async {
        let ids = borrower.indexer().get_offer_ids_by_script(&script).await?;
        Ok(ids.into_iter().find(|id| !before.contains(id)))
    })
    .await
}

async fn wait_status(s: &Session, id: &str, status: &str) -> anyhow::Result<()> {
    eventually(&format!("offer {id} to be {status}"), 60, || async {
        Ok((offer_status(s, id).await? == status).then_some(()))
    })
    .await
}

#[tokio::test]
#[ignore = "needs the running network and lending stack: make e2e"]
async fn repay_and_liquidate() -> anyhow::Result<()> {
    let env = env()?;
    let policy = env.faucet.get_network().policy_asset();
    let (borrower_key, lender_key) = (WalletKey::generate(), WalletKey::generate());
    let (borrower_spk, lender_spk) = (borrower_key.script_pubkey(), lender_key.script_pubkey());
    fund(&env, &borrower_spk, &WBTC_COINS)?;
    fund(&env, &lender_spk, &WBTC_COINS)?;
    // A principal asset for this test: the lender lends twice; the borrower repays principal
    // plus interest once.
    let principal = issue(
        &env,
        &[
            (lender_spk.clone(), PRINCIPAL),
            (lender_spk, PRINCIPAL),
            (borrower_spk, 2 * PRINCIPAL),
        ],
    )?;
    let borrower = session(&env, borrower_key)?;
    let lender = session(&env, lender_key)?;

    // Repaid loan.
    let repaid = create_offer(&env, &borrower, principal, now() + 3_600).await?;
    wait_status(&borrower, &repaid, "pending").await?;
    send(&lender, &lender.accept_offer(&repaid).await?.transaction)?;
    wait_status(&borrower, &repaid, "active").await?;
    send(&borrower, &borrower.repay_offer(&repaid).await?)?;
    wait_status(&borrower, &repaid, "repaid").await?;
    println!("offer {repaid}: accepted and repaid");

    // Liquidated loan: a short term, liquidated once the chain's next block is past it. Before
    // that, the session refuses and the node would reject the time-locked spend.
    let expires_at = now() + 20;
    let liquidated = create_offer(&env, &borrower, principal, expires_at).await?;
    send(
        &lender,
        &lender.accept_offer(&liquidated).await?.transaction,
    )?;
    wait_status(&lender, &liquidated, "active").await?;
    ensure!(
        lender.liquidate_offer(&liquidated).await.is_err(),
        "liquidation allowed before the expiry"
    );
    while now() <= expires_at {
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    send(&lender, &lender.liquidate_offer(&liquidated).await?)?;
    wait_status(&lender, &liquidated, "liquidated").await?;
    let collateral: u64 = lender
        .signer()
        .get_utxos_asset(policy)?
        .iter()
        .filter(|u| u.amount() == COLLATERAL)
        .map(|u| u.amount())
        .sum();
    ensure!(
        collateral >= COLLATERAL,
        "the lender did not receive the collateral"
    );
    println!("offer {liquidated}: accepted and liquidated after its expiry");
    Ok(())
}
