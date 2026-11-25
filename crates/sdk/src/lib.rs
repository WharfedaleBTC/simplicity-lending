//! Wharfedale transaction layer for the lending protocol.
//!
//! Replaces Blockstream's `smplx-sdk` (Liquid networks, P2WPKH wallets) with what Wharfedale
//! accepts: Taproot key-path wallets, Simplicity programs under the BIP341 NUMS key, explicit
//! fee outputs in the chain's fee asset, and the chain's own genesis hash in every sighash.
//!
//! - [`program`]: a SimplicityHL program with storage leaves (hidden `TapData` nodes beside its
//!   leaf), compiled with SimplicityHL 0.9; satisfied and pruned against the real transaction.
//! - [`transaction`]: inputs, outputs, issuances and program inputs assembled into a transaction.
//! - [`provider`]: chain access ([`provider::NodeProvider`] for a node's RPC and Esplora API).
//! - [`keys`]: wallet keys, as the Wharfedale wallets derive them.
//! - [`signer`]: completes transactions: funds, blinds, signs and satisfies them.
//! - [`testing`] (feature `testing`): an in-process chain checked by Wharfedale's consensus code.

pub mod hex;
pub mod keys;
pub mod network;
pub mod program;
pub mod provider;
pub mod transaction;
pub mod value;

pub mod signer;
#[cfg(feature = "testing")]
pub mod testing;

pub use either;
pub use elements;
pub use simplicityhl;

pub use network::Network;
#[cfg(feature = "testing")]
pub use testing::TestContext;
