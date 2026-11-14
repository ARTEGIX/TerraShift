"""Runtime configuration (env-driven) for agronomy-engine."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    atlas_mongo_uri: str = ""
    lookup_mongo_uri: str = ""
    general_mongo_uri: str = ""

    redis_url: str = "redis://redis-cache:6379"
    cache_ttl_seconds: int = 86_400

    nasa_power_base_url: str = "https://power.larc.nasa.gov/api/temporal/monthly/point"
    nasa_timeout_seconds: float = 10.0

    ga_population: int = 50
    ga_generations: int = 30
    ga_seed: int = 42

    cors_origins: str = "*"

    def resolved_lookup_uri(self) -> str:
        if self.lookup_mongo_uri and "<username>" not in self.lookup_mongo_uri and not self.lookup_mongo_uri.startswith("/"):
            return self.lookup_mongo_uri
        if self.atlas_mongo_uri and "<username>" not in self.atlas_mongo_uri:
            base = self.atlas_mongo_uri.rstrip("/")
            return f"{base}/lookup_db?retryWrites=true&w=majority"
        return ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
