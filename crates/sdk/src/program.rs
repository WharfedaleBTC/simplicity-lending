//! A SimplicityHL program as a Taproot output, with optional storage.
//!
//! The output commits to one leaf `(script = CMR, version 0xbe)` and, beside it, one hidden
//! `TapData` node per storage slot, under the NUMS internal key. A program reads its own state
//! by rebuilding that tree (`jet::tapleaf_hash`, `jet::build_tapbranch`, `jet::tapdata_init`) and
//! comparing script hashes, so state changes move coins between outputs of the same program.

use std::iter;
use std::sync::{Arc, OnceLock};

use elements::secp256k1_zkp::{SECP256K1, XOnlyPublicKey};
use elements::taproot::{ControlBlock, LeafVersion, TapNodeHash, TaprootBuilder, TaprootSpendInfo};
use elements::{Address, BlockHash, Script, Transaction, TxOut};
use serde_json::{Map, Value};
use simplicity::Cmr;
use simplicity::jet::elements::{ElementsEnv, ElementsUtxo};
use simplicityhl::{CompiledProgram, TemplateAst, UnresolvedValues, ast::ElementsJetHinter};

use crate::network::{Network, hash_script, nums_key, tap_data_hash};

/// Taproot leaf version of Simplicity.
pub const LEAF_VERSION: u8 = 0xbe;

#[derive(Debug, thiserror::Error)]
pub enum ProgramError {
    #[error("compiling: {0}")]
    Compilation(String),
    #[error("arguments: {0}")]
    Arguments(String),
    #[error("witness: {0}")]
    Witness(String),
    #[error("program not satisfied by the transaction: {0}")]
    Satisfaction(String),
    #[error("input {input_index} out of {utxo_count} spent outputs")]
    UtxoIndexOutOfBounds {
        input_index: usize,
        utxo_count: usize,
    },
    #[error("input {0} does not spend this program's output")]
    ScriptPubkeyMismatch(usize),
}

/// `param::` values of a program, as SimplicityHL literals by name.
pub trait ArgumentsTrait {
    fn build_arguments(&self) -> Map<String, Value>;
}

/// `witness::` values of a program, as SimplicityHL literals by name.
pub trait WitnessTrait {
    fn build_witness(&self) -> Map<String, Value>;
}

impl<T: WitnessTrait + ?Sized> WitnessTrait for Box<T> {
    fn build_witness(&self) -> Map<String, Value> {
        (**self).build_witness()
    }
}

#[derive(Clone)]
pub struct Program {
    source: &'static str,
    arguments: Map<String, Value>,
    storage: Vec<[u8; 32]>,
    compiled: Arc<OnceLock<Result<Arc<CompiledProgram>, String>>>,
}

impl std::fmt::Debug for Program {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Program")
            .field("arguments", &self.arguments)
            .field("storage", &self.storage)
            .finish_non_exhaustive()
    }
}

impl Program {
    #[must_use]
    pub fn new(source: &'static str, arguments: &impl ArgumentsTrait) -> Self {
        Self {
            source,
            arguments: arguments.build_arguments(),
            storage: Vec::new(),
            compiled: Arc::default(),
        }
    }

    #[must_use]
    pub fn with_storage_capacity(mut self, capacity: usize) -> Self {
        self.storage = vec![[0u8; 32]; capacity];
        self
    }

    /// # Panics
    /// If `index` is beyond the storage capacity.
    pub fn set_storage_at(&mut self, index: usize, value: [u8; 32]) {
        *self
            .storage
            .get_mut(index)
            .expect("storage index out of bounds") = value;
    }

    #[must_use]
    pub fn get_storage(&self) -> &[[u8; 32]] {
        &self.storage
    }

    #[must_use]
    pub fn get_storage_len(&self) -> usize {
        self.storage.len()
    }

    #[must_use]
    pub fn get_storage_at(&self, index: usize) -> [u8; 32] {
        self.storage[index]
    }

