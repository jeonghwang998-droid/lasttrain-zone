-- 회원 탈퇴: 로그인한 사용자가 자기 계정을 진짜로 지운다
-- Supabase 대시보드 > SQL Editor 에서 실행한다. (2026-11-10 확인: 서버에 delete_my_account 가 없어서 탈퇴가 안 되던 상태)
--
-- 순서
--   1) 들어가 있던 모임에서 먼저 나온다 (leave_room: 방장이면 다음 멤버에게 넘기고, 혼자였다면 방이 닫힌다)
--   2) 그래도 내가 방장으로 남아 있는 모임(혼자 남아 닫힌 방)은 지운다
--   3) 로그인 계정(auth.users)을 지운다. 프로필, 집, 등록한 경로, 모임 설정, 걸음 기록 등은
--      auth.users / profiles 를 참조하는 ON DELETE CASCADE 로 함께 지워진다

CREATE OR REPLACE FUNCTION public.delete_my_account() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_room uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '로그인이 필요해요';
  END IF;

  FOR v_room IN SELECT room_id FROM room_members WHERE user_id = v_uid LOOP
    PERFORM leave_room(v_room);
  END LOOP;

  DELETE FROM rooms WHERE host_id = v_uid;
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;
