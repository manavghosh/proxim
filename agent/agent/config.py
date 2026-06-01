import os

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = ""  # Required at runtime; populated from DATABASE_URL env var
    llm_provider: str = "gemini"
    llm_model: str = "gemini-2.5-flash"
    anthropic_api_key: str = ""
    gemini_api_key: str = ""
    resume_output_dir: str = "agent/output/resumes"
    langsmith_tracing: bool = False
    langsmith_api_key: str = ""
    langsmith_project: str = "Proxim"
    langsmith_endpoint: str = "https://api.smith.langchain.com"
    environment: str = "development"
    polling_interval_seconds: int = 3
    agent_port: int = 8001
    proxycurl_api_key: str = ""   # legacy — Proxycurl shut down July 2026
    exa_api_key: str = ""
    hunter_api_key: str = ""
    tracking_host: str = "http://localhost:3000"
    gmail_client_id: str = ""
    gmail_client_secret: str = ""
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_host: str = ""        # reads LANGFUSE_HOST
    langfuse_base_url: str = ""    # reads LANGFUSE_BASE_URL (alias used by some setups)
    otel_exporter_otlp_endpoint: str = "http://localhost:4317"
    otel_service_name: str = "proxim-agent"
    # Use LiteLLM's bundled pricing table instead of fetching it from GitHub on
    # cold start (avoids the "Failed to fetch remote model cost map" timeout warning).
    litellm_local_model_cost_map: bool = True

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()  # pyright: ignore[reportCallIssue]

# Bridge the setting into the OS environment LiteLLM reads. Done here (config is
# imported before litellm anywhere) so litellm uses the local cost map on import.
if settings.litellm_local_model_cost_map:
    os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")
