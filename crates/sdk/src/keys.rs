//! Wallet keys, derived exactly as the Wharfedale SDKs and web wallets do: one secret gives the
//! key-path Taproot output, the blinding key and both addresses.

use elements::hashes::sha256;
use elements::schnorr::TapTweak;
use elements::secp256k1_zkp::{Keypair, PublicKey, SECP256K1, SecretKey, XOnlyPublicKey};
use elements::{Address, Script};
use rand::RngCore;

use crate::network::ADDRESS_PARAMS;

/// BIP32 path of the Wharfedale wallets (BIP86, testnet coin type).
pub const DERIVATION_PATH: &str = "m/86'/1'/0'/0/0";

#[derive(Debug, thiserror::Error)]
pub enum KeyError {
    #[error("invalid secret key")]
    Secret,
    #[error("recovery phrase: {0}")]
    Mnemonic(String),
    #[error("derivation: {0}")]
    Derivation(String),
}

#[derive(Clone, PartialEq, Eq)]
pub struct WalletKey {
    secret: [u8; 32],
}

impl std::fmt::Debug for WalletKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "WalletKey({})", self.xonly_public_key())
    }
}

impl WalletKey {
    /// # Errors
    /// Not a valid secp256k1 secret key.
    pub fn from_secret(secret: [u8; 32]) -> Result<Self, KeyError> {
        SecretKey::from_slice(&secret).map_err(|_| KeyError::Secret)?;
        Ok(Self { secret })
    }

    /// The key at [`DERIVATION_PATH`] of a BIP39 phrase (whitespace and case normalized).
    ///
    /// # Errors
    /// Not a valid English BIP39 phrase.
    pub fn from_mnemonic(phrase: &str) -> Result<Self, KeyError> {
        use elements::bitcoin::NetworkKind;
        use elements::bitcoin::bip32::{DerivationPath, Xpriv};
        let normalized = phrase
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        let mnemonic = bip39::Mnemonic::parse_in(bip39::Language::English, &normalized)
            .map_err(|e| KeyError::Mnemonic(e.to_string()))?;
        let seed = mnemonic.to_seed("");
        let master = Xpriv::new_master(NetworkKind::Test, &seed)
            .map_err(|e| KeyError::Derivation(e.to_string()))?;
        let path: DerivationPath = DERIVATION_PATH
            .parse()
            .map_err(|e| KeyError::Derivation(format!("{e}")))?;
        let child = master
            .derive_priv(elements::bitcoin::secp256k1::SECP256K1, &path)
            .map_err(|e| KeyError::Derivation(e.to_string()))?;
        Self::from_secret(child.private_key.secret_bytes())
    }

    #[must_use]
    pub fn generate() -> Self {
        loop {
            let mut secret = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut secret);
            if let Ok(k) = Self::from_secret(secret) {
                return k;
            }
        }
    }

    #[must_use]
    pub fn secret_bytes(&self) -> [u8; 32] {
        self.secret
    }

    #[must_use]
    pub fn keypair(&self) -> Keypair {
        Keypair::from_seckey_slice(SECP256K1, &self.secret).expect("validated in from_secret")
    }

    #[must_use]
    pub fn xonly_public_key(&self) -> XOnlyPublicKey {
        self.keypair().x_only_public_key().0
    }

    /// The BIP341-tweaked key that signs key-path spends.
    #[must_use]
    pub fn tweaked_keypair(&self) -> Keypair {
        self.keypair().tap_tweak(SECP256K1, None).to_inner()
    }

    #[must_use]
    pub fn script_pubkey(&self) -> Script {
        Script::new_v1_p2tr(SECP256K1, self.xonly_public_key(), None)
    }

    /// SHA-256("wharfedale/blinding-key" ‖ secret).
    #[must_use]
    pub fn blinding_key(&self) -> SecretKey {
        let mut data = b"wharfedale/blinding-key".to_vec();
        data.extend_from_slice(&self.secret);
        SecretKey::from_slice(&sha256::Hash::hash(&data).to_byte_array())
            .expect("hash is a valid key")
    }

    #[must_use]
    pub fn blinding_public_key(&self) -> PublicKey {
        PublicKey::from_secret_key(SECP256K1, &self.blinding_key())
    }

    /// Confidential address `wfc1…`.
    #[must_use]
    pub fn address(&self) -> Address {
        Address::p2tr(
            SECP256K1,
            self.xonly_public_key(),
            None,
            Some(self.blinding_public_key()),
            &ADDRESS_PARAMS,
        )
    }

    /// Explicit address `wf1p…`.
    #[must_use]
    pub fn explicit_address(&self) -> Address {
        Address::p2tr(
            SECP256K1,
            self.xonly_public_key(),
            None,
            None,
            &ADDRESS_PARAMS,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Must match the Wharfedale SDK (and so the TypeScript SDK and the web wallets).
    #[test]
    fn same_keys_as_the_wharfedale_sdk() {
        let phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let ours = WalletKey::from_mnemonic(phrase).unwrap();
        let theirs = wharfedale_sdk::Key::from_mnemonic(phrase).unwrap();
        assert_eq!(ours.secret_bytes(), theirs.secret_bytes());
        assert_eq!(ours.script_pubkey(), theirs.script_pubkey());
        assert_eq!(ours.blinding_public_key(), theirs.blinding_public_key());
        assert_eq!(ours.address().to_string(), theirs.address().to_string());
        assert_eq!(
            ours.explicit_address().to_string(),
            theirs.explicit_address().to_string()
        );
    }
}
