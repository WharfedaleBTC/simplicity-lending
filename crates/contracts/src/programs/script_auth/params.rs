use lending_sdk::Network;

use crate::artifacts::script_auth::derived_script_auth::ScriptAuthArguments;

#[derive(Debug, Clone, Copy)]
pub struct ScriptAuthParameters {
    pub script_hash: [u8; 32],
    pub network: Network,
}

impl ScriptAuthParameters {
    pub fn build_arguments(&self) -> ScriptAuthArguments {
        ScriptAuthArguments {
            script_hash: self.script_hash,
        }
    }
}
