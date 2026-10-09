"""Application configuration — environment-driven settings (project.md §29)."""

from functools import cached_property

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Backend environment variables. See `.env.example` at the repo root."""

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Supabase (project.md §29)
    SUPABASE_URL: str = ""
    SUPABASE_ANON_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    SUPABASE_JWT_SECRET: str = ""
    SUPABASE_JWKS_URL: str = ""  # defaults to {SUPABASE_URL}/auth/v1/.well-known/jwks.json
    DATABASE_URL: str = ""  # points at the Supabase pooler

    # AI copilot (built last — issue #17)
    LLM_API_KEY: str = ""

    # Helpdesk (grounded Groq assistant)
    GROQ_API_KEY: str = ""  # Groq console key — backend only, never exposed
    GROQ_MODEL: str = "llama-3.3-70b-versatile"

    # App
    CORS_ORIGINS: str = "http://localhost:5173"
    ENVIRONMENT: str = "development"

    @cached_property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @cached_property
    def is_development(self) -> bool:
        return self.ENVIRONMENT.lower() in {"development", "dev", "local"}


settings = Settings()
