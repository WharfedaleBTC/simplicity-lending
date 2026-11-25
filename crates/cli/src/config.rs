pub const MNEMONIC_ENV_KEY: &str = "MNEMONIC";
pub const NODE_URL_ENV_KEY: &str = "NODE_URL";

#[derive(Debug, Clone)]
pub struct CliConfig {
    pub mnemonic: String,
    /// A Wharfedale node: JSON-RPC and Esplora API on one address. The chain's fee asset and
    /// genesis hash are read from it.
    pub node_url: String,
}

impl CliConfig {
    pub fn load_config() -> Self {
        let mnemonic = std::env::var(MNEMONIC_ENV_KEY)
            .expect("Please specify the mnemonic in the .env file using the 'MNEMONIC' key.");
        let node_url = std::env::var(NODE_URL_ENV_KEY).expect(
            "Please specify the node URL in the .env file using the 'NODE_URL' key (e.g. http://127.0.0.1:18443).",
        );

        Self { mnemonic, node_url }
    }
}
