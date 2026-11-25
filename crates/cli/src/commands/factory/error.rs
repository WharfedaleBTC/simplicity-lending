use lending_contracts::programs::issuance_factory::IssuanceFactoryError;
use lending_sdk::{provider::ProviderError, signer::SignerError};

#[derive(thiserror::Error, Debug)]
pub enum FactoryCommandError {
    #[error("Not a factory creation tx: {0}")]
    NotAFactoryCreationTx(#[from] IssuanceFactoryError),

    #[error("Factory program UTXO not found")]
    FactoryProgramUtxoNotFound,

    #[error("Auth NFT UTXO not found in signer wallet")]
    AuthNftUtxoNotFound,

    #[error("Signer error: {0}")]
    Signer(#[from] SignerError),

    #[error("Provider error: {0}")]
    Provider(#[from] ProviderError),
}
