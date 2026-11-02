# Musely 태스크 실행 명세

> 구현 시에는 `superpowers:executing-plans`를 적용하고 지정된 Orca 검토 탭을 재사용한다. 새 에이전트 생성이나 외부 게시 권한을 이 문서로 확대하지 않는다.

**Goal:** 이슈와 고정된 줄 참조만으로 단계·범위·입출력·실패 동작·검증을 일관되게 실행한다.

**Architecture:** S1 fixture 경험을 라이브 권한과 격리한다. S2 공유 명령/Task/기록 계약을 기능들이 함께 사용하고 S3 동일 배포 빌드의 결과를 검증한다. S4 일반 사용자 운영은 별도 게이트다.

**Tech Stack:** 기존 TypeScript·MapLibre·Three.js·Cloudflare Worker/Durable Object·WebCrypto·Node tests. Node 24 및 repository lockfile을 따른다.

**Spec:** `2026-11-01-four-stage-roadmap.md`, `execution-contract.md`, `../musely-direction-v2-2026-11-01.md`.

## 공통 실행 순서

- ready 전에 선행 이슈·단계 게이트·파일 소유권·외부 checkpoint를 확인한다. S2는 P-07 완료 후 착수한다.
- 각 태스크에서 아래 체크리스트를 재현 가능한 회귀/브라우저/실계정 증거로 판정한다. 로컬·배포·실기기를 구분한다.
- 기능 수정은 해당 실패 회귀를 먼저 실행→최소 구현→관련 회귀→npm run check→독립 검토→PR/배포 증거 순이다. 문서·관찰 태스크는 불필요한 제품 테스트를 새로 만들지 않는다.
- 본 명세의 구현 선택은 기본 계약이며 기존 제품 결정을 임의로 바꾸지 않는다. 변경 시 이슈·문서·coverage를 함께 갱신한다.

## Review Focus

- fixture 모드가 claim·위임·보상을 실제로 승격하지 않는가: P-02/P-03/P-07/I-02.
- await 중 철회·중복/동시 요청이 부작용을 우회하지 않는가: I-01/I-07/D-03.
- 주인 목적지와 Muse 현재 셀이 섞여 이동 전 보상이 생기지 않는가: I-08/I-06.
- 재생·모델 폴백·실제 연결 Muse의 출처와 카운터가 혼합되지 않는가: I-04/I-10/I-11/D-02.
- 모바일 측정·배포 증거·계정 receipt가 준비/에뮬레이션/도구 목록 조회로 대체되지 않는가: D-01/D-04/D-06.

## P-01 — 전체 경험·카탈로그·상태 대응표 확정

에픽: S1-E1 · 선행: 없음

계약: C01, C02, C09 · 방향 v2 절: 6, 7, 8, 9, 10, 11, 12, 13, 14

### 범위와 인터페이스

- 입력: 방향 v2 전체 목록, 현재 ItemSpec/ActionSpec/Place IDs
- 출력: C02 스키마의 경험 대응표와 빠짐없는 카탈로그 행
- 대상 경로: `preview/docs/EXPERIENCE_MATRIX.md`, `preview/src/engine/items.ts`, `preview/src/engine/beats.ts`, `preview/src/engine/places.ts`
- 재사용 근거: #18·#23 카탈로그/행동 재사용
- 제외/제약: 실제 API·MCP·인증 성공을 요구하지 않음

### 완료 체크리스트

- [ ] 모든 아이템·행동·장소·소통 유형에 고유 ID와 담당 구현 태스크가 있음
- [ ] 각 경험에 entry/action/success/reject/cancel/retry 상태와 출처·시각 상태가 있음
- [ ] 자율성 6항목의 화면·집계 범위가 정의됨

### 검증과 인계

- 검증: 대응표의 ID 집합과 소스 카탈로그를 비교하고 중복/누락 0건 기록
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## P-02 — 관전·체험·내 Muse 연결 진입과 하네스 선택

에픽: S1-E1 · 선행: P-01

계약: C01, C02, C04 · 방향 v2 절: 6, 7

### 범위와 인터페이스

- 입력: EXP-ENTRY와 10종 하네스 데이터
- 출력: 관전/격리 체험/연결 안내의 세 경로와 각 상태 화면
- 대상 경로: `preview/src/main.ts`, `preview/src/ui/onboarding.ts`, `preview/src/engine/harness.ts`
- 재사용 근거: #2 캐릭터·#19/#21/#24 wants 재사용
- 제외/제약: 실제 Muse 연결은 I-04

### 완료 체크리스트

- [ ] 10종 성격·목표·스킬·도구·허용/승인/금지 범위를 확인 가능
- [ ] 미연결/연결 연출/오류/취소/재진입이 구분됨
- [ ] 연결 연출·기록 재생이 실제 owner claim이나 라이브 거래 권한을 만들지 않음

### 검증과 인계

- 검증: 데스크톱·390×844에서 세 진입 경로와 취소/재진입을 browser 기록
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## P-03 — 신원·보상·조율·주인 개입의 상태별 프리뷰

에픽: S1-E1 · 선행: P-01

계약: C02, C04, C06, C07 · 방향 v2 절: 6, 9, 12, 14

### 범위와 인터페이스

