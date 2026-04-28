"""FastAPI entrypoint for SEEG-AGENT."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import analysis, chat, electrodes, files, providers
from .settings import settings


def create_app() -> FastAPI:
    app = FastAPI(title="SEEG-AGENT", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(files.router)
    app.include_router(analysis.router)
    app.include_router(chat.router)
    app.include_router(electrodes.router)
    app.include_router(providers.router)

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok", "demo_dir": str(settings.demo_dir)}

    return app


app = create_app()
