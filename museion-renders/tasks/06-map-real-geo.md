# 06 — 실제 지리 지도 (OSM 기반 Blender 지도)

## 진행 상태 (2026-10-31 00:1x, ComBba VM 검증 완료)
- REG 확정: (-122.56, 37.15, **-121.80**, 37.92) — 동쪽 경계가 산호세를 잘랐던 버그 수정 (extract/make_land3 반영됨).
- 추출 검증: 건물 198,364 · 고속도로 12,981 ways · 해안선 360 ways · 물 폴리곤 2,182.
- 육지/물 분류 정본 = **make_land3.py** (barrier=해안선+건물셀+고속도로셀 flood fill). 검증 8점 전부 정확 (SF·SJ·HQ·오클랜드·반도=육지, 만 중앙·바다·남만=물). water_cells 117,806 / land_cells 111,626 / fabric 28,398.
- 실패한 방식 (반복 금지): ① polygonize — 만 분리 안 됨 ② 해안선만 barrier인 flood fill — 누수 전역 침수 ③ Natural Earth 10m land — 남만 누락·SJ 오분류.
- 렌더 구조 (VM 검증본 map_scene2.py): 육지/물=래스터 셀 쿼드, 건물=병합 프리즘 198k, 고속도로 리본, 핀 8개 실좌표. 검증본 스크립트와 렌더 PNG는 프리뷰 v9와 함께 OneDrive /ComBba로 전달 — 맥에서 이어받을 때는 그 검증본 기준.

## 배경
프리뷰 1막 지도를 손으로 배치한 가짜 지리가 아니라 **실제 Bay Area 지리**로 다시 만든다. ComBba가 파이프라인을 설계·검증 중이며, 정본 작업은 이 맥에서 한다 (스크립트는 ~/museion-renders/map/ 에 있음).

## 절차
1. 데이터: `cd ~/museion-renders/map && curl -L -o norcal.osm.pbf https://download.geofabrik.de/north-america/us/california/norcal-latest.osm.pbf` (약 655MB, Geofabrik norcal 추출본)
2. 파이썬 환경: `python3 -m venv .venv && .venv/bin/pip install osmium shapely`
3. 추출: `.venv/bin/python extract_osm.py` → bayarea.json (건물·고속도로·해안선). 로그의 buildings/highways 개수를 INDEX 로그에 기록.
4. 육지/물: `.venv/bin/python make_land.py` → land.json (해안선 polygonize로 육지·물 분리 + 육지 패브릭 샘플점)
5. 렌더: `MUSEION_OUT=/Users/kimsejun/museion-renders/out blender -b --factory-startup -P map_scene2.py -- check` 로 구도 확인 → 문제없으면 `-- full`.
   - Blender 경로는 이 맥의 Blender 5.2 바이너리 사용.
6. 산출물: out/map-museion2.png + out/museion-map2.blend

## 완료 기준
- 샌프란시스코가 북서쪽에 실제 건물 밀도(다운타운 고층 포함)로 보인다
- 만(灣)과 해안선 형상이 실제 지리와 일치하고, 다리(고속도로)가 물을 건넌다
- 핀 8개(SF·HQ·PA·MV·SV·CU·SJ·OK)가 실제 좌표에 있고, HQ가 가장 크다
- ComBba의 VM 검증 결과와 큰 차이가 있으면 INDEX 로그에 차이를 적어라 (둘 중 하나가 정본 — 맥 렌더가 정본)
