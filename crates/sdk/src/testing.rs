//! An in-process Wharfedale chain for tests: every transaction is validated by the node's own
//! consensus code (`wharfedale-ledger`: amounts, proofs, Taproot, Simplicity, locks) and goes
//! into its own block. Time stands still until a test moves it ([`TestContext::advance_time`]),
//! as an idle Wharfedale chain makes no blocks.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use elements::confidential::{Asset, Nonce, Value as ConfValue};
use elements::{
    AssetId, BlockHash, OutPoint, Script, Transaction, TxIn, TxOut, TxOutWitness, Txid,
};
use rand::RngCore;
use wharfedale_ledger::{ChainCtx, MemoryLedger, UtxoEntry, connect_block};

use crate::keys::WalletKey as Key;
use crate::network::Network;
use crate::provider::{ProviderError, ProviderTrait};
use crate::signer::Signer;
use crate::transaction::UTXO;

/// Fee-asset units the default signer starts with: 1 000 BTC in one explicit coin.
pub const DEFAULT_FUNDS: u64 = 100_000_000_000;

/// Unix time of the first block (above the nLockTime threshold, like real time).
pub const START_TIME: u64 = 1_800_000_000;

struct State {
    ledger: MemoryLedger,
    utxos: BTreeMap<OutPoint, TxOut>,
    txs: HashMap<Txid, Transaction>,
    height: u64,
    /// Timestamp of the tip block.
    tip_time: u64,
    /// The test's clock: the next block is stamped `max(clock, tip_time + 1)`.
    clock: u64,
}

pub struct TestChain {
    network: Network,
    state: Mutex<State>,
}

impl TestChain {
    #[must_use]
    pub fn new(network: Network) -> Self {
        let mut ledger = MemoryLedger::new();
        ledger.set_block_time(0, START_TIME);
        Self {
            network,
            state: Mutex::new(State {
                ledger,
                utxos: BTreeMap::new(),
                txs: HashMap::new(),
                height: 0,
                tip_time: START_TIME,
                clock: START_TIME,
            }),
        }
    }

    fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Creates an explicit coin out of thin air (the genesis allocation of a test).
    pub fn fund(&self, script: &Script, asset: AssetId, value: u64) -> OutPoint {
        let mut tag = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut tag);
        let tx = Transaction {
            version: 2,
            lock_time: elements::LockTime::ZERO,
            input: vec![TxIn {
                previous_output: OutPoint::new(Txid::from_byte_array(tag), 0),
                ..Default::default()
            }],
            output: vec![TxOut {
                asset: Asset::Explicit(asset),
                value: ConfValue::Explicit(value),
                nonce: Nonce::Null,
                script_pubkey: script.clone(),
                witness: TxOutWitness::empty(),
            }],
        };
        let outpoint = OutPoint::new(tx.txid(), 0);
        let mut s = self.state();
        s.ledger
            .insert(outpoint, UtxoEntry::new(tx.output[0].clone(), 0, false));
        s.utxos.insert(outpoint, tx.output[0].clone());
        s.txs.insert(tx.txid(), tx);
        outpoint
    }

    /// Moves the clock forward: the next block is stamped at least this much later.
    pub fn advance_time(&self, seconds: u64) {
        let mut s = self.state();
        s.clock = s.clock.max(s.tip_time) + seconds;
    }

    fn submit(&self, tx: &Transaction) -> Result<Txid, ProviderError> {
        let mut s = self.state();
        let height = s.height + 1;
        let time = s.clock.max(s.tip_time + 1);
        let ctx = ChainCtx {
            height,
            time,
            genesis_hash: self.network.genesis_block_hash(),
            coinbase_maturity: 1,
        };
        let diff = connect_block(&s.ledger, std::slice::from_ref(tx), &ctx)
            .map_err(|e| ProviderError::Rejected(e.to_string()))?;
        s.ledger.apply(&diff);
        s.ledger.set_block_time(height, time);
        for (op, _) in &diff.spent {
            s.utxos.remove(op);
        }
        // From the transaction: the ledger's entries drop range proofs, which unblinding needs.
        for (op, _) in &diff.created {
            s.utxos.insert(*op, tx.output[op.vout as usize].clone());
        }
        s.txs.insert(tx.txid(), tx.clone());
        s.height = height;
        s.tip_time = time;
        Ok(tx.txid())
    }
}

