"""WebSocket chat endpoint that drives the Pydantic AI agent.

Wire protocol (server → client JSON messages):
  {"type": "providers", "providers": [{"id": ..., "label": ...}]}    # initial
  {"type": "delta",     "text": "..."}                                # streamed text
  {"type": "tool_call", "name": "...", "args": {...}}                 # for transparency
  {"type": "figure",    "kind": "...", "title": "...", "figures": [...]}
  {"type": "done",      "text": "..."}                                # full final text
  {"type": "error",     "message": "..."}

Client → server:
  {"type": "ask",
   "provider": "claude-sonnet-4.5",
   "recording_id": "....",
   "message": "..."}
"""

from __future__ import annotations

import asyncio
import json
import traceback
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..agent.agent import RunDeps, build_agent
from ..agent.providers import available_providers

router = APIRouter(tags=["chat"])


@router.get("/api/chat/providers")
def list_providers() -> list[dict]:
    return [{"id": p.id, "label": p.label} for p in available_providers()]


@router.websocket("/ws/chat")
async def chat_ws(ws: WebSocket) -> None:
    await ws.accept()
    try:
        await ws.send_json(
            {
                "type": "providers",
                "providers": [
                    {"id": p.id, "label": p.label} for p in available_providers()
                ],
            }
        )

        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_json({"type": "error", "message": "invalid json"})
                continue

            if msg.get("type") != "ask":
                await ws.send_json({"type": "error", "message": f"unknown type: {msg.get('type')}"})
                continue

            await _handle_ask(ws, msg)
    except WebSocketDisconnect:
        return


async def _handle_ask(ws: WebSocket, msg: dict[str, Any]) -> None:
    provider = msg.get("provider") or "claude-sonnet-4.5"
    recording_id = msg.get("recording_id")
    user_text = msg.get("message", "").strip()
    if not user_text:
        await ws.send_json({"type": "error", "message": "empty message"})
        return

    loop = asyncio.get_running_loop()

    def emit_figure(payload: dict[str, Any]) -> None:
        # Tool runs in the agent's executor thread; safely schedule the WS send.
        asyncio.run_coroutine_threadsafe(
            ws.send_json({"type": "figure", **payload}), loop
        )

    deps = RunDeps(recording_id=recording_id, emit_figure=emit_figure)

    try:
        agent = build_agent(provider)
    except Exception as e:
        await ws.send_json({"type": "error", "message": f"无法初始化 provider {provider}: {e}"})
        return

    try:
        async with agent.run_stream(user_text, deps=deps) as run:
            async for chunk in run.stream_text(delta=True):
                if chunk:
                    await ws.send_json({"type": "delta", "text": chunk})
            final_text = await run.get_output()
            await ws.send_json({"type": "done", "text": final_text or ""})
    except Exception as e:  # pragma: no cover
        traceback.print_exc()
        await ws.send_json({"type": "error", "message": f"{type(e).__name__}: {e}"})
