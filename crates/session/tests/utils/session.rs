use lending_sdk::signer::Signer;
use lending_session::{IndexerClient, Session};
use sqlx::PgPool;

use super::db::setup_test_pool;

pub fn build_session(context: &lending_sdk::TestContext, indexer_base_url: &str) -> Session {
    build_session_with_signer(context, context.default_signer_copy(), indexer_base_url)
}

pub fn build_session_with_signer(
    context: &lending_sdk::TestContext,
    signer: Signer,
    indexer_base_url: &str,
) -> Session {
    let indexer = IndexerClient::new(indexer_base_url).expect("build indexer client");
    Session::new(context.provider(), signer, indexer)
}

pub async fn setup_it_context_pool() -> anyhow::Result<(lending_sdk::TestContext, PgPool)> {
    let pool = setup_test_pool().await?;
    Ok((lending_sdk::TestContext::new(), pool))
}
