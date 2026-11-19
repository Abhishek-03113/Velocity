# `make` with no target starts the Docker stack, as before. `make help` lists everything.
.DEFAULT_GOAL := up

.PHONY: help install dev dev-server dev-client build test test-server test-client lint typecheck bench \
        up down restart rebuild logs ps latex

# ---- Local development (Bun) -------------------------------------------------

help: ## List targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-13s %s\n", $$1, $$2}'

install: ## Install root, client and server deps with Bun
	bun install --frozen-lockfile
	bun install --frozen-lockfile --cwd client
	bun install --frozen-lockfile --cwd server

dev: ## Run the API (bun --watch) and Vite together
	bun run dev

dev-server: ## Run only the API on Bun
	bun run dev:server

dev-client: ## Run only Vite on Bun
	bun run dev:client

build: ## Production client build
	bun run build

test: test-server test-client ## Server + client unit tests

test-server: ## Server API tests (bun test)
	bun run --cwd server test

test-client: ## Client unit tests (Vitest on Bun)
	bun run --cwd client test

lint: ## ESLint the client
	bun run --cwd client lint

typecheck: ## tsc for the client
	bun run --cwd client typecheck

bench: ## Node vs Bun benchmark (needs BASELINE_DIR, see scripts/bench-runtime.mjs)
	bun run bench:runtime

# ---- Docker (oven/bun images) ------------------------------------------------

up: ## Build if needed and start the stack
	docker compose up -d --build

down: ## Stop the stack
	docker compose down

restart: ## Rebuild and restart the stack
	docker compose down
	docker compose build
	docker compose up -d

rebuild: ## Rebuild without the layer cache and restart
	docker compose down
	docker compose build --no-cache
	docker compose up -d

latex: ## Rebuild the server image with TeX Live for PDF compiles
	LATEX=on docker compose build server
	docker compose up -d

logs: ## Follow the server logs
	docker compose logs -f server

ps: ## Show container status and health
	docker compose ps
