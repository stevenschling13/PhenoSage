from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Service auth — shared secret between Next.js proxy and this service.
    # Set in Railway environment variables. Never expose to browser.
    analysis_service_api_key: str = "dev-api-key"

    # CORS — comma-separated list of allowed origins.
    allowed_origins: str = "http://localhost:3000"

    # OpenAI
    openai_api_key: str = ""

    # Supabase service role key for fetching private images
    supabase_url: str = ""
    supabase_service_role_key: str = ""

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