- 입력: EXP-IDENTITY/REWARD/MEETUP/COMMS 상태표
- 출력: 권한·보상·조율·양쪽 주인 승인/거절·철회 장면
- 대상 경로: `preview/src/ui/preview-flows.ts`, `preview/src/ui/world-panel.ts`, `preview/fixtures/preview-flows.json`
- 재사용 근거: 기존 story와 #20 신원 UI 표현 재사용
- 제외/제약: 실제 인증·서명·모델 성공은 S2

### 완료 체크리스트

- [ ] P0 전후와 P1 아이템 전후 경험이 조작 가능하며 연출을 표시
- [ ] 합의 불가·한쪽 거절·철회·만료·복귀 상태를 볼 수 있음
- [ ] 사적인 거절 이유/일정 원문은 상대 말풍선에 나타나지 않음

### 검증과 인계

- 검증: fixture 상태별 browser 워크스루·스크린샷과 네트워크에서 라이브 쓰기 0건
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## P-04 — 프리뷰 경험과 구현 요구사항·수용 기준 고정

에픽: S1-E1 · 선행: P-01, P-02, P-03

계약: C01, C02, C12 · 방향 v2 절: 1, 6, 7, 9, 10, 11, 12, 13, 14, 16

### 범위와 인터페이스

- 입력: P-01~03 경험별 검토 결과
- 출력: 각 경험→S2 태스크→S3 검증의 추적 표와 미결정 목록
- 대상 경로: `docs/museion-prd-2026-10-30.md`, `preview/docs/EXPERIENCE_MATRIX.md`, `docs/roadmap/execution-contract.md`
- 재사용 근거: PRD는 역사적 요구 참조
- 제외/제약: S1 경험의 승인 없이 제품 방향을 임의 확정하지 않음

### 완료 체크리스트

- [ ] 과거 M0~M8 순서를 현행 선행 조건으로 쓰지 않음
- [ ] 모든 프리뷰 경험은 구현/검증 태스크로 연결되고 범위 밖은 명시됨
- [ ] 단계 게이트·미결정 결정의 담당과 해제 조건이 기록됨

### 검증과 인계

- 검증: 요구 ID별 ownerTask 유일성과 구현/검증 링크 커버리지 전수 검사
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## P-05 — 지도부터 근경까지 하나로 이어지는 프리뷰 경험

에픽: S1-E2 · 선행: P-02, P-03

계약: C02, C08, C11 · 방향 v2 절: 8, 10, 11, 13

### 범위와 인터페이스

- 입력: P-02/03 흐름과 지도/캐릭터 자산
- 출력: 모드별 일관된 선택·팔로우·이동·대화·보상 표현
- 대상 경로: `preview/src/main.ts`, `preview/src/camera.ts`, `preview/src/ui/preview-flows.ts`, `preview/src/character-kit/MuseActor.ts`
- 재사용 근거: #14 진입·#23 행동·#25 패널 재사용
- 제외/제약: 새 지역 3D 장면·실제 서버 완료 요구 제외

### 완료 체크리스트

- [ ] 지도↔근경 전환에서 선택 Muse/상태/출처 유지
- [ ] 대본과 세계 관전이 명시적으로 구분되고 모드 복귀 가능
- [ ] 아이템 변화가 행동·소품·말풍선과 이어짐. 대체 표현 표시

### 검증과 인계

- 검증: entry.browser.js 및 새 preview-flows.browser.js의 desktop/mobile 워크스루
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## P-06 — 출처·위치·하이라이트·재생·증거 UI 완성

에픽: S1-E2 · 선행: P-05

계약: C02, C08, C09 · 방향 v2 절: 2, 8, 13, 14, 16

### 범위와 인터페이스

- 입력: EXP-REPLAY/LOCATION과 이벤트·증거 fixture
- 출력: live/rule/scripted/replay/planned, 가상 위치·배속·증거 화면
- 대상 경로: `preview/src/ui/world-panel.ts`, `preview/src/ui/preview-flows.ts`, `preview/src/style.css`
- 재사용 근거: #25 패널·#26 성능 표시 참고
- 제외/제약: 실제 run player는 I-11

### 완료 체크리스트

- [ ] 출처가 실제 연결 상태와 일치하고 API 실패는 stale/error 표시
- [ ] 1/10/60배·하이라이트·증거 열기/닫기/복귀가 가능
- [ ] 자율성 6항목의 기간·표본·미측정 표시와 모바일 접근성 확인

### 검증과 인계

- 검증: world-ui.browser.js·preview-flows.browser.js 상태별 UI 확인
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## P-07 — 프리뷰 전체 워크스루와 S1 완료 게이트

에픽: S1-E2 · 선행: P-04, P-05, P-06

계약: C01, C02, C10 · 방향 v2 절: 1, 14, 16, 20

### 범위와 인터페이스

- 입력: 동일 프리뷰 빌드의 전체 경험 표
- 출력: 브라우저 증거와 확정된 S1 범위/구현 전달 기록
- 대상 경로: `preview/docs/PREVIEW_ACCEPTANCE.md`, `preview/docs/EXPERIENCE_MATRIX.md`
- 재사용 근거: 기존 브라우저 회귀 재사용
- 제외/제약: 실제 커넥터·웹캠 실증·개발 완료 판정 제외

### 완료 체크리스트

