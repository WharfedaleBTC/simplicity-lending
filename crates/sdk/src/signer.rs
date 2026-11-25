//! A wallet key that completes transactions: adds fee-asset coins and change, blinds when it
//! spends confidential coins, signs its inputs on the Taproot key path and satisfies program
//! inputs.

use std::fmt;

use elements::secp256k1_zkp::{Message, PublicKey, SECP256K1, XOnlyPublicKey};
use elements::sighash::{Prevouts, SighashCache};
use elements::{Address, AssetId, SchnorrSighashType, Script, Transaction, TxOut, Txid, Witness};

use crate::keys::{KeyError, WalletKey as Key};
use crate::network::Network;
use crate::program::ProgramError;
use crate::provider::{MIN_FEE, ProviderError, ProviderTrait};
use crate::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature, UTXO};

#[derive(Debug, thiserror::Error)]
pub enum SignerError {
    #[error(transparent)]
    Provider(#[from] ProviderError),
    #[error(transparent)]
    Program(#[from] ProgramError),
    #[error(transparent)]
    Key(#[from] KeyError),
    #[error("not enough {asset} to pay a fee of {fee}")]
    NotEnoughFunds { asset: AssetId, fee: u64 },
    #[error("inputs leave {0} of the fee asset, below the minimum fee")]
    DustAmount(i64),
    #[error("inputs leave {available} of the fee asset, the fee is {required}")]
    NotEnoughFeeAmount { available: i64, required: u64 },
    #[error("transaction: {0}")]
    Transaction(String),
}

/// A broadcast transaction.
#[derive(Clone, Copy)]
pub struct TxReceipt<'a> {
    provider: &'a dyn ProviderTrait,
    txid: Txid,
}

impl fmt::Display for TxReceipt<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.txid, f)
    }
}

impl fmt::Debug for TxReceipt<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(&self.txid, f)
    }
}

impl<'a> TxReceipt<'a> {
    #[must_use]
    pub fn new(provider: &'a dyn ProviderTrait, txid: Txid) -> Self {
        Self { provider, txid }
    }

    #[must_use]
    pub fn txid(self) -> Txid {
        self.txid
    }

    /// Returns once the transaction is in a block.
    ///
    /// # Errors
    /// Timeout or node errors.
    pub fn wait(&self) -> Result<(), ProviderError> {
        self.provider.wait(&self.txid)
    }
}

pub struct Signer {
    key: Key,
    provider: Box<dyn ProviderTrait>,
}

impl Signer {
    /// A signer for the BIP39 `mnemonic` at the Wharfedale wallets' path (`m/86'/1'/0'/0/0`),
    /// so it shares coins with the web wallets.
    ///
    /// # Panics
    /// If the mnemonic is invalid.
    #[must_use]
    pub fn new(mnemonic: &str, provider: Box<dyn ProviderTrait>) -> Self {
        Self::from_key(
            Key::from_mnemonic(mnemonic).expect("valid mnemonic"),
            provider,
        )
    }

    #[must_use]
    pub fn from_key(key: Key, provider: Box<dyn ProviderTrait>) -> Self {
        Self { key, provider }
    }

    #[must_use]
    pub fn key(&self) -> &Key {
        &self.key
    }

    #[must_use]
    pub fn get_provider(&self) -> &dyn ProviderTrait {
        self.provider.as_ref()
    }

    #[must_use]
    pub fn get_network(&self) -> &Network {
        self.provider.get_network()
    }

    /// Explicit address `wf1p…` (key-path Taproot).
    #[must_use]
    pub fn get_address(&self) -> Address {
        self.key.explicit_address()
    }

    /// Confidential address `wfc1…`: the same output script, with the blinding key.
    #[must_use]
    pub fn get_confidential_address(&self) -> Address {
        self.key.address()
    }

    #[must_use]
    pub fn get_blinding_public_key(&self) -> PublicKey {
        self.key.blinding_public_key()
    }

    /// The untweaked x-only key (for programs that check this key's signatures).
    #[must_use]
    pub fn get_schnorr_public_key(&self) -> XOnlyPublicKey {
        self.key.xonly_public_key()
    }

    /// # Errors
    /// Node errors.
    pub fn get_utxos(&self) -> Result<Vec<UTXO>, SignerError> {
        self.get_utxos_filter(&|_| true, &|_| true)
    }

    /// # Errors
    /// Node errors.
    pub fn get_utxos_asset(&self, asset: AssetId) -> Result<Vec<UTXO>, SignerError> {
        self.get_utxos_filter(&|u| u.asset() == asset, &|u| u.asset() == asset)
    }

    /// # Errors
    /// Node errors.
    pub fn get_utxos_txid(&self, txid: Txid) -> Result<Vec<UTXO>, SignerError> {
        self.get_utxos_filter(&|u| u.outpoint.txid == txid, &|u| u.outpoint.txid == txid)
    }

