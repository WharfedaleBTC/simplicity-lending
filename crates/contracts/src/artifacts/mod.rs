//! The SimplicityHL programs with typed arguments and witnesses. Each program's `SOURCE` is its
//! `.simf` file (the web app compiles the same files); arguments and witnesses become
//! SimplicityHL literals by name.

macro_rules! program {
    (
        $module:ident :: $derived:ident, $Program:ident, $file:literal,
        $Args:ident { $($field:ident : $fty:ty => $NAME:literal),* $(,)? },
        $Witness:ident { $($wfield:ident : $wty:ty => $WNAME:literal),* $(,)? }
    ) => {
        pub mod $module {
            use lending_sdk::program::Program;

            pub use self::$derived::{$Args, $Witness};

            /// The program with its arguments (and storage slots, if it keeps state).
            #[derive(Clone, Debug)]
            pub struct $Program {
                program: Program,
            }

            impl $Program {
                pub const SOURCE: &'static str = include_str!(concat!("../../simf/", $file));

                #[must_use]
                pub fn new(arguments: $Args) -> Self {
                    Self { program: Program::new(Self::SOURCE, &arguments) }
                }

                #[must_use]
                pub fn with_storage_capacity(mut self, capacity: usize) -> Self {
                    self.program = self.program.with_storage_capacity(capacity);
                    self
                }

                pub fn set_storage_at(&mut self, index: usize, value: [u8; 32]) {
                    self.program.set_storage_at(index, value);
                }
            }

            impl AsRef<Program> for $Program {
                fn as_ref(&self) -> &Program {
                    &self.program
                }
            }

            pub mod $derived {
                #[allow(unused_imports)]
                use lending_sdk::either::Either;
                use lending_sdk::program::{ArgumentsTrait, WitnessTrait};
                use lending_sdk::value::{HlValue, values};
                use serde_json::{Map, Value};

                #[derive(Clone, Debug)]
                pub struct $Args {
                    $(pub $field: $fty,)*
                }

                impl ArgumentsTrait for $Args {
                    fn build_arguments(&self) -> Map<String, Value> {
                        values(&[$(($NAME, &self.$field as &dyn HlValue)),*])
                    }
                }

                #[derive(Clone, Debug)]
                pub struct $Witness {
                    $(pub $wfield: $wty,)*
                }

                impl WitnessTrait for $Witness {
                    fn build_witness(&self) -> Map<String, Value> {
                        values(&[$(($WNAME, &self.$wfield as &dyn HlValue)),*])
                    }
                }
            }
        }
    };
}

program!(
    asset_auth::derived_asset_auth, AssetAuthProgram, "asset_auth.simf",
    AssetAuthArguments {
        asset_id: [u8; 32] => "ASSET_ID",
        asset_amount: u64 => "ASSET_AMOUNT",
        with_asset_burn: bool => "WITH_ASSET_BURN",
    },
    AssetAuthWitness {
        input_asset_index: u32 => "INPUT_ASSET_INDEX",
        output_asset_index: u32 => "OUTPUT_ASSET_INDEX",
    }
);

program!(
    asset_auth_vault::derived_asset_auth_vault, AssetAuthVaultProgram, "asset_auth_vault.simf",
    AssetAuthVaultArguments {
        vault_asset_id: [u8; 32] => "VAULT_ASSET_ID",
        keeper_auth_asset_id: [u8; 32] => "KEEPER_AUTH_ASSET_ID",
        supplier_auth_asset_id: [u8; 32] => "SUPPLIER_AUTH_ASSET_ID",
        keeper_auth_asset_amount: u64 => "KEEPER_AUTH_ASSET_AMOUNT",
        finalized_vault_cov_hash: [u8; 32] => "FINALIZED_VAULT_COV_HASH",
        is_active: bool => "IS_ACTIVE",
        with_keeper_asset_burn: bool => "WITH_KEEPER_ASSET_BURN",
        with_supplier_asset_burn: bool => "WITH_SUPPLIER_ASSET_BURN",
    },
    AssetAuthVaultWitness {
        path: Either<Either<(u32, u32), (u32, u32, u32, u64)>, Either<(u32, u32, u32, u64), (u32, u32, u32, u64)>> => "PATH",
    }
);

program!(
    issuance_factory::derived_issuance_factory, IssuanceFactoryProgram, "issuance_factory.simf",
    IssuanceFactoryArguments {
        issuing_utxos_count: u8 => "ISSUING_UTXOS_COUNT",
        reissuance_flags: u64 => "REISSUANCE_FLAGS",
    },
    IssuanceFactoryWitness {
        path: Either<u32, u32> => "PATH",
    }
);

program!(
    lending::derived_lending, LendingProgram, "lending.simf",
    LendingArguments {
        collateral_asset_id: [u8; 32] => "COLLATERAL_ASSET_ID",
        principal_asset_id: [u8; 32] => "PRINCIPAL_ASSET_ID",
        borrower_nft_asset_id: [u8; 32] => "BORROWER_NFT_ASSET_ID",
        lender_nft_asset_id: [u8; 32] => "LENDER_NFT_ASSET_ID",
        collateral_amount: u64 => "COLLATERAL_AMOUNT",
        principal_amount: u64 => "PRINCIPAL_AMOUNT",
        principal_interest_rate: u64 => "PRINCIPAL_INTEREST_RATE",
        loan_expiration_time: u32 => "LOAN_EXPIRATION_TIME",
        lender_vault_cov_hash: [u8; 32] => "LENDER_VAULT_COV_HASH",
        finalized_lender_vault_cov_hash: [u8; 32] => "FINALIZED_LENDER_VAULT_COV_HASH",
        protocol_fee_vault_cov_hash: [u8; 32] => "PROTOCOL_FEE_VAULT_COV_HASH",
        finalized_protocol_fee_vault_cov_hash: [u8; 32] => "FINALIZED_PROTOCOL_FEE_VAULT_COV_HASH",
        principal_output_script_hash: [u8; 32] => "PRINCIPAL_OUTPUT_SCRIPT_HASH",
    },
    LendingWitness {
        path: Either<Either<(), ()>, Either<Either<(u64, u64), u64>, u64>> => "PATH",
    }
);

program!(
    script_auth::derived_script_auth, ScriptAuthProgram, "script_auth.simf",
    ScriptAuthArguments {
        script_hash: [u8; 32] => "SCRIPT_HASH",
    },
    ScriptAuthWitness {
        input_script_index: u32 => "INPUT_SCRIPT_INDEX",
    }
);
