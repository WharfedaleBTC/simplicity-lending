use lending_sdk::Network;
use lending_sdk::provider::ProviderTrait;
use lending_sdk::signer::Signer;

use crate::indexer::IndexerClient;

pub struct Session {
    provider: Box<dyn ProviderTrait>,
    signer: Signer,
    indexer: IndexerClient,
}

impl Session {
    pub fn new(provider: Box<dyn ProviderTrait>, signer: Signer, indexer: IndexerClient) -> Self {
        Self {
            provider,
            signer,
            indexer,
        }
    }

    pub fn provider(&self) -> &dyn ProviderTrait {
        self.provider.as_ref()
    }

    pub fn signer(&self) -> &Signer {
        &self.signer
    }

    pub fn indexer(&self) -> &IndexerClient {
        &self.indexer
    }

    pub fn network(&self) -> Network {
        *self.provider.get_network()
    }

    pub fn into_parts(self) -> (Box<dyn ProviderTrait>, Signer, IndexerClient) {
        (self.provider, self.signer, self.indexer)
    }
}
