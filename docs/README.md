# Musely 문서 안내

진행 단계는 **프리뷰 → 구현 → 데모(개발 완료) → GTM**이다. 단계별 목적·범위·완료 게이트와 에픽·태스크은 [4단계 로드맵](roadmap/2026-11-01-four-stage-roadmap.md)을 먼저 읽는다. 이 단계 구분은 기존 방향 v2의 “2단계” 및 “프리뷰 데모” 혼합 표현보다 우선한다.

제품 세부 요구사항은 `musely-direction-v2-2026-11-01.md`가 기준이다. 아래 기존 기획/상태표에는 과거 구현 시점과 단계 표현이 남아 있다. 현재 구현 여부는 소스·PR·검증 기록으로 확인하고, 해당 표를 최신 완료 판정으로 사용하지 않는다. 프리뷰의 실제 커넥터 연동은 완료 조건이 아니며, 실제 연동 구현은 S2, 통합 증명은 S3에서 수행한다.

[실행 이슈 인덱스: 에픽 8개·태스크 30개](roadmap/github-issues.md) · [실행 인계](handoffs/2026-11-01-four-stage-issues-handoff.md)

[합의 출처·수용/변경·선행 구현과 남은 검증](roadmap/decision-alignment.md)을 함께 확인한다. 최신 진행은 로드맵 §2.1의 **P-07 통과 후 S2·S3 연속 진행**이다. 예전 인계의 S1 후 중지는 대체됐다. 제출 실행과 공개 전환은 별도 권한·receipt로 추적한다.

## 실행할 때 읽는 순서

1. 단계와 범위: [4단계 로드맵](roadmap/2026-11-01-four-stage-roadmap.md)
2. 공유 입출력·권한·오류·검증: [실행 공통 계약](roadmap/execution-contract.md)
3. 해당 태스크의 범위·경로·체크리스트: [태스크 실행 명세](roadmap/task-execution.md)
4. 이슈에 고정된 커밋 SHA·줄 참조의 제품 원 요구사항

과거 기획/PRD는 참고 기록이며 활성 계약과 충돌하면 활성 계약을 따른다. 최신 상태는 구현 PR과 배포/계정/기기 증거를 분리해 확인한다.

## 흐름

| 시점 | 내용 | 근거 |
|---|---|---|
| 10월 30일 | 기획안·개발계획·PRD·아트 디렉션 작성. 고정 직교 디오라마, 서명 신원(문장), 봉인 조율, 불씨·온도, Docker 서버 스택, POC→마일스톤 M0~M8 | 이 폴더의 `museion-*-2026-10-30.md` 원본 |
| 10월 31일 | 기술보다 데모(비주얼 프리뷰)를 먼저 만들기로 하고, 실제 지도 위 장면으로 전환. 3분 30초 대본 스토리(인사 → 정원 → 만남 조율 → 주인 확인 → 모닥불), Cloudflare Workers 배포. Jolly는 Meta 귀속으로 정리 | `preview/README.md`, `preview/docs/SCENARIO.md`, PR #1 |
| 10월 31일~11월 1일 | 리그 캐릭터 킷: Jolly 기본형 + 9종 확장, 10종 뷰어. 주민 8명이 킷으로 움직임. 공원을 실제 도로 격자에 맞춤 | `preview/docs/characters/`, PR #2, PR #4 |

## 기존 프리뷰 구현 요약 (초기 기록, 최신 상태 아님)

- **무대**: MapLibre 실제 지도 위에 Three.js 장면을 같은 캔버스로 얹는다. 베이 전경에서 본사 남동쪽 공원까지 연속 줌하며, 8초 안에 공원에 도착한다. 공원에는 카페, 모닥불과 벤치, 정원, 랜턴이 있다.
- **캐릭터**: 리그 Muse 10종 — Jolly(기본형), Sunny(Host), Moss(Gardener), Ripple(Explorer), Ember(Storykeeper), Bloom(Listener), Ink(Reader), Tempo(Music Friend), Orbit(Stargazer), Copper(Maker). 공용 액션 12개와 각자의 고유 액션, 표정 8종, LOD 3단계. 세계 주민 8명이 이 중 8종을 입는다.
- **스토리**: 대본 대화와 행동. 만남 조율은 다섯 후보에 이유 없이 수락/거부하고 주인이 확인하는 흐름을 보여준다. 실제 에이전트·모델 호출·외부 전송은 없다.
- **트랙**: Startup, 테마 Push the Frontier (기획안 9장).
- **배포·검증**: Cloudflare Workers가 `main`을 자동 배포. `npm run check`(Node 테스트 45개, 타입체크, 빌드), 브라우저 회귀 스크립트, glTF Validator.

## 과거 문서의 기록 범위 (현행 실행 명세 아님)

| 문서 | 상태 |
|---|---|
| `museion-plan-final-2026-10-30.md` 기획안 | 캐릭터 선택(10종), 무대·관전(지도 위 공원), 데모와 프리뷰의 관계를 현재 구현으로 고침. 중고거래 중심 서술을 이웃 간 만남 조율 일반으로 정리하고, 중고거래 수치는 근거로만 남김. 당시 신원·조율·불씨·온도 설계를 기록한다. 현행 신원·조율과 Meetup/Commons Ember는 방향 v2를 따르고 온도 파생은 활성 요구가 아님 |
| `museion-dev-plan-2026-10-30.md` 개발계획 | 기술 스택, 그래픽, 클라이언트 구조, 에셋 파이프라인, 저장소 구조, 검증을 현재 구현으로 다시 씀. 서버·에이전트(1.1, 4~7장)는 당시 제안이며 현행 Worker/DO 계약의 다음 단계로 자동 채택하지 않음 |
| `museion-prd-2026-10-30.md` PRD | 마일스톤별 현재 상태(2.1)를 추가하고 M2를 구현된 지도 위 공원·캐릭터 킷 기준으로 다시 씀 |
| `museion-art-direction-2026-10-30.md` 아트 디렉션 | 팔레트·원칙 유지. 캐릭터 형태, 밤 조명, 폰트, 스타일 프레임을 현재 구현으로 고침 |
| `research/` | 해커톤 평가 기준, A2A 신원·하네스 조사. 참고 자료 |

## 문서 목록

- **단계·완료 게이트(최신 구분)**: `roadmap/2026-11-01-four-stage-roadmap.md` — 4단계와 에픽·태스크
- **제품 세부 방향**: `musely-direction-v2-2026-11-01.md` — 신원·위임(#7)과 프리뷰 데모 v2(#8)를 수용한 제품 세부 기준; 단계 배정은 로드맵을 따름
- 회의록: `meetings/2026-11-01-sync-call.md`
- 기획: `museion-plan-final-2026-10-30.md`, `museion-dev-plan-2026-10-30.md`, `museion-prd-2026-10-30.md`, `museion-art-direction-2026-10-30.md`
- 리서치: `research/a2a-identity-harness-report-2026-11-01.md`, `research/a2a-sources-consolidated-2026-11-01.md`
- 구현 문서: `../preview/README.md`, `../preview/docs/` (시나리오, 진입 검토, 배포, 캐릭터 킷 설계·결과)
