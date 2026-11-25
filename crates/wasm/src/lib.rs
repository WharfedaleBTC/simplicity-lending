//! The lending protocol's Wharfedale transaction layer, for the browser.
//!
//! JSON in, JSON out. Amounts are numbers (base units); asset ids, txids and the genesis hash
//! are hex in display order; scripts, keys and storage slots are hex bytes. Simplicity
//! arguments and witnesses are SimplicityHL literals by name, as in `.simf` sidecar files.
//!
//! Wallet secrets stay in the page: they are passed in per call and never stored.

use std::str::FromStr;

use lending_sdk::elements::encode::deserialize;
use lending_sdk::elements::{
    AssetId, BlockHash, LockTime, OutPoint, Script, Sequence, Transaction, Txid,
    secp256k1_zkp::PublicKey,
};
use lending_sdk::keys::WalletKey;
use lending_sdk::network::{Network, hash_script};
use lending_sdk::program::{ArgumentsTrait, Program, WitnessTrait};
use lending_sdk::provider::DEFAULT_FEE_RATE;
use lending_sdk::signer::{complete, complete_strict, unblind};
use lending_sdk::transaction::{
    FinalTransaction, IssuanceInput, PartialInput, PartialOutput, ProgramInput, RequiredSignature,
    UTXO,
};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use wasm_bindgen::prelude::*;

type Res<T> = Result<T, JsError>;

fn err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

fn hex32(s: &str, what: &str) -> Res<[u8; 32]> {
    hex::decode(s)
        .map_err(|e| err(format!("{what}: {e}")))?
        .try_into()
        .map_err(|_| err(format!("{what}: not 32 bytes")))
}

fn key(secret: &str) -> Res<WalletKey> {
    WalletKey::from_secret(hex32(secret, "secret")?).map_err(err)
}

struct Args(Map<String, Value>);
impl ArgumentsTrait for Args {
    fn build_arguments(&self) -> Map<String, Value> {
        self.0.clone()
    }
}
struct Wit(Map<String, Value>);
impl WitnessTrait for Wit {
    fn build_witness(&self) -> Map<String, Value> {
        self.0.clone()
    }
}

/// A program with arguments and storage. Leaks the source: programs are a handful of
/// constant `.simf` files, and `Program` borrows its source for the page's lifetime.
fn program(source: &str, arguments: Map<String, Value>, storage: &[String]) -> Res<Program> {
    let source: &'static str = Box::leak(source.to_owned().into_boxed_str());
    let mut p = Program::new(source, &Args(arguments)).with_storage_capacity(storage.len());
    for (i, slot) in storage.iter().enumerate() {
        p.set_storage_at(i, hex32(slot, "storage slot")?);
    }
    p.load().map_err(err)?;
    Ok(p)
}

/// `{cmr, scriptPubkey, scriptHash, address, controlBlock}` of a program with
/// `arguments` (JSON object) and `storage` (JSON array of 32-byte hex slots).
#[wasm_bindgen(js_name = programInfo)]
pub fn program_info(source: &str, arguments: &str, storage: &str) -> Res<String> {
    let arguments: Map<String, Value> = serde_json::from_str(arguments).map_err(err)?;
    let storage: Vec<String> = serde_json::from_str(storage).map_err(err)?;
    let p = program(source, arguments, &storage)?;
    let spk = p.script_pubkey();
    Ok(json!({
        "cmr": hex::encode(p.cmr().as_ref()),
        "scriptPubkey": hex::encode(spk.as_bytes()),
        "scriptHash": hex::encode(hash_script(&spk)),
        "address": lending_sdk::elements::Address::from_script(&spk, None, &lending_sdk::network::ADDRESS_PARAMS)
            .map(|a| a.to_string())
            .unwrap_or_default(),
        "controlBlock": hex::encode(p.control_block().serialize()),
    })
    .to_string())
}

/// A new 12- or 24-word BIP39 recovery phrase.
#[wasm_bindgen(js_name = generateMnemonic)]
pub fn generate_mnemonic(words: u32) -> Res<String> {
    use rand::RngCore;
    let len = match words {
        12 => 16,
        24 => 32,
        _ => return Err(err("a recovery phrase has 12 or 24 words")),
    };
    let mut entropy = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut entropy);
    Ok(bip39::Mnemonic::from_entropy(&entropy)
        .map_err(err)?
        .to_string())
}

