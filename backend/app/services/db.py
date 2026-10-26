"""Supabase 접근 (service role, RLS 우회 → 반드시 권한 확인 후 호출)

TODO
- get_client() : supabase.create_client(Config.SUPABASE_URL, Config.SUPABASE_SERVICE_ROLE_KEY)
- get_home(user_id), get_profile(user_id)
- create_room(...), find_room_by_code(code), is_member(room_id, user_id)
- upsert_member(room_id, user_id, leave_at=None, status=None)
- list_push_subscriptions(user_id), delete_push_subscription(endpoint)
- add_walk_trip(user_id, distance_m, minutes), list_walk_trips(user_id)
"""
from ..config import Config