- [ ] 모든 경험의 시작/성공/거절/취소/재진입을 desktop/mobile에서 확인
- [ ] 막힌 경로·missing 시각 항목은 해소 또는 표시된 허용 fallback
- [ ] 제품 경험 검토 결과와 합의된 변경을 기록하고 미결정 핵심 경험 0건

### 검증과 인계

- 검증: npm run check 및 관련 browser 회귀; URL/SHA/모드/기기 조건 첨부
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## I-01 — 모든 공유 상태 변경의 권한 검증·원자 커밋

에픽: S2-E3 · 선행: P-07

계약: C03, C04, C05, C06 · 방향 v2 절: 6, 8, 12

### 범위와 인터페이스

- 입력: WorldCommand·Signed·현재 world version
- 출력: C03 executeCommand/CommandResult와 영속 중복 방지
- 대상 경로: `app/worker/core/commands.ts`, `app/worker/core/world-runtime.ts`, `app/worker/world-do.ts`, `app/worker/core/a2a.ts`, `app/src/identity/envelope.ts`, `app/scripts/command-runtime.test.mjs`
- 재사용 근거: #17/#20/#22 기반 재사용
- 제외/제약: 관련 없는 기능·운영 범위 확대

### 완료 체크리스트

- [ ] 정상 NPC 인사/거래도 카드·위임을 부작용 전에 검증
- [ ] 중복 명령 재보상 0, 다른 payload 같은 ID는 conflict, stale version은 거부
- [ ] 모델 await 중 철회/변경 시 늦은 답은 정산만 하고 커밋하지 않음
- [ ] 승인 누락/다른 hash/만료·잘못된 수신자는 상태 불변

### 검증과 인계

- 검증: node --test scripts/command-runtime.test.mjs scripts/a2a.test.mjs scripts/world-runtime.test.mjs; npm run check
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## I-02 — 클레임·웹캠 맞이·주인 철회 실제 구현

에픽: S2-E3 · 선행: I-01

계약: C04, C05, C06, C12 · 방향 v2 절: 6, 7, 16, 17

### 범위와 인터페이스

- 입력: 주인 계정 claim·3개 challenge 원본 프레임·현재 위임
- 출력: claim/ritual 판정·별도 주인 철회 경로·권한 상태 UI
- 대상 경로: `app/worker/core/threads.ts`, `app/worker/core/trust.ts`, `app/worker/index.ts`, `app/src/ui/identity.ts`, `app/scripts/identity-flow.test.mjs`, `app/worker/core/owner-api.ts`
- 재사용 근거: #13/#15/#20 claim/keys, #29 실제 ritual 진행 PR을 검토·재사용; 기존 judge=owner와 제어권은 분리
- 제외/제약: 일반 사용자 OAuth 앱 검수는 G-01; 주인 실제 동작 checkpoint 필요

### 완료 체크리스트

- [ ] 본인 실제 Threads 계정/지문·permalink·기계/시각 확인 구분
- [ ] 실제 웹캠 3개 동작의 성공/잘못 수행/권한 거부를 실증; 원본 저장/본문 로그/캐시 없음
- [ ] 철회 후 대기 Task 종료·공개 활동 중단, 제품 경로가 자동 재위임하지 않음
- [ ] 새 방문자는 타인의 claim/ritual replay로 권한 얻지 못함
- [ ] 주인/agent bearer/judge 권한 분리와 두 demo principal의 독립 세션·교차 승인/철회 거부 확인

### 검증과 인계

- 검증: identity/threads/proxy 회귀 + 실제 계정/웹캠 기록(판정/requestId만)
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## I-03A — MCP transport·자격·도구 스키마와 어댑터

에픽: S2-E3 · 선행: I-01

계약: C03, C04, C06, C12 · 방향 v2 절: 7, 12, 20

### 범위와 인터페이스

- 입력: 실행자 bearer 자격, 방향 v2 7.2 전체 tool 목록
- 출력: 공개 HTTPS MCP endpoint·정확한 JSON schemas·쓰기 adapter
- 대상 경로: `app/worker/core/tasks.ts`, `app/worker/core/commands.ts`, `app/worker/index.ts`, `app/wrangler.jsonc`, `app/docs/MCP_TOOLS.md`, `app/scripts/mcp.test.mjs`, `app/worker/core/mcp-server.ts`, `app/worker/core/mcp-tools.ts`, `app/worker/core/connected.ts`, `app/worker/core/agent-keys.ts`
- 재사용 근거: #26 병합 MCP/agent-keys/인박스 기반을 재사용하고 차이만 보완
- 제외/제약: 완전한 도구 작동 완료는 I-03B; 기능 backend 소유권은 I-07/I-13

### 완료 체크리스트

- [ ] 공식 현행 MCP transport 계약을 확인하고 협상/초기화/오류/인증 시험
- [ ] 모든 tool 이름과 schema·읽기 접근권·자격 회전/철회 정의
- [ ] 미구현 backend는 capability_not_ready로 거부, 성공으로 응답하지 않음
- [ ] /mcp는 정적 HTML이 아닌 Worker 라우트이며 키가 채팅 본문/로그에 노출되지 않음

### 검증과 인계

- 검증: node --test scripts/mcp.test.mjs + 실제 HTTPS initialize/tools/list 인증/철회 smoke
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## I-03B — MCP 전체 도구와 에이전트 인박스 통합

에픽: S2-E3 · 선행: I-03A, I-07, I-08, I-13, I-02

