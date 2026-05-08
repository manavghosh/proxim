from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = ""  # Required at runtime; populated from DATABASE_URL env var
    llm_provider: str = "anthropic"
    llm_model: str = "claude-sonnet-4-6"
    anthropic_api_key: str = ""
    gemini_api_key: str = ""
    resume_output_dir: str = "agent/output/resumes"
    langchain_tracing_v2: bool = False
    langchain_api_key: str = ""
    langchain_project: str = "proxim-dev"
    environment: str = "development"
    polling_interval_seconds: int = 3
    agent_port: int = 8001

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()  # pyright: ignore[reportCallIssue]
