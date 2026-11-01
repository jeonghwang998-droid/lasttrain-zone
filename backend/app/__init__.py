from flask import Flask
from flask_cors import CORS

from .config import BASE_DIR, Config


def create_app() -> Flask:
    # 프론트(frontend/)도 이 서버가 함께 내준다. 서버 주소를 열면 index.html 이 뜬다
    app = Flask(__name__, static_folder=str(BASE_DIR.parent / "frontend"), static_url_path="")
    app.config.from_object(Config)

    @app.get("/")
    def index():
        return app.send_static_file("index.html")

    CORS(app, origins=[o.strip() for o in Config.FRONTEND_ORIGIN.split(",") if o.strip()])

    from .api.health import bp as health_bp
    from .api.me import bp as me_bp
    from .api.subway import bp as subway_bp
    from .api.plan import bp as plan_bp
    from .api.zone import bp as zone_bp
    from .api.rooms import bp as rooms_bp
    from .api.push import bp as push_bp
    from .api.walk import bp as walk_bp

    for bp in (health_bp, me_bp, subway_bp, plan_bp, zone_bp, rooms_bp, push_bp, walk_bp):
        app.register_blueprint(bp, url_prefix="/api")

    # TODO: 서버 시작 시 1회 적재
    #   - backend/data/stations.csv, timetables/ → 메모리 (core/zone.py 에서 사용)
    #   - ml/models/delay_model.joblib → DelayPredictor
    return app
