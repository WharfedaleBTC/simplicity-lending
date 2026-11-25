//! Transaction assembly: wallet inputs, program inputs, issuances and outputs, in order.

use elements::confidential::{
    Asset, AssetBlindingFactor, Nonce, Value as ConfValue, ValueBlindingFactor,
};
use elements::secp256k1_zkp::PublicKey;
use elements::{
    AssetBlindingNonce, AssetEntropy, AssetId, AssetIssuance, ContractHash, LockTime, OutPoint,
    Script, Sequence, Transaction, TxIn, TxOut, TxOutSecrets, TxOutWitness, Txid,
};
use serde_json::{Map, Value};

use crate::network::Network;
use crate::program::{Program, WitnessTrait};

/// An unspent output, with its opening if it is confidential and we could unblind it.
#[derive(Debug, Clone)]
pub struct UTXO {
    pub outpoint: OutPoint,
    pub txout: TxOut,
    pub secrets: Option<TxOutSecrets>,
}

impl UTXO {
    /// # Panics
    /// If the asset is confidential.
    #[must_use]
    pub fn explicit_asset(&self) -> AssetId {
        self.txout
            .asset
            .explicit()
            .expect("the UTXO's asset is not explicit")
    }

    /// # Panics
    /// If the amount is confidential.
    #[must_use]
    pub fn explicit_amount(&self) -> u64 {
        self.txout
            .value
            .explicit()
            .expect("the UTXO's amount is not explicit")
    }

    /// # Panics
    /// If the asset is confidential and the UTXO wasn't unblinded.
    #[must_use]
    pub fn asset(&self) -> AssetId {
        self.secrets
            .map_or_else(|| self.explicit_asset(), |s| s.asset)
    }

    /// # Panics
    /// If the amount is confidential and the UTXO wasn't unblinded.
    #[must_use]
    pub fn amount(&self) -> u64 {
        self.secrets
            .map_or_else(|| self.explicit_amount(), |s| s.value)
    }

    /// # Panics
    /// If the UTXO wasn't unblinded.
    #[must_use]
    pub fn unblinded_asset(&self) -> AssetId {
        self.secrets.expect("the UTXO is not unblinded").asset
    }

    /// # Panics
    /// If the UTXO wasn't unblinded.
    #[must_use]
    pub fn unblinded_amount(&self) -> u64 {
        self.secrets.expect("the UTXO is not unblinded").value
    }

    /// The opening the blinder needs (zero factors for an explicit output).
    ///
    /// # Panics
    /// If the output is confidential and the UTXO wasn't unblinded.
    #[must_use]
    pub fn opening(&self) -> TxOutSecrets {
        self.secrets
            .unwrap_or_else(|| explicit_secrets(self.explicit_asset(), self.explicit_amount()))
    }

    #[must_use]
    pub fn is_confidential(&self) -> bool {
        self.secrets.is_some()
    }
}

/// Opening of an explicit amount (zero blinding factors).
#[must_use]
pub fn explicit_secrets(asset: AssetId, value: u64) -> TxOutSecrets {
    TxOutSecrets::new(
        asset,
        AssetBlindingFactor::zero(),
        value,
        ValueBlindingFactor::zero(),
    )
}

/// Who satisfies an input: nobody (a program input carries its own witness), or the wallet's
/// key on the Taproot key path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequiredSignature {
    None,
    KeyPath,
}

#[derive(Debug, Clone)]
pub struct PartialInput {
    pub witness_txid: Txid,
    pub witness_output_index: u32,
    pub witness_utxo: TxOut,
    pub sequence: Sequence,
    pub locktime: LockTime,
    pub amount: Option<u64>,
    pub asset: Option<AssetId>,
    pub secrets: Option<TxOutSecrets>,
}

impl PartialInput {
    #[must_use]
    pub fn new(utxo: UTXO) -> Self {
        Self {
            witness_txid: utxo.outpoint.txid,
            witness_output_index: utxo.outpoint.vout,
            amount: utxo.txout.value.explicit(),
            asset: utxo.txout.asset.explicit(),
            witness_utxo: utxo.txout,
            sequence: Sequence::MAX,
            locktime: LockTime::ZERO,
            secrets: utxo.secrets,
        }
    }

    #[must_use]
    pub fn with_sequence(mut self, sequence: Sequence) -> Self {
        self.sequence = sequence;
        self
    }

