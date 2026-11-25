# Simplicity lending on a local Wharfedale network. Start the network first:
#   cd ../wharfedale && make run
# Services are in docker/compose.yml; they join the network's Docker network.

COMPOSE := docker compose -f docker/compose.yml
NODE_COMPOSE := docker compose -f ../wharfedale/docker/compose.yml
WEB_PKG := web/src/wasm/pkg

.PHONY: help run stop clear logs ps wasm dev-config test e2e

help: ## List the targets
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  make %-10s %s\n", $$1, $$2}'

run: ## Build and start the indexer, its API and the web app (http://localhost:8090)
	@docker network inspect wharfedale_default >/dev/null 2>&1 || { echo "Start the Wharfedale network first: cd ../wharfedale && make run"; exit 1; }
	@grep -Eq '^PRINCIPAL_ASSET=[0-9a-fA-F]{64}' docker/lending.env || { echo "Set PRINCIPAL_ASSET in docker/lending.env: your USDT's asset id (issue it at http://localhost:8080/assets)"; exit 1; }
	$(COMPOSE) up -d --build

stop: ## Stop the lending services; the indexer's database is kept
	$(COMPOSE) down

clear: ## Stop and delete the indexer's database and the written config
	$(COMPOSE) down -v

logs: ## Follow the logs
	$(COMPOSE) logs -f

ps: ## Show the services
	$(COMPOSE) ps

wasm: ## Build the WebAssembly module into web/src/wasm/pkg (in Docker), for `pnpm dev`
	cd .. && docker build -f simplicity-lending/docker/web.Dockerfile --target wasm-pkg --output type=local,dest=simplicity-lending/$(WEB_PKG) .

dev-config: ## Copy the running deployment's config.json into web/public, for `pnpm dev`
	$(COMPOSE) exec -T web cat /config/config.json > web/public/config.json

test: ## Unit and contract tests (contracts run on Wharfedale's consensus code, in-process)
	SQLX_OFFLINE=true cargo test --workspace

e2e: ## Loan lifecycle against the running network and indexer (repay and liquidation paths)
	@mkdir -p target/e2e
	$(NODE_COMPOSE) exec -T node0 cat /net/faucet.json > target/e2e/faucet.json
	$(COMPOSE) exec -T web cat /config/config.json > target/e2e/config.json
	SQLX_OFFLINE=true NODE_URL=http://127.0.0.1:18447 INDEXER_URL=http://127.0.0.1:8000 \
	  FAUCET_KEY=$(CURDIR)/target/e2e/faucet.json LENDING_CONFIG=$(CURDIR)/target/e2e/config.json \
	  cargo test -p lending-e2e -- --ignored --nocapture --test-threads 1