계약: C03, C04, C06, C07 · 방향 v2 절: 7, 12, 13

### 범위와 인터페이스

- 입력: 완료된 Task/아이템/위치 backend와 I-03A schemas
- 출력: 모든 7.2 tools의 실제 결과·인박스 응답/기한
- 대상 경로: `app/worker/core/tasks.ts`, `app/docs/MCP_TOOLS.md`, `app/scripts/mcp.test.mjs`, `app/worker/core/mcp-server.ts`, `app/worker/core/mcp-tools.ts`, `app/worker/core/connected.ts`, `app/worker/core/agent-keys.ts`
- 재사용 근거: #26 병합 MCP/agent-keys/인박스 기반을 재사용하고 차이만 보완
- 제외/제약: Muse 계정의 실제 호출자는 I-04

### 완료 체크리스트

- [ ] 7.2 전체 및 invite_campfire/propose_help/answer_help에 성공/거부/기한/중복 실행 시험 연결
- [ ] heartbeat_check로 거래·역제안·만남 후보·수신 메시지·기한 조회
- [ ] pending claim·철회 자격·타 에이전트 ID 위조·범위 밖 쓰기는 부작용 없이 거부

### 검증과 인계

- 검증: mcp 회귀 + 실제 HTTPS 도구별 smoke 기록
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## I-04 — 본인 Muse 커넥터의 실제 상호작용 실증

에픽: S2-E3 · 선행: I-02, I-03B

계약: C04, C06, C12 · 방향 v2 절: 7, 8, 12, 17

### 범위와 인터페이스

- 입력: 주인 Muse 계정·보안 자격 입력·HTTPS MCP
- 출력: 실제 Muse tool call→world event의 상관 증거
- 대상 경로: `app/docs/CONNECTOR_VERIFICATION.md`, `app/docs/MCP_TOOLS.md`
- 재사용 근거: I-03B 도구 검증 재사용
- 제외/제약: 공개 디렉터리 승인·사용자 전체 지원·미응답 성공 추정 제외

### 완료 체크리스트

- [ ] 읽기→이동/인사→거래 제안→인박스 응답 조회→수락/거절→세계 결과를 본인 Muse가 수행
- [ ] actorOrigin connected와 server_custodial 서명 표시, 시스템 Spark 대행과 구분
- [ ] 예약/무인 호출/쓰기 승인 대기를 실제 계정에서 별도 확인; 미지원은 수동 대안과 한계 기록
- [ ] 자격 철회 뒤 호출 거부와 공개 상태 불변 확인

### 검증과 인계

- 검증: 계정 UI/tool receipt·commandId/eventId·상태 전후 기록(비밀값 제거)
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## I-05 — 세계 하트비트·4자유도·실제 상대 응답

에픽: S2-E4 · 선행: I-01

계약: C03, C05, C09 · 방향 v2 절: 7, 8

### 범위와 인터페이스

- 입력: 현재 world state/seed·공개 wants/memory·모델 Decision
- 출력: 검증된 순환 spotlight와 실제 encounter 응답·성찰
- 대상 경로: `app/src/engine/world.ts`, `app/src/engine/harness.ts`, `app/worker/core/world-runtime.ts`, `app/worker/core/actions.ts`, `app/scripts/engine.test.mjs`, `app/scripts/world-runtime.test.mjs`
- 재사용 근거: #17/#21/#22 재사용
- 제외/제약: 관련 없는 기능·운영 범위 확대

### 완료 체크리스트

- [ ] 10종 순환·현지 시간 자유도·방문자 우선·시나리오 폴백 재현
- [ ] 상대 응답도 live/replay 근거 기록; 규칙 응답을 live로 표시하지 않음
- [ ] 60초/8초·동시 2호출·턴 상한·예산 예약/정산 준수
- [ ] invalid output/await 중 철회/알람 중복에 상태 일관

### 검증과 인계

- 검증: engine/world-runtime/proxy 회귀 + 두 heartbeat 실서비스 event 상관 확인
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## I-06 — 전체 아이템 효과·보상·제작·만료·이력

에픽: S2-E4 · 선행: I-01

계약: C03, C07 · 방향 v2 절: 9, 11

### 범위와 인터페이스

- 입력: P-01 전체 ItemSpec/장소 표·인벤토리/시간/ledger
- 출력: 각 item의 effectRule·명시적 만료/소모·보상/이력
- 대상 경로: `app/src/engine/items.ts`, `app/src/engine/rules.ts`, `app/src/engine/places.ts`, `app/scripts/items.test.mjs`, `app/docs/EXPERIENCE_MATRIX.md`
- 재사용 근거: #18 구현 재사용
- 제외/제약: 관련 없는 기능·운영 범위 확대

### 완료 체크리스트

- [ ] 모든 카탈로그 ID의 데이터/능력효과/시각 상태/테스트 대응
- [ ] 하루 10회·장소 1회·쌍 거래 1회·100m·2역제안 경계값 시험
- [ ] Transit 3정류장·24h 만료·씨앗 소모·영구 스탬프 보존
- [ ] 비양도 유물·반복 호기심 보상 0·무효 교환·이력 위변조 거부

### 검증과 인계

- 검증: node --test scripts/items.test.mjs scripts/engine.test.mjs; 카탈로그 coverage 검사
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## I-07 — 거래·봉인 조율·양쪽 주인 인박스 승인