    /// The transaction's nLockTime must be at least this (a height, or a unix time compared
    /// with the block's timestamp); the input also needs a non-final sequence.
    #[must_use]
    pub fn with_locktime(mut self, locktime: LockTime) -> Self {
        self.locktime = locktime;
        self
    }

    #[must_use]
    pub fn outpoint(&self) -> OutPoint {
        OutPoint::new(self.witness_txid, self.witness_output_index)
    }

    fn opening(&self) -> TxOutSecrets {
        self.secrets.unwrap_or_else(|| {
            explicit_secrets(
                self.asset.expect("explicit or unblinded input"),
                self.amount.expect("explicit or unblinded input"),
            )
        })
    }
}

#[derive(Debug, Clone)]
pub struct PartialOutput {
    pub script_pubkey: Script,
    pub amount: u64,
    pub asset: AssetId,
    pub blinding_key: Option<PublicKey>,
}

impl PartialOutput {
    #[must_use]
    pub fn new(script: Script, amount: u64, asset: AssetId) -> Self {
        Self {
            script_pubkey: script,
            amount,
            asset,
            blinding_key: None,
        }
    }

    /// `OP_RETURN <data>` carrying no value.
    #[must_use]
    pub fn new_metadata(data: &[u8]) -> Self {
        Self {
            script_pubkey: Script::new_op_return(data),
            amount: 0,
            asset: AssetId::default(),
            blinding_key: None,
        }
    }

    /// Blinded to `blinding_key` when the transaction is finalized.
    #[must_use]
    pub fn with_blinding_key(mut self, blinding_key: PublicKey) -> Self {
        self.blinding_key = Some(blinding_key);
        self
    }

    fn to_txout(&self) -> TxOut {
        TxOut {
            asset: Asset::Explicit(self.asset),
            value: ConfValue::Explicit(self.amount),
            // Elements convention: the receiver's blinding key travels in the nonce until blinding.
            nonce: self.blinding_key.map_or(Nonce::Null, Nonce::Confidential),
            script_pubkey: self.script_pubkey.clone(),
            witness: TxOutWitness::empty(),
        }
    }
}

/// A program and the witness that spends it.
#[derive(Clone, Debug)]
pub struct ProgramInput {
    pub program: Program,
    pub witness: Map<String, Value>,
}

impl ProgramInput {
    #[must_use]
    pub fn new(program: Program, witness: impl WitnessTrait) -> Self {
        Self {
            program,
            witness: witness.build_witness(),
        }
    }
}

#[derive(Clone, Debug)]
pub enum IssuanceInput {
    /// A new asset: `asset_entropy` is the issuance's contract hash.
    Issuance {
        issuance_amount: u64,
        inflation_amount: u64,
        asset_entropy: [u8; 32],
    },
    /// More of an existing asset: `asset_entropy` is the asset's entropy; the input spends a
    /// confidential reissuance token.
    Reissuance {
        issuance_amount: u64,
        asset_entropy: [u8; 32],
    },
}

impl IssuanceInput {
    #[must_use]
    pub fn new_issuance(
        issuance_amount: u64,
        inflation_amount: u64,
        asset_entropy: [u8; 32],
    ) -> Self {
        Self::Issuance {
            issuance_amount,
            inflation_amount,
            asset_entropy,
        }
    }

    #[must_use]
    pub fn new_reissuance(issuance_amount: u64, asset_entropy: [u8; 32]) -> Self {
        Self::Reissuance {
            issuance_amount,
            asset_entropy,
        }
    }
}

#[derive(Debug, Clone)]
pub struct IssuanceDetails {
    pub asset_id: AssetId,
    pub inflation_asset_id: AssetId,
    pub asset_entropy: AssetEntropy,
}

/// The entropy of a new issuance from `outpoint` with contract hash `entropy`.
#[must_use]
pub fn asset_entropy(outpoint: &OutPoint, entropy: [u8; 32]) -> AssetEntropy {
    AssetId::generate_asset_entropy(*outpoint, ContractHash::from_byte_array(entropy))
}

#[derive(Clone, Debug)]
pub struct FinalInput {
    pub partial_input: PartialInput,
    pub program_input: Option<ProgramInput>,
    pub issuance_input: Option<IssuanceInput>,
    pub required_sig: RequiredSignature,
}

