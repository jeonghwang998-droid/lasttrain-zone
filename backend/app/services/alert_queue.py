"""알림 예약 큐 (Redis Sorted Set)

- 키: alerts
- member: "{user_id}|{room_id or -}|{kind}"   kind = 30, 10, 0, call
- score : 보낼 시각 (epoch 초)
위치가 바뀌어 다시 계산되면 cancel_user → schedule 로 갈아끼운다.
"""
KEY = "alerts"


def schedule(user_id: str, room_id: str | None, kind: str, send_at_epoch: float) -> None:
    """TODO: ZADD"""
    raise NotImplementedError


def cancel_user(user_id: str) -> None:
    """TODO: 해당 사용자 알림 전부 ZREM"""
    raise NotImplementedError


def pop_due(now_epoch: float) -> list[str]:
    """TODO: ZRANGEBYSCORE 0~now → ZREM (워커 여러 개면 Lua 스크립트나 ZPOPMIN 으로 원자적 처리)"""
    raise NotImplementedError