    /// This key's coins: explicit ones through `explicit_filter`, confidential ones (unblinded;
    /// those it can't open are skipped) through `confidential_filter`.
    ///
    /// # Errors
    /// Node errors.
    pub fn get_utxos_filter(
        &self,
        explicit_filter: &dyn Fn(&UTXO) -> bool,
        confidential_filter: &dyn Fn(&UTXO) -> bool,
    ) -> Result<Vec<UTXO>, SignerError> {
        let mut out = Vec::new();
        for utxo in self
            .provider
            .fetch_scripthash_utxos(&self.key.script_pubkey())?
        {
            let confidential = !(utxo.txout.asset.is_explicit() && utxo.txout.value.is_explicit());
            let Some(utxo) = unblind(utxo, &self.key) else {
                continue;
            };
            let keep = if confidential {
                confidential_filter(&utxo)
            } else {
                explicit_filter(&utxo)
            };
            if keep {
                out.push(utxo);
            }
        }
        Ok(out)
    }

    /// Pays `amount` of the fee asset to `to`.
    ///
    /// # Errors
    /// Funding, signing or broadcasting failed.
    pub fn send(&self, to: Script, amount: u64) -> Result<TxReceipt<'_>, SignerError> {
        let mut ft = FinalTransaction::new();
        ft.add_output(PartialOutput::new(
            to,
            amount,
            self.get_network().policy_asset(),
        ));
        self.broadcast(&ft)
    }

    /// Funds, finalizes and broadcasts.
    ///
    /// # Errors
    /// Funding, signing or broadcasting failed.
    pub fn broadcast(&self, ft: &FinalTransaction) -> Result<TxReceipt<'_>, SignerError> {
        let (tx, _fee) = self.finalize(ft)?;
        Ok(TxReceipt::new(
            self.provider.as_ref(),
            self.provider.broadcast_transaction(&tx)?,
        ))
    }

    /// See [`complete`]: with this key's fee-asset coins.
    ///
    /// # Errors
    /// Not enough fee-asset coins, or a program input is not satisfied.
    pub fn finalize(&self, ft: &FinalTransaction) -> Result<(Transaction, u64), SignerError> {
        let network = *self.get_network();
        let coins = self.get_utxos_asset(network.policy_asset())?;
        complete(
            ft,
            coins,
            &self.key,
            network,
            self.provider.fetch_fee_rate(1)?,
        )
    }

    /// See [`complete_strict`].
    ///
    /// # Errors
    /// The inputs don't cover the fee, or a program input is not satisfied.
    pub fn finalize_strict(
        &self,
        ft: &FinalTransaction,
        target_blocks: u32,
    ) -> Result<(Transaction, u64), SignerError> {
        complete_strict(
            ft,
            &self.key,
            *self.get_network(),
            self.provider.fetch_fee_rate(target_blocks)?,
        )
    }

    /// See [`sign`].
    ///
    /// # Errors
    /// Blinding failed or a program input is not satisfied.
    pub fn sign(&self, ft: &FinalTransaction) -> Result<Transaction, SignerError> {
        sign(ft, &self.key, *self.get_network())
    }
}

/// The coin with its opening: as is if explicit, unblinded with `key`'s blinding key if
/// confidential (`None` if that fails: not ours).
#[must_use]
pub fn unblind(mut utxo: UTXO, key: &Key) -> Option<UTXO> {
    if utxo.txout.asset.is_explicit() && utxo.txout.value.is_explicit() {
        return Some(utxo);
    }
    utxo.secrets = Some(utxo.txout.unblind(SECP256K1, key.blinding_key()).ok()?);
    Some(utxo)
}

/// Completes `ft`: adds fee-asset `coins` (largest first, skipping any already spent by `ft`)
/// until they cover the outputs and the fee at `fee_rate` units per 1 000 vbytes, then change
/// to `key` and the fee output; blinds, signs `key`'s inputs and satisfies program inputs.
/// Returns the transaction and its fee.
///
/// # Errors
/// Not enough fee-asset coins, or a program input is not satisfied.
pub fn complete(
    ft: &FinalTransaction,
    coins: Vec<UTXO>,
    key: &Key,
    network: Network,
    fee_rate: u64,
) -> Result<(Transaction, u64), SignerError> {
    let spent: Vec<_> = ft
        .inputs()
        .iter()
        .map(|i| i.partial_input.outpoint())
        .collect();
    let mut coins: Vec<UTXO> = coins
        .into_iter()
        .filter(|u| u.asset() == network.policy_asset() && !spent.contains(&u.outpoint))
        .collect();
    coins.sort_by_key(|u| std::cmp::Reverse(u.amount()));

    let mut fee_tx = ft.clone();
    let mut fee = MIN_FEE;
    let mut coins = coins.into_iter();
    loop {
        let delta = fee_tx.calculate_fee_delta(&network);
        if delta >= i64::try_from(fee).expect("fee fits i64") {
            match estimate(&fee_tx, delta.cast_unsigned(), key, network, fee_rate)? {
                Ok(done) => return Ok(done),
                Err(required) => fee = required,
            }
        }
        let Some(coin) = coins.next() else {
            return Err(SignerError::NotEnoughFunds {
                asset: network.policy_asset(),
                fee,
            });
        };
        fee_tx.add_input(PartialInput::new(coin), RequiredSignature::KeyPath);
    }
}

