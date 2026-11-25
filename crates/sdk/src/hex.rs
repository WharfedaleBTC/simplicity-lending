//! `to_hex()` as in `elements` 0.25: hashes and ids in their display order, scripts and keys
//! as their bytes.

use elements::secp256k1_zkp::XOnlyPublicKey;
use elements::{AssetId, BlockHash, Script, Txid};

pub trait ToHex {
    fn to_hex(&self) -> String;
}

macro_rules! display {
    ($($t:ty),*) => {$(
        impl ToHex for $t {
            fn to_hex(&self) -> String {
                self.to_string()
            }
        }
    )*};
}
display!(Txid, AssetId, BlockHash, XOnlyPublicKey);

impl ToHex for Script {
    fn to_hex(&self) -> String {
        hex::encode(self.as_bytes())
    }
}

impl ToHex for [u8] {
    fn to_hex(&self) -> String {
        hex::encode(self)
    }
}

impl ToHex for Vec<u8> {
    fn to_hex(&self) -> String {
        hex::encode(self)
    }
}

impl<const N: usize> ToHex for [u8; N] {
    fn to_hex(&self) -> String {
        hex::encode(self)
    }
}

/// `from_slice` as in `elements` 0.25, for 32-byte ids in their internal byte order.
pub trait FromSlice: Sized {
    /// # Errors
    /// `bytes` is not 32 bytes long.
    fn from_slice(bytes: &[u8]) -> Result<Self, std::array::TryFromSliceError>;
}

impl FromSlice for Txid {
    fn from_slice(bytes: &[u8]) -> Result<Self, std::array::TryFromSliceError> {
        Ok(Self::from_byte_array(bytes.try_into()?))
    }
}

impl FromSlice for AssetId {
    fn from_slice(bytes: &[u8]) -> Result<Self, std::array::TryFromSliceError> {
        Ok(Self::from_byte_array(bytes.try_into()?))
    }
}

impl FromSlice for BlockHash {
    fn from_slice(bytes: &[u8]) -> Result<Self, std::array::TryFromSliceError> {
        Ok(Self::from_byte_array(bytes.try_into()?))
    }
}