/// The secret (hex) of a recovery phrase at the Wharfedale wallets' path.
#[wasm_bindgen(js_name = secretFromMnemonic)]
pub fn secret_from_mnemonic(phrase: &str) -> Res<String> {
    Ok(hex::encode(
        WalletKey::from_mnemonic(phrase)
            .map_err(err)?
            .secret_bytes(),
    ))
}

/// `{scriptPubkey, address, explicitAddress, blindingPublicKey, xonlyPublicKey}` of a secret.
#[wasm_bindgen(js_name = walletInfo)]
pub fn wallet_info(secret: &str) -> Res<String> {
    let k = key(secret)?;
    Ok(json!({
        "scriptPubkey": hex::encode(k.script_pubkey().as_bytes()),
        "address": k.address().to_string(),
        "explicitAddress": k.explicit_address().to_string(),
        "blindingPublicKey": k.blinding_public_key().to_string(),
        "xonlyPublicKey": k.xonly_public_key().to_string(),
    })
    .to_string())
}

/// `{asset, value, confidential}` of output `vout` of `tx_hex` for this wallet, or `null` when
/// it is confidential and not blinded to this wallet.
#[wasm_bindgen(js_name = unblindOutput)]
pub fn unblind_output(tx_hex: &str, vout: u32, secret: &str) -> Res<String> {
    let utxo = utxo(tx_hex, vout)?;
    let confidential = !(utxo.txout.asset.is_explicit() && utxo.txout.value.is_explicit());
    Ok(match unblind(utxo, &key(secret)?) {
        Some(u) => json!({ "asset": u.asset().to_string(), "value": u.amount(), "confidential": confidential }),
        None => Value::Null,
    }
    .to_string())
}

/// One output, as in [`tx_info`].
#[wasm_bindgen(js_name = outputInfo)]
pub fn output_info(tx_hex: &str, vout: u32) -> Res<String> {
    Ok(output_json(&utxo(tx_hex, vout)?.txout).to_string())
}

fn output_json(o: &lending_sdk::elements::TxOut) -> Value {
    json!({
        "script": hex::encode(o.script_pubkey.as_bytes()),
        "asset": o.asset.explicit().map(|a| a.to_string()),
        "value": o.value.explicit(),
        "isOpReturn": o.script_pubkey.is_op_return(),
        "opReturnData": op_return_data(&o.script_pubkey).map(hex::encode),
        "isFee": o.is_fee(),
    })
}

/// `{txid, lockTime, inputs: [{txid, vout}], outputs: [{script, asset, value, isOpReturn,
/// opReturnData, isFee}]}` of a transaction (`asset`/`value` null when confidential).
#[wasm_bindgen(js_name = txInfo)]
pub fn tx_info(tx_hex: &str) -> Res<String> {
    let tx = decode_tx(tx_hex)?;
    Ok(json!({
        "txid": tx.txid().to_string(),
        "lockTime": tx.lock_time.to_consensus_u32(),
        "inputs": tx.input.iter().map(|i| json!({"txid": i.previous_output.txid.to_string(), "vout": i.previous_output.vout})).collect::<Vec<_>>(),
        "outputs": tx.output.iter().map(output_json).collect::<Vec<_>>(),
    })
    .to_string())
}

/// `{scriptPubkey, blindingKey, explicitAddress}` of a `wfc1…`/`wf1…` address (`blindingKey`
/// null for an explicit one).
#[wasm_bindgen(js_name = addressInfo)]
pub fn address_info(address: &str) -> Res<String> {
    let a = lending_sdk::elements::Address::parse_with_params(
        address.trim(),
        &lending_sdk::network::ADDRESS_PARAMS,
    )
    .map_err(|e| err(format!("not a Wharfedale address: {e}")))?;
    let explicit = lending_sdk::elements::Address {
        blinding_pubkey: None,
        ..a.clone()
    };
    Ok(json!({
        "scriptPubkey": hex::encode(a.script_pubkey().as_bytes()),
        "blindingKey": a.blinding_pubkey.map(|k| k.to_string()),
        "explicitAddress": explicit.to_string(),
    })
    .to_string())
}

/// The address of an output script (explicit, `wf1…`), or `null` when it has none.
#[wasm_bindgen(js_name = scriptAddress)]
pub fn script_address(script_hex: &str) -> Res<Option<String>> {
    let script = Script::from(hex::decode(script_hex).map_err(err)?);
    Ok(lending_sdk::elements::Address::from_script(
        &script,
        None,
        &lending_sdk::network::ADDRESS_PARAMS,
    )
    .map(|a| a.to_string()))
}

