SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help install setup dev client-dev server-dev build build-client build-server \
	lint lint-client lint-server clean clean-client clean-server \
	db-generate db-push db-seed db-migrate db-studio preview start

help:
	@echo "CertiVerify Makefile"
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@echo "Dev & setup"
	@echo "  install       Install frontend and server deps"
	@echo "  setup         Run setup-server.sh (keys + prisma + seed)"
	@echo "  dev           Start frontend + server (same terminal)"
	@echo "  client-dev    Start frontend only"
	@echo "  server-dev    Start server only"
	@echo ""
	@echo "Build & lint"
	@echo "  build         Build frontend + server"
	@echo "  build-client  Build frontend only"
	@echo "  build-server  Build server only"
	@echo "  lint          Typecheck frontend + server"
	@echo "  lint-client   Typecheck frontend only"
	@echo "  lint-server   Typecheck server only"
	@echo ""
	@echo "Database (server)"
	@echo "  db-generate   prisma generate"
	@echo "  db-push       prisma db push"
	@echo "  db-seed       run seed script"
	@echo "  db-migrate    prisma migrate dev"
	@echo "  db-studio     prisma studio"
	@echo ""
	@echo "Other"
	@echo "  clean         Remove build outputs"
	@echo "  preview       Preview frontend build"
	@echo "  start         Start server from dist"

install:
	npm install
	npm --prefix server install

setup:
	bash setup-server.sh

dev:
	@echo "Starting frontend and server..."
	@npm run dev & npm --prefix server run dev & wait

client-dev:
	npm run dev

server-dev:
	npm --prefix server run dev

build: build-client build-server

build-client:
	npm run build

build-server:
	npm --prefix server run build

lint: lint-client lint-server

lint-client:
	npm run lint

lint-server:
	npm --prefix server run lint

clean: clean-client clean-server

clean-client:
	npm run clean

clean-server:
	rm -rf server/dist

db-generate:
	npm --prefix server run db:generate

db-push:
	npm --prefix server run db:push

db-seed:
	npm --prefix server run db:seed

db-migrate:
	npm --prefix server run db:migrate

db-studio:
	npm --prefix server run db:studio

preview:
	npm run preview

start:
	npm --prefix server run start