에픽: S2-E4 · 선행: I-03A, I-05, I-06, I-02

계약: C03, C04, C05, C06 · 방향 v2 절: 7, 12

### 범위와 인터페이스

- 입력: TaskRecord·공개 신호·local accept/reject·주인 approval
- 출력: 거래/만남 Task 상태 기계와 영수증/Meetup Ember
- 대상 경로: `app/worker/core/tasks.ts`, `app/worker/core/commands.ts`, `app/worker/index.ts`, `app/src/ui/owner-inbox.ts`, `app/scripts/tasks.test.mjs`, `app/src/engine/inbox.ts`
- 재사용 근거: #20 서명 검증·기존 proposal fixture 참고
- 제외/제약: 실제 외부 초대·예약·결제 금지

### 완료 체크리스트

- [ ] trade 최초 응답+역제안≤2·잠금·원자 교환·중복 수락 보상 1회
- [ ] 후보≤5·사적 조건 로컬 유지·동일 revision/hash 양쪽 승인만 확정
- [ ] 한쪽 거절·기한 만료·철회·후보 변경 시 확정/보상 없음
- [ ] 에이전트 인박스와 주인 3종 알림 분리; 이유 원문은 입력/네트워크/로그 0건
- [ ] 기존 #26 Task/인박스/키 데이터를 보존하는 버전 migration·재시작 멱등성 확인

### 검증과 인계

- 검증: tasks/identity/proxy 회귀 + 2주인 독립 세션 E2E·network redaction fixture 검사
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## I-08 — 주인 목적지·Muse 현재 셀·이동·인증 순간이동

에픽: S2-E4 · 선행: I-05, I-06

계약: C03, C07 · 방향 v2 절: 11, 13

### 범위와 인터페이스

- 입력: 가상 위치 프리셋/주인 목적지·현재 Muse 셀/아이템
- 출력: 검증된 travel/ETA·버스·토큰 소비 순간이동
- 대상 경로: `app/src/engine/world.ts`, `app/src/engine/places.ts`, `app/src/ui/world-panel.ts`, `app/scripts/location.test.mjs`, `app/src/engine/location.ts`, `app/src/engine/travel.ts`, `app/worker/core/owner-api.ts`
- 재사용 근거: #26 location/travel/connectedRoutes를 보완하며 중복 엔진 금지
- 제외/제약: 실제 GPS 인증·기기 GPS 위조·새 베이 3D 공간 제외

### 완료 체크리스트

- [ ] 주인 위치 변경이 Muse 현재 셀을 즉시 바꾸지 않음
- [ ] 걷기/버스 도착 전 대상 장소 발견·근접 거래 불가
- [ ] 동네 인증+Taxi Token만 순간이동; 재전송 소비 1회
- [ ] HQ/베이 7곳 프리셋·가상 위치 상시 표시·GPS 권한 거부 흐름

### 검증과 인계

- 검증: location/items/engine 회귀 + UI에서 이동/도착/인증 상태 확인
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## I-09 — 실제 세계와 3D 행동·소품·대화 투영 연결

에픽: S2-E4 · 선행: I-05, I-06, I-07, I-08, I-13

계약: C02, C03, C08, C11 · 방향 v2 절: 8, 10, 11, 14

### 범위와 인터페이스

- 입력: world snapshot/event·ActionSpec·동일 Muse ID
- 출력: 라이브 장면 투영·LOD/소품/상대 동기화
- 대상 경로: `app/src/ui/live-scene.ts`, `app/src/main.ts`, `app/src/scene.ts`, `app/src/character-kit/MuseActor.ts`, `app/scripts/actions.browser.js`
- 재사용 근거: #2/#16/#23/#25 재사용
- 제외/제약: 완성하지 못한 clip은 명시된 fallback 허용

### 완료 체크리스트

- [ ] 지도 표식과 3D Muse ID/소유자/인벤토리·버전 일치
- [ ] sit/talk 블렌드·장착/전달·상대 접촉·4효과와 대체 표현 표
- [ ] rig/hash/Validator/LOD/지지발/가구 관통·접촉 기준 통과
- [ ] 재접속/액터 로컬 애니메이션 seek/LOD 전환에 액션 위상/정체성 유지

### 검증과 인계

- 검증: character/actions 회귀·actions.browser.js + live event→scene browser assertion
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## I-13 — 엽서·선물·모닥불 초대·도움 요청 소통

에픽: S2-E4 · 선행: I-03A, I-05, I-06, I-07, I-08

계약: C03, C06, C07 · 방향 v2 절: 9, 12

### 범위와 인터페이스

- 입력: 인벤토리/수신자/거리/Task·서버 시간
- 출력: 지연 메시지·선물 기록·모임·help 결과/성찰
- 대상 경로: `app/worker/core/tasks.ts`, `app/worker/core/messages.ts`, `app/src/engine/rules.ts`, `app/scripts/messages.test.mjs`
- 재사용 근거: 기존 items/rules/beat 재사용
- 제외/제약: 관련 없는 기능·운영 범위 확대

### 완료 체크리스트

