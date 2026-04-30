from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    llm_provider: str = "anthropic"
    llm_model: str = "claude-sonnet-4-6"
    langchain_tracing_v2: bool = False
    langchain_api_key: str = ""
    langchain_project: str = "proxim-dev"
    environment: str = "development"
    polling_interval_seconds: int = 3
    agent_port: int = 8001

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
