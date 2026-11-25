//! Chain parameters.

use elements::hashes::{HashEngine, sha256};
use elements::secp256k1_zkp::XOnlyPublicKey;
use elements::{AddressParams, AssetId, BlockHash, Script};

/// Address parameters: bech32m `wf1…` (explicit), blech32 `wfc1…` (confidential). As the node.
pub static ADDRESS_PARAMS: AddressParams = AddressParams {
    p2pkh_prefix: 73,
    p2sh_prefix: 87,
    blinded_prefix: 25,
    bech_hrp: elements::bitcoin::bech32::Hrp::parse_unchecked("wf"),
    blech_hrp: elements::bitcoin::bech32::Hrp::parse_unchecked("wfc"),
};

/// BIP341's "H" point (no known discrete logarithm): the internal key of every program
/// output, so programs have no key path.
pub const NUMS: [u8; 32] = [
    0x50, 0x92, 0x9b, 0x74, 0xc1, 0xa0, 0x49, 0x54, 0xb7, 0x8b, 0x4b, 0x60, 0x35, 0xe9, 0x7a, 0x5e,
    0x07, 0x8a, 0x5a, 0x0f, 0x28, 0xec, 0x96, 0xd5, 0x47, 0xbf, 0xee, 0x9a, 0xce, 0x80, 0x3a, 0xc0,
];

#[must_use]
pub fn nums_key() -> XOnlyPublicKey {
    XOnlyPublicKey::from_slice(&NUMS).expect("valid point")
}

/// A Wharfedale chain: its fee asset and genesis hash (both from `getblockchaininfo`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Network {
    policy_asset: AssetId,
    genesis_hash: BlockHash,
}

impl Network {
    #[must_use]
    pub const fn new(policy_asset: AssetId, genesis_hash: BlockHash) -> Self {
        Self {
            policy_asset,
            genesis_hash,
        }
    }

    /// The fee asset (WBTC on the demo chain): fees, wallet funding and change.
    #[must_use]
    pub fn policy_asset(&self) -> AssetId {
        self.policy_asset
    }

    /// Committed by every taproot sighash and by Simplicity's `sig_all_hash`.
    #[must_use]
    pub fn genesis_block_hash(&self) -> BlockHash {
        self.genesis_hash
    }

    #[must_use]
    pub fn address_params(&self) -> &'static AddressParams {
        &ADDRESS_PARAMS
    }
}

/// SHA-256 of a script: what `jet::input_script_hash` / `jet::output_script_hash` return.
#[must_use]
pub fn hash_script(script: &Script) -> [u8; 32] {
    sha256::Hash::hash(script.as_bytes()).to_byte_array()
}

/// `TapData`-tagged hash of a storage slot: a hidden node beside a program's leaf.
#[must_use]
pub fn tap_data_hash(data: &[u8]) -> sha256::Hash {
    let tag = sha256::Hash::hash(b"TapData");
    let mut eng = sha256::Hash::engine();
    eng.input(tag.as_byte_array());
    eng.input(tag.as_byte_array());
    eng.input(data);
    sha256::Hash::from_engine(eng)
}

/// A fixed network for tests that don't touch a chain (all-`0x01` fee asset, all-`0x02` genesis).
#[must_use]
pub fn test_network() -> Network {
    Network::new(
        AssetId::from_byte_array([1; 32]),
        BlockHash::from_byte_array([2; 32]),
    )
}
