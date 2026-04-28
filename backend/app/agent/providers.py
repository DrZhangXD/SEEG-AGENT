"""Build Pydantic AI Model instances for all supported LLM providers.

Providers are only registered when the required env vars are present.
The dynamic list is exposed via GET /api/chat/providers and drives the
frontend model selector.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from pydantic_ai.models import Model
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.openai import OpenAIProvider

from ..settings import settings
from . import provider_store


@dataclass
class ProviderSpec:
    id: str  # stable id shown to the frontend
    label: str  # human-readable label
    builder: Callable[[], Model]
    custom: bool = False  # True when sourced from providers.json (deletable in UI)


def _claude(model_name: str, api_key_override: str | None = None) -> Callable[[], Model]:
    def build() -> Model:
        key = api_key_override if api_key_override is not None else (settings.anthropic_api_key or "")
        return AnthropicModel(
            model_name,
            provider=AnthropicProvider(api_key=key),
        )

    return build


def _openai_compat(
    model_name: str, api_key: str | None, base_url: str | None = None
) -> Callable[[], Model]:
    def build() -> Model:
        kwargs: dict = {"api_key": api_key or "ollama"}
        if base_url:
            kwargs["base_url"] = base_url
        return OpenAIChatModel(model_name, provider=OpenAIProvider(**kwargs))

    return build


def _builder_for_custom(p: provider_store.CustomProvider) -> Callable[[], Model]:
    if p.provider_type == "anthropic":
        return _claude(p.model_name, api_key_override=p.api_key)
    # default: openai_compat
    return _openai_compat(p.model_name, p.api_key, p.base_url)


def available_providers() -> list[ProviderSpec]:
    out: list[ProviderSpec] = []

    if settings.anthropic_api_key:
        out.append(ProviderSpec("claude-sonnet-4.5", "Claude Sonnet 4.5", _claude("claude-sonnet-4-5")))
        out.append(ProviderSpec("claude-opus-4.1", "Claude Opus 4.1", _claude("claude-opus-4-1")))
        out.append(ProviderSpec("claude-haiku-4.5", "Claude Haiku 4.5", _claude("claude-haiku-4-5")))

    if settings.openai_api_key:
        out.append(
            ProviderSpec(
                "gpt-4o",
                "GPT-4o",
                _openai_compat("gpt-4o", settings.openai_api_key),
            )
        )
        out.append(
            ProviderSpec(
                "gpt-4.1",
                "GPT-4.1",
                _openai_compat("gpt-4.1", settings.openai_api_key),
            )
        )

    if settings.deepseek_api_key:
        out.append(
            ProviderSpec(
                "deepseek-chat",
                "DeepSeek V3",
                _openai_compat("deepseek-chat", settings.deepseek_api_key, settings.deepseek_base_url),
            )
        )
        out.append(
            ProviderSpec(
                "deepseek-reasoner",
                "DeepSeek R1",
                _openai_compat(
                    "deepseek-reasoner", settings.deepseek_api_key, settings.deepseek_base_url
                ),
            )
        )

    if settings.dashscope_api_key:
        out.append(
            ProviderSpec(
                "qwen-max",
                "通义 Qwen-Max",
                _openai_compat("qwen-max", settings.dashscope_api_key, settings.dashscope_base_url),
            )
        )
        out.append(
            ProviderSpec(
                "qwen-plus",
                "通义 Qwen-Plus",
                _openai_compat("qwen-plus", settings.dashscope_api_key, settings.dashscope_base_url),
            )
        )

    if settings.moonshot_api_key:
        out.append(
            ProviderSpec(
                "kimi-k2",
                "Kimi K2 128k",
                _openai_compat(
                    "moonshot-v1-128k", settings.moonshot_api_key, settings.moonshot_base_url
                ),
            )
        )

    # Ollama is always "available" — the user can decide if they actually have it running.
    out.append(
        ProviderSpec(
            "ollama-qwen2.5",
            "Ollama qwen2.5:14b (本地)",
            _openai_compat("qwen2.5:14b", None, settings.ollama_base_url),
        )
    )
    out.append(
        ProviderSpec(
            "ollama-llama3.2",
            "Ollama llama3.2 (本地)",
            _openai_compat("llama3.2", None, settings.ollama_base_url),
        )
    )

    # Custom providers from ~/.seeg-agent/providers.json (de-dupe by id; custom wins).
    seen = {p.id for p in out}
    for cp in provider_store.load_all():
        if cp.id in seen:
            # User added one with the same id as a built-in: replace the built-in.
            out = [p for p in out if p.id != cp.id]
        out.append(
            ProviderSpec(
                id=cp.id,
                label=cp.label,
                builder=_builder_for_custom(cp),
                custom=True,
            )
        )
    return out


def invalidate_cache() -> None:
    """Drop cached Model instances. Call after providers.json changes."""
    _CACHE.clear()


_CACHE: dict[str, Model] = {}


def get_model(provider_id: str) -> Model:
    if provider_id in _CACHE:
        return _CACHE[provider_id]
    for spec in available_providers():
        if spec.id == provider_id:
            m = spec.builder()
            _CACHE[provider_id] = m
            return m
    raise ValueError(f"未知或未启用的 provider: {provider_id}")