    #[must_use]
    pub fn source(&self) -> &'static str {
        self.source
    }

    #[must_use]
    pub fn arguments(&self) -> &Map<String, Value> {
        &self.arguments
    }

    /// The compiled program (compiled once per set of arguments).
    ///
    /// # Errors
    /// The source does not compile, or the arguments don't match its parameters.
    pub fn load(&self) -> Result<Arc<CompiledProgram>, ProgramError> {
        self.compiled
            .get_or_init(|| compile(self.source, &self.arguments).map(Arc::new))
            .clone()
            .map_err(ProgramError::Compilation)
    }

    /// Commitment Merkle root: the program with its arguments.
    ///
    /// # Panics
    /// If the program does not compile (sources and arguments are fixed by the caller).
    #[must_use]
    pub fn cmr(&self) -> Cmr {
        self.load().expect("program compiles").commit().cmr()
    }

    fn leaf(&self) -> (Script, LeafVersion) {
        (
            Script::from(self.cmr().as_ref().to_vec()),
            LeafVersion::from_u8(LEAF_VERSION).expect("valid leaf version"),
        )
    }

    /// The program's leaf at depth `d[0]`, storage slots after it: the tree smplx builds, which
    /// the contracts rebuild on chain.
    #[must_use]
    pub fn taproot_spending_info(&self) -> TaprootSpendInfo {
        let depths = leaf_depths(1 + self.storage.len());
        let (script, version) = self.leaf();
        let mut builder = TaprootBuilder::new()
            .add_leaf_with_ver(depths[0], script, version)
            .expect("valid tree");
        for (slot, depth) in self.storage.iter().zip(depths.into_iter().skip(1)) {
            builder = builder
                .add_hidden(
                    depth,
                    TapNodeHash::from_byte_array(tap_data_hash(slot).to_byte_array()),
                )
                .expect("valid tree");
        }
        builder
            .finalize(SECP256K1, nums_key())
            .expect("complete tree")
    }

    #[must_use]
    pub fn control_block(&self) -> ControlBlock {
        self.taproot_spending_info()
            .control_block(&self.leaf())
            .expect("leaf is in the tree")
    }

    #[must_use]
    pub fn script_pubkey(&self) -> Script {
        Script::new_v1_p2tr_tweaked(self.taproot_spending_info().output_key())
    }

    /// Kept for the smplx signature; the script doesn't depend on the network.
    #[must_use]
    pub fn get_script_pubkey(&self, _network: &Network) -> Script {
        self.script_pubkey()
    }

    #[must_use]
    pub fn get_script_hash(&self, _network: &Network) -> [u8; 32] {
        hash_script(&self.script_pubkey())
    }

    /// Explicit address `wf1p…` (program outputs are never blinded).
    #[must_use]
    pub fn get_tr_address(&self, network: &Network) -> Address {
        Address::from_script(&self.script_pubkey(), None, network.address_params())
            .expect("taproot script")
    }

    /// Simplicity's environment for input `ix` of `tx`.
    ///
    /// # Errors
    /// `prevouts` doesn't cover input `ix`, or that input doesn't spend this program.
    pub fn get_env(
        &self,
        tx: &Transaction,
        prevouts: &[TxOut],
        ix: usize,
        genesis: BlockHash,
    ) -> Result<ElementsEnv<Arc<Transaction>>, ProgramError> {
        let spent = prevouts.get(ix).ok_or(ProgramError::UtxoIndexOutOfBounds {
            input_index: ix,
            utxo_count: prevouts.len(),
        })?;
        if spent.script_pubkey != self.script_pubkey() {
            return Err(ProgramError::ScriptPubkeyMismatch(ix));
        }
        Ok(ElementsEnv::new(
            Arc::new(tx.clone()),
            prevouts.iter().cloned().map(ElementsUtxo::from).collect(),
            u32::try_from(ix).expect("input index fits u32"),
            self.cmr(),
            self.control_block(),
            None,
            genesis,
        ))
    }

    /// The witness stack spending input `ix`: `[witness, program, cmr, control block]`. Runs
    /// the program against the transaction and prunes the branches it didn't take, as
    /// consensus requires; a witness that doesn't satisfy it fails here.
    ///
    /// # Errors
    /// See [`ProgramError`].
    pub fn finalize(
        &self,
        tx: &Transaction,
        prevouts: &[TxOut],
        ix: usize,
        genesis: BlockHash,
        witness: &Map<String, Value>,
    ) -> Result<Vec<Vec<u8>>, ProgramError> {
        let program = self.load()?;
        let env = self.get_env(tx, prevouts, ix, genesis)?;
        let values = serde_json::from_value::<UnresolvedValues>(Value::Object(witness.clone()))
            .map_err(|e| ProgramError::Witness(e.to_string()))?
            .resolve(program.witness_types())
            .map_err(ProgramError::Witness)?;
        let satisfied = program
            .satisfy_with_env(values, Some(&env))
            .map_err(ProgramError::Satisfaction)?;
        let (program_bytes, witness_bytes) = satisfied.redeem().to_vec_with_witness();
        Ok(vec![
            witness_bytes,
            program_bytes,
            self.cmr().as_ref().to_vec(),
            self.control_block().serialize(),
        ])
    }
}

