.PHONY: up down restart

up:
	docker compose up -d

down:
	docker compose down

restart:
	docker compose down
	docker compose build
	docker compose up -d
