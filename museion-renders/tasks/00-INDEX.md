# Museion Blender 강화 작업 — 전체 지도

## 정본 (중복 방지 — 반드시 먼저 읽을 것)
- **스틸 3종은 이미 완료됐다 (2026-10-30 20:55, Blender MCP 방식, 이 맥에서 렌더)**: diorama-hero.png, ember-split.png, cold-open.png, museion-cafe.blend (씬 3개: 01 Campfire / 02 Ember split / 03 Cold open), render-notes.json, validation.json 참조. **이 스틸들을 다시 만들지 마라.**
- 정본 씬은 **museion-cafe.blend**다. 강화 작업은 이 .blend를 열고 MCP로 이어서 작업하는 것이 원칙이다.
- ~/museion-renders/build_scene.py 와 map_scene.py 는 ComBba VM에서 만든 평행 구현(참조용)이다. 여기서 새 씬을 만들면 정본과 갈라지므로, 스크립트 방식이 필요하면 .blend에서 뽑은 현재 상태를 기준으로 삼아라.
- 지도(map) 스틸은 ComBba VM에서 별도 진행 중(map_scene.py 기준) — 지도 스틸은 중복 작업하지 마라. 지도 '움직임'은 04 단계 참고.

## 목적
Meta 해커톤(Musely) 데모용 Blender 에셋을 '계속 사용 가능한 수준'으로 강화한다.

## 공통 규칙
- 방법: Blender 5.2 + blender_mcp 애드온 (localhost:9876). 렌더는 이 맥의 Metal GPU Cycles.
- 모든 신규 산출물은 ~/museion-renders/out/ 에 저장. 기존 정본 파일(diorama-hero.png 등)은 덮어쓰지 마라.
- 각 단계가 끝나면 이 파일 하단 '진행 로그'에 한 줄씩 적어라 (날짜, 단계, 산출물 경로, 특이사항).
- 막히면 그 단계에 멈추지 말고, 로그에 사유를 적고 다음 단계로 넘어가라.

## 단계 (순서대로)
1. tasks/01-flame.md — 불꽃 강화 (정본 .blend의 01 씬에서 파생)
2. tasks/02-avatar.md — 아바타 강화 (결 문양 + 포즈 변주)
3. tasks/03-cafe-detail.md — 카페 디테일 확충 후 히어로 재렌더 (out/diorama-hero-v2.png)
4. tasks/04-map-motion.md — 지도 카메라 패스 애니메이션 (mp4) — 단, ComBba의 지도 스틸 작업과 겹치지 않게, 시작 전 로그에서 ComBba 완료 여부를 확인하고 없으면 보류로 적어라
5. tasks/05-ember-anim.md — 불씨 분리 애니메이션 (mp4, 정본 02 씬에서 파생)

## 진행 로그
- 2026-10-30 20:55 — 스틸 3종 완료 (맥 MCP 에이전트): diorama-hero.png, ember-split.png, cold-open.png, 검증 PASS (validation.json)
- 2026-10-30 23:40 — ComBba가 강화 단계 01–05를 세분화해 이 문서와 tasks/에 정리. 정본 관계 명시.

- 2026-10-31 00:35 — 01 완료 (공식 MCP 9877 / Metal Cycles): out/flame-hero.png, out/stage-01-flame.blend. 정본 01 씬 파생, 4중 불꽃·나선 불티 48개·잔불 디스크, check 및 1920×1080/80샘플 확인. 기존 스틸 보존.
- 2026-10-31 00:39 — 02 완료: out/avatar-variants.png, out/stage-02-avatars.blend. 정본 아바타에 앰버 결 엠블럼, 앉음/서기/6도 걷기 변주 및 포인트 조명 2개. 포즈의 depsgraph 갱신 보정 후 check·1920×1080 최종 확인.
- 2026-10-31 00:42 — 03 완료: out/diorama-hero-v2.png, out/stage-03-cafe.blend. 01·02 누적, 독립 폴 네온 간판·메뉴판·화분 4개·컵 스팀·의자 2색. 정본 카메라 유지. VM 좌표 (0,6.2)는 정본의 실제 후방 벡터 좌표로 대응 배치. check 및 1920×1080/80샘플 확인.
- 2026-10-31 00:42 — 04 보류: INDEX에 ComBba 지도 스틸 완료 기록이 없고 맥에 정본 지도 .blend/지도 렌더가 없음. tasks/06의 VM 데이터 검증 완료 표기는 지도 스틸 완료 인수 증거와 구분함. 지도 중복 제작 없이 05로 진행.
- 2026-10-31 00:49 — 05 완료: out/ember-split.mp4 (3.000초, 24fps, 1280×720, H.264, 72프레임, Cycles 32샘플). 정본 02 씬 파생, 단일 불씨 상승→분리→폰 도착·점등. out/ember-contact-sheet.png 시각 확인, 궤적 교차 없음·도착 오차 0·최종 화면 발광 5.0, MP4 전체 디코딩 검증.
- 2026-10-31 00:49 — 강화본 저장·검증: out/museion-enhanced.blend (정본 3씬+강화 4씬), 새 Blender 프로세스 재열기 PASS. out/validation-enhanced.json / out/saved-blend-validation.json. 기존 정본 .blend 및 스틸 3종 SHA-256 동일. 01·02·03·05 완료, 04는 선행 지도 스틸 인수 대기로 보류.
- 2026-10-31 08:2x — **지도 스틸 완료 인수 (ComBba)**: OSM 실제 지리 Blender 렌더 완성·검증됨 (건물 198,364·고속도로·해안선, 육지/물 분류 검증 8점 전부 정확). 인수 파일: out/map-real-geo.png (정본 지도 스틸), map/map_scene2_validated.py (검증본 스크립트 — 기존 map/map_scene2.py는 구버전이므로 이 검증본을 기준으로). 프리뷰 v9·v10의 1막 지도가 이 렌더이다. **04 지도 애니메이션 진행 가능** — 줌 경로는 map_scene2_validated.py의 카메라 프레이밍과 핀 좌표(HQ 최대 핀)를 기준으로 한다.
