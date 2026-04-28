"""Persistent JSON store for user-added LLM provider configurations.

Lives at ``~/.seeg-agent/providers.json``. The shape is intentionally a flat
list so it is easy to inspect by hand:

```json
[
  {
    "id": "qwen-custom-1",
    "label": "通义 Qwen-Plus (我的)",
    "provider_type": "openai_compat",
    "model_name": "qwen-plus",
    "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "api_key": "sk-..."
  },
  {
    "id": "claude-extra-1",
    "label": "Claude (alt key)",
    "provider_type": "anthropic",
    "model_name": "claude-sonnet-4-5",
    "api_key": "sk-ant-..."
  }
]
```

`provider_type` is one of:
  - "anthropic"      → AnthropicModel (api_key required, no base_url)
  - "openai_compat"  → OpenAIChatModel via OpenAIProvider
                       (used for OpenAI/DeepSeek/Qwen/Kimi/Ollama style)

We keep the schema permissive: unknown fields are preserved, missing optional
fields default sensibly.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..settings import settings

_LOCK = threading.Lock()


@dataclass
class CustomProvider:
    id: str
    label: str
    provider_type: str  # "anthropic" | "openai_compat"
    model_name: str
    api_key: str
    base_url: str | None = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "id": self.id,
            "label": self.label,
            "provider_type": self.provider_type,
            "model_name": self.model_name,
            "api_key": self.api_key,
        }
        if self.base_url:
            d["base_url"] = self.base_url
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "CustomProvider":
        return cls(
            id=str(d["id"]),
            label=str(d.get("label") or d["id"]),
            provider_type=str(d.get("provider_type") or "openai_compat"),
            model_name=str(d["model_name"]),
            api_key=str(d.get("api_key") or ""),
            base_url=(str(d["base_url"]) if d.get("base_url") else None),
        )


def _store_path() -> Path:
    p = settings.data_dir / "providers.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def load_all() -> list[CustomProvider]:
    p = _store_path()
    if not p.exists():
        return []
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    if not isinstance(raw, list):
        return []
    out: list[CustomProvider] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        try:
            out.append(CustomProvider.from_dict(entry))
        except (KeyError, TypeError):
            continue
    return out


def _save_all(items: list[CustomProvider]) -> None:
    p = _store_path()
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps([it.to_dict() for it in items], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    tmp.replace(p)


def add(provider: CustomProvider) -> CustomProvider:
    """Insert or overwrite by id."""
    with _LOCK:
        items = load_all()
        items = [it for it in items if it.id != provider.id]
        items.append(provider)
        _save_all(items)
        return provider


def remove(provider_id: str) -> bool:
    with _LOCK:
        items = load_all()
        new_items = [it for it in items if it.id != provider_id]
        if len(new_items) == len(items):
            return False
        _save_all(new_items)
        return True


def get(provider_id: str) -> CustomProvider | None:
    for it in load_all():
        if it.id == provider_id:
            return it
    return None


def public_view(p: CustomProvider) -> dict[str, Any]:
    """Strip api_key when listing to the frontend."""
    return {
        "id": p.id,
        "label": p.label,
        "provider_type": p.provider_type,
        "model_name": p.model_name,
        "base_url": p.base_url,
        "has_api_key": bool(p.api_key),
        "custom": True,
    }
