use clap::Parser;

use lending_sdk::Network;
use lending_sdk::provider::{NodeProvider, ProviderTrait};
use lending_sdk::signer::Signer;

use crate::commands::account::Account;
use crate::commands::core::Command;
use crate::commands::factory::Factory;
use crate::commands::issuance::Issuance;
use crate::config::CliConfig;
use crate::error::CliError;

#[derive(Debug, Parser)]
#[command(name = "lending-cli")]
#[command(version, about = "Simplicity Lending helper CLI for Wharfedale")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

pub struct CliContext {
    pub signer: Signer,
    pub provider: NodeProvider,
}

impl CliContext {
    pub fn get_network(&self) -> Network {
        *self.provider.get_network()
    }
}

impl Cli {
    pub async fn run(&self) -> Result<(), CliError> {
        match &self.command {
            Command::Account { command } => {
                let context = Cli::build_context()?;

                Ok(Account::run(context, command)?)
            }
            Command::Factory { command } => {
                let context = Cli::build_context()?;

                Ok(Factory::run(context, command)?)
            }
            Command::Issuance { command } => {
                let context = Cli::build_context()?;

                Ok(Issuance::run(context, command)?)
            }
        }
    }

    fn build_context() -> Result<CliContext, CliError> {
        let config = CliConfig::load_config();

        let provider = NodeProvider::new(config.node_url.clone())?;
        let signer = Signer::new(
            &config.mnemonic,
            Box::new(NodeProvider::new(config.node_url)?),
        );

        Ok(CliContext { signer, provider })
    }
}