impl FinalInput {
    #[must_use]
    pub fn new(partial_input: PartialInput, required_sig: RequiredSignature) -> Self {
        Self {
            partial_input,
            program_input: None,
            issuance_input: None,
            required_sig,
        }
    }

    #[must_use]
    pub fn get_issuance_details(&self) -> Option<IssuanceDetails> {
        let entropy = match self.issuance_input.as_ref()? {
            IssuanceInput::Issuance {
                asset_entropy: e, ..
            } => asset_entropy(&self.partial_input.outpoint(), *e),
            IssuanceInput::Reissuance {
                asset_entropy: e, ..
            } => AssetEntropy::from_byte_array(*e),
        };
        Some(IssuanceDetails {
            asset_id: AssetId::from_entropy(entropy),
            inflation_asset_id: AssetId::reissuance_token_from_entropy(entropy, false),
            asset_entropy: entropy,
        })
    }

    fn txin(&self) -> TxIn {
        let mut txin = TxIn {
            previous_output: self.partial_input.outpoint(),
            sequence: self.partial_input.sequence,
            ..Default::default()
        };
        match &self.issuance_input {
            None => {}
            Some(IssuanceInput::Issuance {
                issuance_amount,
                inflation_amount,
                asset_entropy,
            }) => {
                txin.asset_issuance = AssetIssuance {
                    asset_blinding_nonce: AssetBlindingNonce::NEW_ISSUANCE,
                    // A new issuance carries its contract hash here.
                    asset_entropy: AssetEntropy::from_byte_array(*asset_entropy),
                    amount: ConfValue::Explicit(*issuance_amount),
                    inflation_keys: if *inflation_amount > 0 {
                        ConfValue::Explicit(*inflation_amount)
                    } else {
                        ConfValue::Null
                    },
                };
            }
            Some(IssuanceInput::Reissuance {
                issuance_amount,
                asset_entropy,
            }) => {
                let token = self
                    .partial_input
                    .secrets
                    .expect("a reissuance spends a confidential token");
                txin.asset_issuance = AssetIssuance {
                    asset_blinding_nonce: AssetBlindingNonce::from_blinding_factor(token.asset_bf),
                    asset_entropy: AssetEntropy::from_byte_array(*asset_entropy),
                    amount: ConfValue::Explicit(*issuance_amount),
                    inflation_keys: ConfValue::Null,
                };
            }
        }
        txin
    }

    /// Surjection domain entries this input contributes after its spent output: the issued
    /// asset, then the reissuance tokens.
    fn issuance_openings(&self) -> Vec<TxOutSecrets> {
        let Some(details) = self.get_issuance_details() else {
            return Vec::new();
        };
        match &self.issuance_input {
            Some(IssuanceInput::Issuance {
                issuance_amount,
                inflation_amount,
                ..
            }) => {
                let mut v = vec![explicit_secrets(details.asset_id, *issuance_amount)];
                if *inflation_amount > 0 {
                    v.push(explicit_secrets(
                        details.inflation_asset_id,
                        *inflation_amount,
                    ));
                }
                v
            }
            Some(IssuanceInput::Reissuance {
                issuance_amount, ..
            }) => vec![explicit_secrets(details.asset_id, *issuance_amount)],
            None => Vec::new(),
        }
    }
}

/// A transaction being assembled. The signer funds it, blinds it, signs its wallet inputs and
/// satisfies its program inputs.
#[derive(Clone, Debug, Default)]
pub struct FinalTransaction {
    inputs: Vec<FinalInput>,
    outputs: Vec<PartialOutput>,
}

/// An assembled, unsigned transaction with what finalizing it needs.
#[derive(Clone, Debug)]
pub struct Unsigned {
    pub tx: Transaction,
    /// The output each input spends.
    pub prevouts: Vec<TxOut>,
    /// Surjection domain openings in consensus order.
    pub domain: Vec<TxOutSecrets>,
}

impl FinalTransaction {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_input(&mut self, partial_input: PartialInput, required_sig: RequiredSignature) {
        self.inputs
            .push(FinalInput::new(partial_input, required_sig));
    }

    pub fn add_program_input(
        &mut self,
        partial_input: PartialInput,
        program_input: ProgramInput,
        required_sig: RequiredSignature,
    ) {
        assert_eq!(
            required_sig,
            RequiredSignature::None,
            "a program input carries its own witness"
        );
        let mut input = FinalInput::new(partial_input, required_sig);
        input.program_input = Some(program_input);
        self.inputs.push(input);
    }