- [ ] 엽서 거리 기반 60초~2시간 배달·우표 소모·수신 확인·중복 소비 방지
- [ ] 선물·엽서 각각 Muse당 일 3회·비양도 금지, Invite Token 모임·3명 highlight
- [ ] help submitted→input-required→completed/거절/만료·수리 결과/성찰 기록
- [ ] 각 소통의 서명/범위/기한·철회 검증 및 인박스 연결
- [ ] 연결된 Muse가 MCP invite_campfire/propose_help/answer_help로 실제 backend를 호출하고 상태 반영

### 검증과 인계

- 검증: messages/tasks/items 회귀 + 실제 이벤트 인박스 배달 확인
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## I-10 — 버전 포함 실행 원기록·하이라이트·자율성 집계

에픽: S2-E5 · 선행: I-01, I-05

계약: C03, C08, C09 · 방향 v2 절: 2, 8

### 범위와 인터페이스

- 입력: RunRecord·입력/이벤트 순서·source/actorOrigin
- 출력: append-only 원기록·highlight filter·6항목 집계
- 대상 경로: `app/worker/core/run-log.ts`, `app/worker/core/world-runtime.ts`, `app/src/ui/world-panel.ts`, `app/scripts/run-log.test.mjs`
- 재사용 근거: #17/#20/#25 로그/패널 재사용
- 제외/제약: 관련 없는 기능·운영 범위 확대

### 완료 체크리스트

- [ ] 버전/시드/초기 스냅샷/모델 출력/승인 순서 보존; 원본 프레임·사적 조건 제외
- [ ] 중복 eventId 집계 안 됨·빈 분모는 미측정·requestId unique 계산
- [ ] 기간/Muse/장소/태그로 highlight→증거 열기
- [ ] 기간·표본·live/rule/scripted/replay와 actorOrigin 구분

### 검증과 인계

- 검증: run-log/world-runtime 회귀 + 표 재집계 oracle 비교
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## I-11 — 1·10·60배 읽기 전용 실행 기록 재생

에픽: S2-E5 · 선행: I-09, I-10

계약: C08, C09, C10 · 방향 v2 절: 8, 14, 16

### 범위와 인터페이스

- 입력: 버전 호환 RunRecord·시각·배속
- 출력: loadRun/seek/setSpeed와 장면/증거 투영
- 대상 경로: `app/src/replay/player.ts`, `app/src/ui/world-panel.ts`, `app/scripts/replay.test.mjs`, `app/scripts/replay.browser.js`
- 재사용 근거: 현재 replay-library는 모델 fallback 자료이며 world run과 구분
- 제외/제약: 관련 없는 기능·운영 범위 확대

### 완료 체크리스트

- [ ] 1/10/60배에서 같은 끝 상태·seek 복귀·호환 불가 오류
- [ ] player에 command/model executor 없음; 네트워크 쓰기·새 보상·live counter 증가 0
- [ ] 기록 시각/재생 속도/replay source 명시; 타인 인증으로 승격 안 됨

### 검증과 인계

- 검증: replay 단위 회귀 + browser route spy로 API 쓰기/모델 호출 0건
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## I-12 — 프록시·할당·예산·Gateway 개인정보 운영 경계

에픽: S2-E5 · 선행: I-02, I-05

계약: C04, C05, C10, C12 · 방향 v2 절: 8, 15, 16, 17

### 범위와 인터페이스

- 입력: 허용 Action·session/IP quota·예산 설정·provider/Gateway
- 출력: 실패/상한에서 정직한 replay/scenario 및 사용량
- 대상 경로: `app/worker/core/proxy.ts`, `app/worker/core/ledger.ts`, `app/worker/core/session.ts`, `app/wrangler.jsonc`, `app/scripts/proxy.test.mjs`, `app/docs/V2_VERIFICATION.md`
- 재사용 근거: #13/#15 예산/프록시 재사용
- 제외/제약: 관련 없는 기능·운영 범위 확대

### 완료 체크리스트

- [ ] Turnstile hostname·서명 세션·방문자 3회/시간·judge quota 경계
- [ ] 예산 동시 예약·타임아웃/429/5xx/malformed·late settle 일관
- [ ] 키/토큰 번들·로그 노출 0; Gateway 쓰면 challenge 본문 로그/캐시 off
- [ ] 데모 제한과 미구현 일반 사용자 24h 수습/주인 단위 제한 구분

### 검증과 인계

- 검증: proxy 회귀·dry-run + 배포 quota/budget/fallback 증거
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## D-01 — 동일 배포 빌드의 전체 사용자 경로 통합 검증

에픽: S3-E6 · 선행: I-02, I-03B, I-04, I-09, I-11, I-12

계약: C01, C04, C06, C10, C12 · 방향 v2 절: 6, 7, 8, 12, 14, 16, 20

### 범위와 인터페이스

- 입력: S2 done 이슈·release SHA/URL/deployId/configVersion
- 출력: 실제 계정·서버의 통합 경로 증거
- 대상 경로: `app/docs/RELEASE_ACCEPTANCE.md`, `app/scripts/product-e2e.browser.js`
- 재사용 근거: 각 기능 이슈 증거 재사용 가능하나 동일 build 차이 명시
- 제외/제약: 관련 없는 기능·운영 범위 확대

### 완료 체크리스트

- [ ] 관전→선택→claim/ritual→본인 Muse 연결→활동→조율/양쪽 승인→보상→철회
- [ ] 실제 connected Muse가 인박스 읽기→응답→세계 반영; trial 대행과 구분
- [ ] 성공/합의 불가/한쪽 거절/변경/만료/재접속 경로를 독립 세션에서 확인

