from app import create_app
from app.services import kric_network

app = create_app()
# 지하철 시간표 자료(KRIC)가 없으면 서버를 켜면서 뒤에서 받는다. 받는 동안 경로 화면은 "준비 중" 안내를 보여 준다
kric_network.start_auto_build(app)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