/// Completes `ft` without adding coins: its inputs must already leave enough of the fee asset
/// for the fee (the rest is change).
///
/// # Errors
/// The inputs don't cover the fee, or a program input is not satisfied.
pub fn complete_strict(
    ft: &FinalTransaction,
    key: &Key,
    network: Network,
    fee_rate: u64,
) -> Result<(Transaction, u64), SignerError> {
    let delta = ft.calculate_fee_delta(&network);
    if delta < i64::try_from(MIN_FEE).expect("fits") {
        return Err(SignerError::DustAmount(delta));
    }
    match estimate(ft, delta.cast_unsigned(), key, network, fee_rate)? {
        Ok(done) => Ok(done),
        Err(required) => Err(SignerError::NotEnoughFeeAmount {
            available: delta,
            required,
        }),
    }
}

/// With `available` of the fee asset left over: the finished transaction (change if anything
/// is left after the fee), or the fee it would need.
fn estimate(
    ft: &FinalTransaction,
    available: u64,
    key: &Key,
    network: Network,
    rate: u64,
) -> Result<Result<(Transaction, u64), u64>, SignerError> {
    // Spending confidential coins needs a blinded output to balance the blinding factors: the
    // change is blinded to this key then.
    let blind_change = ft.has_confidential_inputs() || ft.needs_blinding();
    let change = |amount: u64| {
        let out = PartialOutput::new(key.script_pubkey(), amount, network.policy_asset());
        if blind_change {
            out.with_blinding_key(key.blinding_public_key())
        } else {
            out
        }
    };
    let fee_for =
        |tx: &Transaction| MIN_FEE.max((tx.discount_vsize() as u64 * rate).div_ceil(1000));

    // With change: placeholder amounts to measure, then the real ones.
    let mut with_change = ft.clone();
    with_change.add_output(change(1));
    with_change.add_output(PartialOutput::new(Script::new(), 1, network.policy_asset()));
    let fee = fee_for(&sign(&with_change, key, network)?);
    if available > fee {
        let n = with_change.n_outputs();
        with_change.outputs_mut()[n - 2].amount = available - fee;
        with_change.outputs_mut()[n - 1].amount = fee;
        return Ok(Ok((sign(&with_change, key, network)?, fee)));
    }
    // Without change: everything left goes to the fee (unless blinding needs the change).
    if blind_change && !ft.needs_blinding() {
        return Ok(Err(fee + 1));
    }
    let mut no_change = ft.clone();
    no_change.add_output(PartialOutput::new(
        Script::new(),
        available.max(1),
        network.policy_asset(),
    ));
    let fee = fee_for(&sign(&no_change, key, network)?);
    if available < fee {
        return Ok(Err(fee));
    }
    Ok(Ok((sign(&no_change, key, network)?, available)))
}

/// Blinds, then satisfies program inputs and signs `key`'s inputs (both commit to the blinded
/// outputs). No funding: `ft` must already balance, fee output included.
///
/// # Errors
/// Blinding failed or a program input is not satisfied.
pub fn sign(
    ft: &FinalTransaction,
    key: &Key,
    network: Network,
) -> Result<Transaction, SignerError> {
    let unsigned = ft.to_unsigned();
    let mut tx = unsigned.tx;
    if tx.output.iter().any(|o| o.nonce.is_confidential()) {
        tx.blind(&mut rand::thread_rng(), SECP256K1, &unsigned.domain, false)
            .map_err(|e| SignerError::Transaction(format!("blinding: {e:?}")))?;
    }
    let prevouts: Vec<TxOut> = unsigned.prevouts;
    let mut witnesses = Vec::with_capacity(tx.input.len());
    for (ix, input) in ft.inputs().iter().enumerate() {
        let w = if let Some(p) = &input.program_input {
            p.program
                .finalize(&tx, &prevouts, ix, network.genesis_block_hash(), &p.witness)?
        } else if input.required_sig == RequiredSignature::KeyPath {
            vec![key_path_signature(&tx, &prevouts, ix, key, network)?.to_vec()]
        } else {
            Vec::new()
        };
        witnesses.push(w);
    }
    for (txin, w) in tx.input.iter_mut().zip(witnesses) {
        txin.witness.script_witness = Witness::from_slice(&w);
    }
    Ok(tx)
}

fn key_path_signature(
    tx: &Transaction,
    prevouts: &[TxOut],
    ix: usize,
    key: &Key,
    network: Network,
) -> Result<[u8; 64], SignerError> {
    let hash = SighashCache::new(tx)
        .taproot_key_spend_signature_hash(
            ix,
            &Prevouts::All(prevouts),
            SchnorrSighashType::Default,
            network.genesis_block_hash(),
        )
        .map_err(|e| SignerError::Transaction(format!("sighash: {e}")))?;
    let sig = SECP256K1.sign_schnorr(
        &Message::from_digest(hash.to_byte_array()),
        &key.tweaked_keypair(),
    );
    Ok(sig.serialize())
}
