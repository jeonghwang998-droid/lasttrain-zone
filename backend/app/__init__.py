from flask import Flask
from flask_cors import CORS

from .config import Config


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object(Config)
    CORS(app, origins=[Config.FRONTEND_ORIGIN])

    from .api.health import bp as health_bp
    from .api.plan import bp as plan_bp
    from .api.zone import bp as zone_bp
    from .api.rooms import bp as rooms_bp
    from .api.push import bp as push_bp
    from .api.walk import bp as walk_bp

    for bp in (health_bp, plan_bp, zone_bp, rooms_bp, push_bp, walk_bp):
        app.register_blueprint(bp, url_prefix="/api")

    # TODO: 서버 시작 시 1회 적재
    #   - backend/data/stations.csv, timetables/ → 메모리 (core/zone.py 에서 사용)
    #   - ml/models/delay_model.joblib → DelayPredictor
    return app
