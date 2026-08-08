.PHONY: up down restart rebuild

up:
	docker compose up -d

down:
	docker compose down

restart:
	docker compose down
	docker compose build
	docker compose up -d

rebuild:
	docker compose down
	docker compose build --no-cache
	docker compose up -d
