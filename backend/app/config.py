import os
from urllib.parse import unquote
from pathlib import Path

from dotenv import load_dotenv

# 루트 .env 를 읽음 (docker 에서는 env_file 로 주입)
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

BASE_DIR = Path(__file__).resolve().parents[1]


class Config:
    SUPABASE_URL = (os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL", "")).rstrip("/")
    SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")  # HS256(예전 방식) 토큰일 때만 필요
    # 사용자 토큰으로 Supabase 를 읽을 때 쓰는 공개 키. 프론트와 같은 값
    SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY") or os.getenv("VITE_SUPABASE_ANON_KEY", "")

    # 공공데이터포털 인증키. Encoding 키(%가 들어 있는 것)를 넣어도 requests 가 다시 인코딩하지 않도록 풀어서 쓴다
    DATA_GO_KR_KEY = unquote(os.getenv("DATA_GO_KR_KEY", ""))
    # 한국철도공사 철도 공공데이터 포털(data.kric.go.kr) 서비스키. 계정 하나에 키 하나로 모든 API 를 쓴다
    # (도시철도 전체노선정보: 노선별 역 순서, 역사별 운행시각표: 열차번호 시간표)
    KRIC_API_KEY = unquote(os.getenv("KRIC_API_KEY", ""))
    ODSAY_API_KEY = os.getenv("ODSAY_API_KEY", "")
    KMA_API_KEY = os.getenv("KMA_API_KEY", "")

    VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
    VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
    VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "")

    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    # 쉼표로 여러 개 가능 (Vite 5173, VS Code Go Live 5500 등)
    FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173,http://localhost:5500,http://127.0.0.1:5500")

    DATA_DIR = BASE_DIR / "data"
    MODEL_PATH = BASE_DIR / "app" / "ml" / "models" / "delay_model.joblib"

    # 서비스 기본값
    DEFAULT_BUFFER_MIN = 5
    ROUTE_CACHE_TTL_SEC = 600
    ZONE_CACHE_TTL_SEC = 1800
    SUBWAY_CATALOG_TTL_SEC = 7 * 24 * 3600  # 노선/역 목록은 자주 안 바뀐다
    LAST_TRAIN_CACHE_TTL_SEC = 6 * 3600     # 역별 시간표(막차)
    SUBWAY_CATALOG_PATH = DATA_DIR / "subway_catalog.json"  # 받아 둔 노선/역 목록 (git 제외)
    # 같은 이름 역에서 다른 노선으로 갈아탈 때 걷는다고 보는 시간(분). KRIC 자료에 환승 시간이 없어서 둔 가정값
    TRANSFER_WALK_MIN = 4
    ALERT_OFFSETS_MIN = (30, 10, 0)
