"""Runtime configuration (env-driven)."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    redis_url: str = "redis://redis-cache:6379"
    cache_ttl_seconds: int = 86_400

    nasa_power_base_url: str = "https://power.larc.nasa.gov/api/temporal/monthly/point"
    nasa_timeout_seconds: float = 10.0
    nasa_history_years: int = 5

    ga_population: int = 60
    ga_generations: int = 40
    ga_seed: int = 42

    cors_origins: str = "*"


@lru_cache
def get_settings() -> Settings:
    return Settings()