/// A [`ProviderTrait`] over a shared [`TestChain`].
#[derive(Clone)]
pub struct TestProvider(pub Arc<TestChain>);

impl ProviderTrait for TestProvider {
    fn get_network(&self) -> &Network {
        &self.0.network
    }

    fn broadcast_transaction(&self, tx: &Transaction) -> Result<Txid, ProviderError> {
        self.0.submit(tx)
    }

    fn wait(&self, txid: &Txid) -> Result<(), ProviderError> {
        if self.0.state().txs.contains_key(txid) {
            Ok(())
        } else {
            Err(ProviderError::NotFound(txid.to_string()))
        }
    }

    fn fetch_tip_height(&self) -> Result<u32, ProviderError> {
        Ok(u32::try_from(self.0.state().height).expect("test heights fit u32"))
    }

    fn fetch_tip_timestamp(&self) -> Result<u64, ProviderError> {
        Ok(self.0.state().tip_time)
    }

    fn fetch_next_block_time(&self) -> Result<u64, ProviderError> {
        let s = self.0.state();
        Ok(s.clock.max(s.tip_time + 1))
    }

    fn fetch_transaction(&self, txid: &Txid) -> Result<Transaction, ProviderError> {
        self.0
            .state()
            .txs
            .get(txid)
            .cloned()
            .ok_or_else(|| ProviderError::NotFound(txid.to_string()))
    }

    fn fetch_scripthash_utxos(&self, script: &Script) -> Result<Vec<UTXO>, ProviderError> {
        Ok(self
            .0
            .state()
            .utxos
            .iter()
            .filter(|(_, o)| &o.script_pubkey == script)
            .map(|(op, o)| UTXO {
                outpoint: *op,
                txout: o.clone(),
                secrets: None,
            })
            .collect())
    }
}

/// A fresh chain per test, with a funded default signer.
pub struct TestContext {
    chain: Arc<TestChain>,
    signer: Signer,
}

impl Default for TestContext {
    fn default() -> Self {
        Self::new()
    }
}

impl TestContext {
    /// A chain with a random genesis hash and fee asset; the default signer holds
    /// [`DEFAULT_FUNDS`] of the fee asset in one explicit coin.
    #[must_use]
    pub fn new() -> Self {
        let mut bytes = [0u8; 64];
        rand::thread_rng().fill_bytes(&mut bytes);
        let network = Network::new(
            AssetId::from_byte_array(bytes[..32].try_into().expect("32 bytes")),
            BlockHash::from_byte_array(bytes[32..].try_into().expect("32 bytes")),
        );
        let chain = Arc::new(TestChain::new(network));
        let signer = Signer::from_key(Key::generate(), Box::new(TestProvider(chain.clone())));
        chain.fund(
            &signer.key().script_pubkey(),
            network.policy_asset(),
            DEFAULT_FUNDS,
        );
        Self { chain, signer }
    }

    #[must_use]
    pub fn get_default_signer(&self) -> &Signer {
        &self.signer
    }

    #[must_use]
    pub fn get_default_provider(&self) -> &dyn ProviderTrait {
        self.signer.get_provider()
    }

    #[must_use]
    pub fn get_network(&self) -> &Network {
        self.signer.get_network()
    }

    /// Another handle on the default signer's wallet.
    #[must_use]
    pub fn default_signer_copy(&self) -> Signer {
        self.create_signer(self.signer.key().clone())
    }

    /// A signer for `key` on this chain.
    #[must_use]
    pub fn create_signer(&self, key: Key) -> Signer {
        Signer::from_key(key, Box::new(TestProvider(self.chain.clone())))
    }

    /// A provider on this chain.
    #[must_use]
    pub fn provider(&self) -> Box<dyn ProviderTrait> {
        Box::new(TestProvider(self.chain.clone()))
    }

    /// A new, empty wallet on this chain.
    #[must_use]
    pub fn random_signer(&self) -> Signer {
        Signer::from_key(Key::generate(), Box::new(TestProvider(self.chain.clone())))
    }

    #[must_use]
    pub fn chain(&self) -> &Arc<TestChain> {
        &self.chain
    }

    /// See [`TestChain::advance_time`].
    pub fn advance_time(&self, seconds: u64) {
        self.chain.advance_time(seconds);
    }
}
