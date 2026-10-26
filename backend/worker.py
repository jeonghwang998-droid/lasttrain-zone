"""알림 워커 (API 서버와 별도 프로세스)

Redis Sorted Set 에서 시각이 된 알림을 꺼내 웹 푸시로 보낸다.
실행: python worker.py
"""
import time

from app.config import Config

POLL_SEC = 5


def run() -> None:
    print(f"[worker] 시작 (redis={Config.REDIS_URL})")
    while True:
        # TODO
        # 1. due = alert_queue.pop_due(now)          # 시각이 된 알림들
        # 2. 각 알림의 user_id 로 push_subscriptions 조회 (services/db.py)
        # 3. pywebpush.webpush(subscription, json.dumps({title, body, url, tag}), vapid_private_key=..., vapid_claims=...)
        # 4. 410 Gone 응답이면 해당 구독 삭제
        time.sleep(POLL_SEC)


if __name__ == "__main__":
    run()