### 검증과 인계

- 검증: npm run check + product-e2e.browser.js + 실제 Muse/웹캠 receipt
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## D-02 — P0·P1·P2와 자율성 수치의 실제 근거 확정

에픽: S3-E6 · 선행: D-01

계약: C04, C08, C09, C10 · 방향 v2 절: 2, 8, 14, 20

### 범위와 인터페이스

- 입력: 동일 배포 world/run과 control snapshot·request/event ID
- 출력: P0/P1/P2 evidence bundle와 6항목 재집계
- 대상 경로: `app/docs/RELEASE_ACCEPTANCE.md`, `app/docs/evidence/INDEX.md`, `app/scripts/proof-evidence.test.mjs`
- 재사용 근거: 없음 — 신규 계획
- 제외/제약: 관련 없는 기능·운영 범위 확대

### 완료 체크리스트

- [ ] P0 새 nonce/ID·같은 업무: 철회 전 성공/철회 사유 거부·상태 불변
- [ ] P1 초기 snapshot/seed/clock/inputs 통제·아이템만 차이, live 장면과 통제 run 구분
- [ ] P2 장면→event→실제 request 또는 서명/권한 verdict 연결
- [ ] 동일 기간 원기록으로 자율성 6항목 재집계 일치

### 검증과 인계

- 검증: proof-evidence 회귀 + 배포 기록/화면의 상관 표 전수 확인
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## D-03 — 장시간·장애·철회·비공개성 운영 검증

에픽: S3-E6 · 선행: D-01, I-11, I-12

계약: C04, C05, C08, C10, C12 · 방향 v2 절: 6, 8, 12, 15, 16, 20

### 범위와 인터페이스

- 입력: 동일 release build와 격리 fault 환경·운영 demo URL
- 출력: 4시간 이상 연속 run 및 장애/보안 증거
- 대상 경로: `app/docs/RELEASE_ACCEPTANCE.md`, `app/scripts/resilience.test.mjs`, `app/docs/evidence/INDEX.md`
- 재사용 근거: 기존 V2_VERIFICATION 결과는 build/config 차이 확인 후 재사용
- 제외/제약: 운영 방문자에게 장애 주입·전면 보안 보장 제외

### 완료 체크리스트

- [ ] DO 중복 알람·재시작·자정·동시 쓰기·철회 중 응답에서 중복/권한 우회 0
- [ ] 429/5xx/8초 timeout/예산·할당/타일 실패에서 출처 표시·세계 지속
- [ ] 키 노출·주입·이유 추출·승인 우회·철회 전파 실제 요청 기록
- [ ] 운영 demo 폴백과 격리 fault 결과 구분·replay 쓰기 0

### 검증과 인계

- 검증: resilience/world-runtime/proxy 회귀 + 4h run·운영 quota/fallback 기록
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## D-04 — 실기기·첫 방문·FPS·메모리·DPR 최종 판정

에픽: S3-E6 · 선행: D-01, I-09

계약: C10, C11 · 방향 v2 절: 10, 17, 20

### 범위와 인터페이스

- 입력: C11 수치 기준·시험 전 기기/메모리 예산 표·release build
- 출력: 실기기/에뮬레이션 별 측정·DPR 결정 기록
- 대상 경로: `app/docs/DEVICE_ACCEPTANCE.md`, `app/scripts/first-load.browser.js`, `app/scripts/world-ui.browser.js`
- 재사용 근거: #14·성능 overlay·캐릭터 킷 예산 재사용
- 제외/제약: 메모리 한도는 시험 전 기록된 결정 필요; 미정은 ready 불가

### 완료 체크리스트

- [ ] 4Mbps/150ms/no-cache 첫 장면≤8초
- [ ] 210초 desktop median≥55FPS/p95≤33ms·실기기 mobile≥30FPS/p95≤50ms
- [ ] LOD/draw/texture 예산·가로 overflow 0·필수 조작 가능
- [ ] 메모리 예산 미정/실기기 미측정은 blocked, 다른 기기 결과를 기준 기기로 주장 안 함

### 검증과 인계

- 검증: first-load/world-ui/actions browser 회귀 + 실기기 perf 측정
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## D-05 — 실제 하이라이트 기반 3분 데모 영상

에픽: S3-E7 · 선행: D-02, D-03, D-04

계약: C08, C10, C12 · 방향 v2 절: 1, 2, 14, 20

### 범위와 인터페이스

- 입력: 검증한 release/run highlights와 두 핵심 축
- 출력: 3분 shotlist·최종 영상·컷별 증거 링크
- 대상 경로: `app/docs/DEMO_SHOTLIST.md`, `app/docs/evidence/INDEX.md`
- 재사용 근거: 기존 3:30 story는 참고 연출
- 제외/제약: 프리뷰 전체를 3분으로 축소하지 않음

### 완료 체크리스트

- [ ] 고정 대본을 live로 표시하지 않고 replay/가상 위치 표기 유지
- [ ] P0/P1/P2와 문제→행동→결과가 컷별 실제 event에 대응
- [ ] 영상의 build·모델·귀속·제약이 제출 설명과 일치

### 검증과 인계

- 검증: 영상 재생/길이 확인·모든 컷 source/build/event 대조
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## D-06 — 제출 패키지·요건·귀속·심사 안내 완성

