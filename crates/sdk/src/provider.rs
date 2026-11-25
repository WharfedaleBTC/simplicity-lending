//! Chain access.

use elements::{Script, Transaction, Txid};

pub use crate::network::Network;
use crate::transaction::UTXO;

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("node: {0}")]
    Node(String),
    #[error("rejected: {0}")]
    Rejected(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("timed out waiting for {0}")]
    Timeout(String),
}

/// Fee rate in fee-asset units per 1 000 vbytes the signer pays: ten times the node's default
/// relay minimum (10), still a fraction of a satoshi per vbyte.
pub const DEFAULT_FEE_RATE: u64 = 100;

/// Smallest fee the signer pays, as the Wharfedale SDKs (`DEFAULT_FEE`).
pub const MIN_FEE: u64 = 100;

pub trait ProviderTrait {
    fn get_network(&self) -> &Network;

    /// Admits and relays a transaction.
    ///
    /// # Errors
    /// The node rejected it or couldn't be reached.
    fn broadcast_transaction(&self, tx: &Transaction) -> Result<Txid, ProviderError>;

    /// Returns once the transaction is in a block.
    ///
    /// # Errors
    /// Timeout or node errors.
    fn wait(&self, txid: &Txid) -> Result<(), ProviderError>;

    /// # Errors
    /// Node errors.
    fn fetch_tip_height(&self) -> Result<u32, ProviderError>;

    /// Timestamp of the tip block.
    ///
    /// # Errors
    /// Node errors.
    fn fetch_tip_timestamp(&self) -> Result<u64, ProviderError>;

    /// The earliest timestamp a block made now could carry: what time locks are checked
    /// against when a transaction is submitted (`max(now, tip + 1)`; the chain makes no blocks
    /// while idle, so the tip's own timestamp may be old).
    ///
    /// # Errors
    /// Node errors.
    fn fetch_next_block_time(&self) -> Result<u64, ProviderError> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_secs());
        Ok(now.max(self.fetch_tip_timestamp()? + 1))
    }

    /// # Errors
    /// Unknown transaction or node errors.
    fn fetch_transaction(&self, txid: &Txid) -> Result<Transaction, ProviderError>;

    /// Confirmed outputs paying `script`, not spent in the mempool.
    ///
    /// # Errors
    /// Node errors.
    fn fetch_scripthash_utxos(&self, script: &Script) -> Result<Vec<UTXO>, ProviderError>;

    /// Units per 1 000 vbytes.
    ///
    /// # Errors
    /// Node errors.
    fn fetch_fee_rate(&self, _target_blocks: u32) -> Result<u64, ProviderError> {
        Ok(DEFAULT_FEE_RATE)
    }
}

#[cfg(feature = "node")]
pub use node::NodeProvider;

#[cfg(feature = "node")]
mod node {
    use std::time::Duration;

    use elements::{OutPoint, Script, Transaction, Txid};
    use wharfedale_sdk::Client;

    use super::{ProviderError, ProviderTrait};
    use crate::network::Network;
    use crate::transaction::UTXO;

    /// A Wharfedale node's JSON-RPC and Esplora API (same URL).
    pub struct NodeProvider {
        client: Client,
        network: Network,
        timeout: Duration,
    }

    fn node(e: wharfedale_sdk::Error) -> ProviderError {
        ProviderError::Node(e.to_string())
    }

    impl NodeProvider {
        /// Connects and reads the chain's fee asset and genesis hash.
        ///
        /// # Errors
        /// The node can't be reached.
        pub fn new(url: impl Into<String>) -> Result<Self, ProviderError> {
            let client = Client::new(url);
            let info = client.chain_info().map_err(node)?;
            Ok(Self {
                client,
                network: Network::new(info.fee_asset, info.genesis_hash),
                timeout: Duration::from_secs(60),
            })
        }

        #[must_use]
        pub fn client(&self) -> &Client {
            &self.client
        }
    }

    impl ProviderTrait for NodeProvider {
        fn get_network(&self) -> &Network {
            &self.network
        }

        fn broadcast_transaction(&self, tx: &Transaction) -> Result<Txid, ProviderError> {
            self.client
                .send_transaction(tx)
                .map_err(|e| ProviderError::Rejected(e.to_string()))
        }

        fn wait(&self, txid: &Txid) -> Result<(), ProviderError> {
            self.client
                .wait_for_tx(txid, self.timeout)
                .map(|_| ())
                .map_err(node)
        }

        fn fetch_tip_height(&self) -> Result<u32, ProviderError> {
            let h = self.client.block_count().map_err(node)?;
            u32::try_from(h).map_err(|_| ProviderError::Node(format!("height {h}")))
        }

        fn fetch_tip_timestamp(&self) -> Result<u64, ProviderError> {
            let hash = self.client.rest_text("blocks/tip/hash").map_err(node)?;
            let block = self
                .client
                .rest(&format!("block/{}", hash.trim()))
                .map_err(node)?;
            block["timestamp"]
                .as_u64()
                .ok_or_else(|| ProviderError::Node(format!("block without timestamp: {block}")))
        }

        fn fetch_transaction(&self, txid: &Txid) -> Result<Transaction, ProviderError> {
            self.client
                .transaction(txid)
                .map_err(|e| ProviderError::NotFound(e.to_string()))
        }

        fn fetch_scripthash_utxos(&self, script: &Script) -> Result<Vec<UTXO>, ProviderError> {
            let mut out = Vec::new();
            for u in self.client.script_utxos(script).map_err(node)? {
                if u.spent_in_mempool {
                    continue;
                }
                let tx = self.fetch_transaction(&u.txid)?;
                let txout = tx
                    .output
                    .get(u.vout as usize)
                    .cloned()
                    .ok_or_else(|| ProviderError::NotFound(format!("{}:{}", u.txid, u.vout)))?;
                out.push(UTXO {
                    outpoint: OutPoint::new(u.txid, u.vout),
                    txout,
                    secrets: None,
                });
            }
            Ok(out)
        }

        fn fetch_fee_rate(&self, _target_blocks: u32) -> Result<u64, ProviderError> {
            Ok(super::DEFAULT_FEE_RATE)
        }
    }
}
