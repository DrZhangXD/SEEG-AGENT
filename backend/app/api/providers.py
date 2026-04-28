"""REST endpoints for managing user-configured LLM providers.

GET    /api/providers          → list all (env-derived + custom), no api_keys
POST   /api/providers          → add or update one custom provider
DELETE /api/providers/{id}     → remove one custom provider

Built-in (env-derived) providers cannot be deleted; deletion only affects
custom entries in ~/.seeg-agent/providers.json.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..agent import provider_store, providers as providers_mod

router = APIRouter(prefix="/api/providers", tags=["providers"])


class CreateProviderReq(BaseModel):
    id: str = Field(..., description="稳定 id，前端选择器用，例如 'qwen-custom-1'")
    label: str = Field(..., description="显示名称")
    provider_type: str = Field(
        "openai_compat", description="'anthropic' 或 'openai_compat'"
    )
    model_name: str = Field(..., description="LLM 模型名")
    api_key: str = Field(..., description="API key（明文，仅本地存储）")
    base_url: str | None = Field(None, description="OpenAI 兼容接口的 base_url")


@router.get("")
def list_all() -> list[dict]:
    """所有 provider（含 env-derived 内置 + 自定义），不返回 api_key。"""
    custom_ids = {p.id for p in provider_store.load_all()}
    out: list[dict] = []
    for spec in providers_mod.available_providers():
        out.append(
            {
                "id": spec.id,
                "label": spec.label,
                "custom": spec.id in custom_ids or spec.custom,
            }
        )
    return out


@router.get("/custom")
def list_custom() -> list[dict]:
    """只列自定义 provider（含元数据，不含 api_key）。"""
    return [provider_store.public_view(p) for p in provider_store.load_all()]


@router.post("")
def create_or_update(req: CreateProviderReq) -> dict:
    if req.provider_type not in {"anthropic", "openai_compat"}:
        raise HTTPException(400, f"未知 provider_type: {req.provider_type}")
    if req.provider_type == "openai_compat" and not req.base_url:
        raise HTTPException(400, "openai_compat 需要 base_url")
    if not req.id.strip():
        raise HTTPException(400, "id 不能为空")
    if not req.api_key.strip():
        raise HTTPException(400, "api_key 不能为空")

    p = provider_store.CustomProvider(
        id=req.id.strip(),
        label=req.label.strip() or req.id.strip(),
        provider_type=req.provider_type,
        model_name=req.model_name.strip(),
        api_key=req.api_key,
        base_url=req.base_url,
    )
    saved = provider_store.add(p)
    providers_mod.invalidate_cache()
    return provider_store.public_view(saved)


@router.delete("/{provider_id}")
def delete(provider_id: str) -> dict:
    ok = provider_store.remove(provider_id)
    if not ok:
        raise HTTPException(404, f"未找到自定义 provider: {provider_id}")
    providers_mod.invalidate_cache()
    return {"deleted": provider_id}
