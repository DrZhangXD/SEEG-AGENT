.PHONY: help install backend-install frontend-install dev backend frontend test lint

help:
	@echo "SEEG-AGENT 常用命令："
	@echo "  make install           安装前后端依赖"
	@echo "  make dev               同时起后端 (8000) 和前端 (5173)"
	@echo "  make backend           只启动后端"
	@echo "  make frontend          只启动前端"
	@echo "  make test              运行后端测试"

install: backend-install frontend-install

backend-install:
	cd backend && UV_HTTP_TIMEOUT=300 uv sync

frontend-install:
	cd frontend && npm install

backend:
	cd backend && uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

frontend:
	cd frontend && npm run dev

dev:
	@echo "请在两个终端分别运行 'make backend' 和 'make frontend'"

test:
	cd backend && uv run pytest -v

lint:
	cd backend && uv run ruff check app tests
