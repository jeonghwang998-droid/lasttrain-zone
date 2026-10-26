import os
from pathlib import Path

from dotenv import load_dotenv

# 루트 .env 를 읽음 (docker 에서는 env_file 로 주입)
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

BASE_DIR = Path(__file__).resolve().parents[1]


class Config:
    SUPABASE_URL = os.getenv("SUPABASE_URL", "")
    SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")

    ODSAY_API_KEY = os.getenv("ODSAY_API_KEY", "")
    KMA_API_KEY = os.getenv("KMA_API_KEY", "")

    VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
    VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
    VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "")

    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")

    DATA_DIR = BASE_DIR / "data"
    MODEL_PATH = BASE_DIR / "app" / "ml" / "models" / "delay_model.joblib"

    # 서비스 기본값
    DEFAULT_BUFFER_MIN = 5
    ROUTE_CACHE_TTL_SEC = 600
    ZONE_CACHE_TTL_SEC = 1800
    ALERT_OFFSETS_MIN = (30, 10, 0)
