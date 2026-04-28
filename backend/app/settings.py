from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    data_dir: Path = Field(default=Path.home() / ".seeg-agent")
    demo_dir: Path = Field(default=Path(__file__).resolve().parents[2] / "demo")

    cors_origins: list[str] = Field(default=["http://localhost:5173", "http://127.0.0.1:5173"])

    anthropic_api_key: str | None = None
    openai_api_key: str | None = None
    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com/v1"
    dashscope_api_key: str | None = None
    dashscope_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    moonshot_api_key: str | None = None
    moonshot_base_url: str = "https://api.moonshot.cn/v1"
    ollama_base_url: str = "http://localhost:11434/v1"

    @property
    def upload_dir(self) -> Path:
        p = self.data_dir / "uploads"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def cache_dir(self) -> Path:
        p = self.data_dir / "cache"
        p.mkdir(parents=True, exist_ok=True)
        return p


settings = Settings()