fn op_return_data(script: &Script) -> Option<Vec<u8>> {
    if !script.is_op_return() {
        return None;
    }
    let mut out = Vec::new();
    for ins in script.instructions().skip(1) {
        if let Ok(lending_sdk::elements::script::Instruction::PushBytes(b)) = ins {
            out.extend_from_slice(b);
        }
    }
    Some(out)
}

fn decode_tx(tx_hex: &str) -> Res<Transaction> {
    deserialize(&hex::decode(tx_hex).map_err(err)?).map_err(err)
}

fn utxo(tx_hex: &str, vout: u32) -> Res<UTXO> {
    let tx = decode_tx(tx_hex)?;
    let txout = tx
        .output
        .get(vout as usize)
        .cloned()
        .ok_or_else(|| err(format!("{} has no output {vout}", tx.txid())))?;
    Ok(UTXO {
        outpoint: OutPoint::new(tx.txid(), vout),
        txout,
        secrets: None,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NetworkJson {
    policy_asset: String,
    genesis_hash: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoinJson {
    tx_hex: String,
    vout: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProgramJson {
    source: String,
    arguments: Map<String, Value>,
    #[serde(default)]
    storage: Vec<String>,
    witness: Map<String, Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase")]
enum IssuanceJson {
    /// A new asset; `contract_hash` (hex) is the issuance's contract hash (zero if none).
    New {
        amount: u64,
        tokens: u64,
        contract_hash: String,
    },
    /// More of an asset (the input spends its confidential reissuance token).
    Re { amount: u64, entropy: String },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InputJson {
    tx_hex: String,
    vout: u32,
    #[serde(default)]
    sequence: Option<u32>,
    #[serde(default)]
    lock_time: Option<u32>,
    /// A wallet coin: unblinded and signed with the secret on the key path.
    #[serde(default)]
    key_path: bool,
    #[serde(default)]
    program: Option<ProgramJson>,
    #[serde(default)]
    issuance: Option<IssuanceJson>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OutputJson {
    script: String,
    amount: u64,
    asset: Option<String>,
    #[serde(default)]
    blinding_key: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompleteRequest {
    network: NetworkJson,
    secret: String,
    #[serde(default)]
    fee_rate: Option<u64>,
    /// Use only `inputs` (they must leave enough of the fee asset for the fee).
    #[serde(default)]
    strict: bool,
    /// The wallet's coins the fee (and missing fee asset) may come from.
    #[serde(default)]
    coins: Vec<CoinJson>,
    inputs: Vec<InputJson>,
    outputs: Vec<OutputJson>,
}

/// Completes a transaction: `{txHex, txid, fee}`. Inputs and outputs keep their order; fee-asset
/// coins are added after the inputs, change and the fee output after the outputs.
#[wasm_bindgen(js_name = completeTransaction)]
pub fn complete_transaction(request: &str) -> Res<String> {
    let r: CompleteRequest = serde_json::from_str(request).map_err(err)?;
    let network = Network::new(
        AssetId::from_str(&r.network.policy_asset).map_err(|e| err(format!("policyAsset: {e}")))?,
        BlockHash::from_str(&r.network.genesis_hash)
            .map_err(|e| err(format!("genesisHash: {e}")))?,
    );
    let key = key(&r.secret)?;
    let mut ft = FinalTransaction::new();
    for (i, input) in r.inputs.into_iter().enumerate() {
        let mut u = utxo(&input.tx_hex, input.vout)?;
        if input.key_path {
            u = unblind(u, &key).ok_or_else(|| err(format!("input {i} is not this wallet's")))?;
        }
        let mut partial = PartialInput::new(u);
        if let Some(s) = input.sequence {
            partial = partial.with_sequence(Sequence(s));
        }
        if let Some(l) = input.lock_time {
            partial = partial.with_locktime(LockTime::from_consensus(l));
        }
        let sig = if input.key_path {
            RequiredSignature::KeyPath
        } else {
            RequiredSignature::None
        };
        let issuance = match input.issuance {
            None => None,
            Some(IssuanceJson::New {
                amount,
                tokens,
                contract_hash,
            }) => Some(IssuanceInput::new_issuance(
                amount,
                tokens,
                hex32(&contract_hash, "contractHash")?,
            )),
            Some(IssuanceJson::Re { amount, entropy }) => Some(IssuanceInput::new_reissuance(
                amount,
                hex32(&entropy, "entropy")?,
            )),
        };
        match (input.program, issuance) {
            (None, None) => ft.add_input(partial, sig),
            (None, Some(iss)) => {
                ft.add_issuance_input(partial, iss, sig);
            }
            (Some(p), iss) => {
                let program_input =
                    ProgramInput::new(program(&p.source, p.arguments, &p.storage)?, Wit(p.witness));
                match iss {
                    None => ft.add_program_input(partial, program_input, RequiredSignature::None),
                    Some(iss) => {
                        ft.add_program_issuance_input(
                            partial,
                            program_input,
                            iss,
                            RequiredSignature::None,
                        );
                    }
                }
            }
        }
    }
    for o in r.outputs {
        let script = Script::from(hex::decode(&o.script).map_err(err)?);
        let asset = match o.asset {
            Some(a) => AssetId::from_str(&a).map_err(|e| err(format!("asset: {e}")))?,
            None => AssetId::default(),
        };
        let mut out = PartialOutput::new(script, o.amount, asset);
        if let Some(k) = o.blinding_key {
            out = out.with_blinding_key(
                PublicKey::from_str(&k).map_err(|e| err(format!("blindingKey: {e}")))?,
            );
        }
        ft.add_output(out);
    }
    let rate = r.fee_rate.unwrap_or(DEFAULT_FEE_RATE);
    let (tx, fee) = if r.strict {
        complete_strict(&ft, &key, network, rate).map_err(err)?
    } else {
        let coins = r
            .coins
            .iter()
            .map(|c| utxo(&c.tx_hex, c.vout).map(|u| unblind(u, &key)))
            .collect::<Res<Vec<_>>>()?
            .into_iter()
            .flatten()
            .collect();
        complete(&ft, coins, &key, network, rate).map_err(err)?
    };
    Ok(json!({
        "txHex": lending_sdk::elements::encode::serialize_hex(&tx),
        "txid": tx.txid().to_string(),
        "fee": fee,
    })
    .to_string())
}

/// `{asset, token}` (display hex) of a new issuance from `txid:vout` with contract hash
/// `contract_hash` (hex; zero when the asset has no contract).
#[wasm_bindgen(js_name = issuedAssetIds)]
pub fn issued_asset_ids(txid: &str, vout: u32, contract_hash: &str) -> Res<String> {
    let outpoint = OutPoint::new(Txid::from_str(txid).map_err(err)?, vout);
    let entropy =
        lending_sdk::transaction::asset_entropy(&outpoint, hex32(contract_hash, "contractHash")?);
    Ok(json!({
        "asset": AssetId::from_entropy(entropy).to_string(),
        "token": AssetId::reissuance_token_from_entropy(entropy, false).to_string(),
    })
    .to_string())
}

/// The txid of a transaction hex.
#[wasm_bindgen(js_name = txid)]
pub fn txid(tx_hex: &str) -> Res<String> {
    Ok(decode_tx(tx_hex)?.txid().to_string())
}

/// Parses a txid (display hex), for validation.
#[wasm_bindgen(js_name = isTxid)]
#[must_use]
pub fn is_txid(s: &str) -> bool {
    Txid::from_str(s).is_ok()
}

/// SHA-256 of a script (hex).
#[wasm_bindgen(js_name = scriptHash)]
pub fn script_hash(script_hex: &str) -> Res<String> {
    Ok(hex::encode(hash_script(&Script::from(
        hex::decode(script_hex).map_err(err)?,
    ))))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The request shapes the web app sends (camelCase, also inside enum variants).
    #[test]
    fn parses_the_web_app_request() {
        let issuance: IssuanceJson =
            serde_json::from_str(r#"{"new": {"amount": 1, "tokens": 1, "contractHash": "00"}}"#)
                .unwrap();
        assert!(matches!(
            issuance,
            IssuanceJson::New {
                amount: 1,
                tokens: 1,
                ..
            }
        ));
        let input: InputJson =
            serde_json::from_str(r#"{"txHex": "00", "vout": 1, "keyPath": true, "lockTime": 5}"#)
                .unwrap();
        assert!(input.key_path && input.lock_time == Some(5));
    }
}