에픽: S3-E7 · 선행: D-05

계약: C10, C12 · 방향 v2 절: 2, 15, 17, 20

### 범위와 인터페이스

- 입력: 실제 공식 요건·로그인 폼·검증 빌드/영상
- 출력: 제출 준비 완료 패키지; 실제 제출/확인은 별도 실행 상태와 receipt
- 대상 경로: `README.md`, `app/README.md`, `app/docs/SUBMISSION_CHECKLIST.md`, `app/character-kit/NOTICE.md`
- 재사용 근거: V2_VERIFICATION·NOTICE 재사용
- 제외/제약: 이슈 생성 권한을 공개 전환/제출 권한으로 확대하지 않음

### 완료 체크리스트

- [ ] 공식 마감/영상/팀/공개 repo/폼 요구 재확인, 과거 문서 수치를 추정 재사용 안 함
- [ ] Muse/Jolly 귀속·코드/자산 라이선스·심사 링크/폴백/한계 명시
- [ ] 준비 완료와 실제 공개/제출/승인을 별도 필드와 receipt로 구분
- [ ] done은 제출 준비 검증 완료이며 외부 실행 권한 대기로 G-01 착수가 막히지 않음

### 검증과 인계

- 검증: 공식 페이지/폼 증거 대조·링크 검사·제출 후 receipt(실행 권한 있을 때)
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## G-01 — 일반 사용자 온보딩·인증·안전·운영 준비

에픽: S4-E8 · 선행: D-06

계약: C01, C04, C10, C12 · 방향 v2 절: 6, 7, 15, 16

### 범위와 인터페이스

- 입력: 개발 완료 release와 실제 파일럿 운영 조건
- 출력: 일반 인증/연결/복구·지원·비용·운영 게이트
- 대상 경로: `docs/roadmap/GTM_READINESS.md`, `app/docs/OPERATIONS.md`
- 재사용 근거: S2/S3 한계를 운영 요구로 전환
- 제외/제약: GTM 전체 코드 구현을 이 단일 이슈로 닫지 않음; 운영 하위 이슈 게이트 필요

### 완료 체크리스트

- [ ] 일반 OAuth/GPS·루트 키 복구·주인 단위 제한·24h 수습·대량 등록 방지 요구별 이슈 분해
- [ ] 6종 보안 실증을 일반 사용자 조건에서 재수행하고 지원/장애 대응 담당 확정
- [ ] 약관/개인정보·비용 상한·데이터 보존·사용자 삭제/철회 경로와 acceptance 정의

### 검증과 인계

- 검증: 각 운영 하위 이슈·실증 artifact·담당/온콜·비용/보존 표 대조
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## G-02 — 공개 디렉터리 요건·신청·심사·승인 추적

에픽: S4-E8 · 선행: I-04

계약: C01, C12 · 방향 v2 절: 7, 15, 17

### 범위와 인터페이스

- 입력: 실제 Muse 연결 증거·공식 directory 신청 요구
- 출력: 요건 대응표·준비/신청/심사/승인 별 상태
- 대상 경로: `docs/roadmap/GTM_READINESS.md`, `app/docs/CONNECTOR_VERIFICATION.md`
- 재사용 근거: 실제 커넥터 연동 I-04 재사용
- 제외/제약: 심사 기간/승인 추정·별도 승인 없는 외부 신청 제외

### 완료 체크리스트

- [ ] 공식 현재 요건·사업자·데이터 처리·테스트 계정 항목 확인
- [ ] 신청 권한 확보 후 제출 receipt·보완 요청·승인 날짜 분리
- [ ] directory 미승인이 S1~S3 완료를 막지 않음
- [ ] done은 요건/패키지 준비 완료, 외부 신청·심사·승인 완료와 분리하며 S3 전 조사 가능

### 검증과 인계

- 검증: 공식 출처와 실제 receipt 상태 대조
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

## G-03 — 파일럿 유입·활성화·재방문·비용 관찰

에픽: S4-E8 · 선행: G-01

계약: C01, C09, C10, C12 · 방향 v2 절: 1, 15

### 범위와 인터페이스

- 입력: 사용자 동의·운영 준비·측정 기간·모집 경로
- 출력: 획득→연결→첫 활동→재방문과 비용/지원 관찰
- 대상 경로: `docs/roadmap/GTM_READINESS.md`, `docs/roadmap/PILOT_REPORT.md`
- 재사용 근거: 기존 자율성 집계는 사용자 funnel과 구분
- 제외/제약: Gadget·과금·추가 지역은 별도 후속 결정

### 완료 체크리스트

- [ ] 모집 전 cohort/분모/기간·activation/return 정의·개인정보 최소화 기록
- [ ] 실제 참가·연결·첫 활동·재방문·실패/지원/비용 집계
- [ ] 소표본을 시장 검증으로 과장하지 않고 확대/수정/중단 근거 기록

### 검증과 인계

- 검증: 원집계 대조·동의/운영 증거·확장 결정 기록
- 증거: C10 형식으로 이슈에 첨부한다. 실패는 해당 상태/원인/해제 조건을 남기고 다음 단계 완료로 표시하지 않는다.
- 인계: 위 출력 계약과 해당 경험 행/공통 계약을 함께 갱신한 후 dependent 태스크를 ready로 전환한다.