/// Compiles `source` with `arguments` (SimplicityHL literals by parameter name).
///
/// # Errors
/// A message from the compiler or the argument parser.
pub fn compile(source: &str, arguments: &Map<String, Value>) -> Result<CompiledProgram, String> {
    let tmpl =
        TemplateAst::new(source, Box::new(ElementsJetHinter::new())).map_err(|e| e.to_string())?;
    let args = serde_json::from_value::<UnresolvedValues>(Value::Object(arguments.clone()))
        .map_err(|e| format!("arguments: {e}"))?
        .resolve(tmpl.parameters())
        .map_err(|e| format!("arguments: {e}"))?;
    tmpl.instantiate(args, false).map_err(|e| e.to_string())
}

/// Depths of a balanced tree of `n` leaves, deepest first (as smplx).
fn leaf_depths(n: usize) -> Vec<usize> {
    assert!(n > 0, "a taproot tree has at least one leaf");
    let next = n.next_power_of_two();
    let depth = next.ilog2() as usize;
    let shallow = next - n;
    let mut depths: Vec<usize> = iter::repeat_n(depth, n - shallow).collect();
    if depth > 0 {
        depths.extend(iter::repeat_n(depth - 1, shallow));
    }
    depths
}

/// Program outputs commit to their internal key for completeness; it's always NUMS.
#[must_use]
pub fn internal_key() -> XOnlyPublicKey {
    nums_key()
}

#[cfg(test)]
mod tests {
    use super::*;

    struct NoArgs;
    impl ArgumentsTrait for NoArgs {
        fn build_arguments(&self) -> Map<String, Value> {
            Map::new()
        }
    }

    #[test]
    fn depths_match_smplx() {
        assert_eq!(leaf_depths(1), vec![0]);
        assert_eq!(leaf_depths(3), vec![2, 2, 1]);
        assert_eq!(leaf_depths(4), vec![2, 2, 2, 2]);
    }

    #[test]
    fn storage_changes_the_output_not_the_cmr() {
        let a = Program::new("fn main() { assert!(true); }", &NoArgs).with_storage_capacity(2);
        let mut b = a.clone();
        b.set_storage_at(1, [1; 32]);
        assert_eq!(a.cmr(), b.cmr());
        assert_ne!(a.script_pubkey(), b.script_pubkey());
        // One leaf at depth 2: 33 + 2·32 bytes.
        assert_eq!(a.control_block().serialize().len(), 33 + 64);
    }
}
