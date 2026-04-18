from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Service auth — shared secret between Next.js proxy and this service.
    # Set in Railway environment variables. Never expose to browser.
    api_key: str = "dev-api-key"

    # OpenAI
    openai_api_key: str = ""

    # Supabase service role key for fetching private images
    supabase_url: str = ""
    supabase_service_role_key: str = ""

    # App
    app_env: str = "development"
    log_level: str = "info"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )


settings = Settings()