    pub fn add_issuance_input(
        &mut self,
        partial_input: PartialInput,
        issuance_input: IssuanceInput,
        required_sig: RequiredSignature,
    ) -> IssuanceDetails {
        let mut input = FinalInput::new(partial_input, required_sig);
        input.issuance_input = Some(issuance_input);
        self.push(input)
    }

    pub fn add_program_issuance_input(
        &mut self,
        partial_input: PartialInput,
        program_input: ProgramInput,
        issuance_input: IssuanceInput,
        required_sig: RequiredSignature,
    ) -> IssuanceDetails {
        assert_eq!(
            required_sig,
            RequiredSignature::None,
            "a program input carries its own witness"
        );
        let mut input = FinalInput::new(partial_input, required_sig);
        input.program_input = Some(program_input);
        input.issuance_input = Some(issuance_input);
        self.push(input)
    }

    fn push(&mut self, input: FinalInput) -> IssuanceDetails {
        let details = input.get_issuance_details().expect("an issuance input");
        self.inputs.push(input);
        details
    }

    pub fn remove_input(&mut self, index: usize) -> Option<FinalInput> {
        (index < self.inputs.len()).then(|| self.inputs.remove(index))
    }

    pub fn add_output(&mut self, partial_output: PartialOutput) {
        self.outputs.push(partial_output);
    }

    pub fn remove_output(&mut self, index: usize) -> Option<PartialOutput> {
        (index < self.outputs.len()).then(|| self.outputs.remove(index))
    }

    #[must_use]
    pub fn inputs(&self) -> &[FinalInput] {
        &self.inputs
    }

    pub fn inputs_mut(&mut self) -> &mut [FinalInput] {
        &mut self.inputs
    }

    #[must_use]
    pub fn outputs(&self) -> &[PartialOutput] {
        &self.outputs
    }

    pub fn outputs_mut(&mut self) -> &mut [PartialOutput] {
        &mut self.outputs
    }

    #[must_use]
    pub fn n_inputs(&self) -> usize {
        self.inputs.len()
    }

    #[must_use]
    pub fn n_outputs(&self) -> usize {
        self.outputs.len()
    }

    #[must_use]
    pub fn needs_blinding(&self) -> bool {
        self.outputs.iter().any(|o| o.blinding_key.is_some())
    }

    #[must_use]
    pub fn has_confidential_inputs(&self) -> bool {
        self.inputs
            .iter()
            .any(|i| i.partial_input.secrets.is_some())
    }

    /// Fee-asset inputs (and issuances of it) minus fee-asset outputs: what's left for the fee
    /// and change.
    #[must_use]
    pub fn calculate_fee_delta(&self, network: &Network) -> i64 {
        let policy = network.policy_asset();
        let mut available: i128 = 0;
        for input in &self.inputs {
            let o = input.partial_input.opening();
            if o.asset == policy {
                available += i128::from(o.value);
            }
            for extra in input.issuance_openings() {
                if extra.asset == policy {
                    available += i128::from(extra.value);
                }
            }
        }
        let consumed: i128 = self
            .outputs
            .iter()
            .filter(|o| o.asset == policy)
            .map(|o| i128::from(o.amount))
            .sum();
        i64::try_from(available - consumed).expect("amounts fit i64")
    }

    /// The transaction without witnesses or blinding. nLockTime is the largest any input asks
    /// for.
    #[must_use]
    pub fn to_unsigned(&self) -> Unsigned {
        let lock_time = self
            .inputs
            .iter()
            .map(|i| i.partial_input.locktime.to_consensus_u32())
            .max()
            .map_or(LockTime::ZERO, LockTime::from_consensus);
        let tx = Transaction {
            version: 2,
            lock_time,
            input: self.inputs.iter().map(FinalInput::txin).collect(),
            output: self.outputs.iter().map(PartialOutput::to_txout).collect(),
        };
        let prevouts = self
            .inputs
            .iter()
            .map(|i| i.partial_input.witness_utxo.clone())
            .collect();
        let mut domain = Vec::new();
        for input in &self.inputs {
            domain.push(input.partial_input.opening());
            domain.extend(input.issuance_openings());
        }
        Unsigned {
            tx,
            prevouts,
            domain,
        }
    }
}
