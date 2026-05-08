from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Service auth — shared secret between Next.js proxy and this service.
    # Set in Railway environment variables. Never expose to browser.
    analysis_service_api_key: str = "dev-api-key"

    # CORS — comma-separated list of allowed origins.
    allowed_origins: str = "http://localhost:3000"

    # OpenAI
    openai_api_key: str = ""
    # Per-call timeout for the OpenAI HTTP client. Network-bound; longer than
    # most API calls but shorter than Railway's request budget.
    openai_timeout_seconds: float = Field(default=60.0, ge=1.0, le=300.0)
    # Max retry attempts for *retryable* OpenAI errors (timeout, connection,
    # 5xx, 429). Counted as additional attempts on top of the first try, so
    # 3 means "first try + up to 3 retries = 4 total attempts max".
    openai_max_retries: int = Field(default=3, ge=0, le=10)

    # Supabase service role key for fetching private images
    supabase_url: str = ""
    supabase_service_role_key: str = ""

    # Image upload caps — applied to bytes pulled from Supabase Storage
    # before they're sent to OpenAI. Reject anything over the cap with 413.
    image_max_bytes: int = Field(default=15 * 1024 * 1024, ge=1024)

    # App
    app_env: str = "development"
    log_level: str = "info"

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )


settings = Settings()
