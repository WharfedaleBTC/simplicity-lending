use std::num::TryFromIntError;

use lending_sdk::{elements::Txid, provider::ProviderError};

#[derive(thiserror::Error, Debug)]
pub enum LendingOfferError {
    #[error("Passed transaction is not a lending creation transaction")]
    NotALendingOfferCreationTx(Txid),

    #[error("Invalid creation OP_RETURN data length: expected - {expected}, actual - {actual}")]
    InvalidCreationMetadataLength { expected: usize, actual: usize },

    #[error("Invalid OP_RETURN borrower pubkey bytes: {0}")]
    InvalidMetadataBytes(String),

    #[error("OP_RETURN asset id is not 32 bytes")]
    FromSlice(#[from] std::array::TryFromSliceError),

    #[error(transparent)]
    Provider(#[from] ProviderError),

    #[error("Failed to calculate interest rate: {0}")]
    TryFromInt(#[from] TryFromIntError),
}
