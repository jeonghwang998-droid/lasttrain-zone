# 데이터

- `stations.csv`: 수도권 지하철 역 좌표 (공공데이터포털 '전국도시철도역사정보표준데이터' 가공)
- `timetables/`: 노선별 역 시간표 (공공데이터 가공, 노선당 CSV 1개)
  - 컬럼 예시: `train_no,station_id,arrive,depart,direction,day_type`
  - `day_type`: weekday / saturday / holiday

서버 시작 시 `create_app()` 에서 메모리에 적재해 자기장 계산에 사용한다.
