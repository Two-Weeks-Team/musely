# Musely 문서 안내

기준은 **현재 구현(`preview/`, preview.musely.net)**이다. 데모 단계의 방향은 `musely-direction-v2-2026-11-01.md`가 기준이며, 아래 기획 문서보다 우선한다. 아래 기획 문서들은 2026-10-30에 쓴 기획(파일명 날짜)을 바탕으로, 2026-11-01 구현 상태에 맞춰 방향을 고쳤다. 각 문서 첫머리의 상태 줄에 무엇을 고쳤는지 적었다.

## 흐름

| 시점 | 내용 | 근거 |
|---|---|---|
| 10월 30일 | 기획안·개발계획·PRD·아트 디렉션 작성. 고정 직교 디오라마, 서명 신원(문장), 봉인 조율, 불씨·온도, Docker 서버 스택, POC→마일스톤 M0~M8 | 이 폴더의 `museion-*-2026-10-30.md` 원본 |
| 10월 31일 | 기술보다 데모(비주얼 프리뷰)를 먼저 만들기로 하고, 실제 지도 위 장면으로 전환. 3분 30초 대본 스토리(인사 → 정원 → 만남 조율 → 주인 확인 → 모닥불), Cloudflare Workers 배포. Jolly는 Meta 귀속으로 정리 | `preview/README.md`, `preview/docs/SCENARIO.md`, PR #1 |
| 10월 31일~11월 1일 | 리그 캐릭터 킷: Jolly 기본형 + 9종 확장, 10종 뷰어. 주민 8명이 킷으로 움직임. 공원을 실제 도로 격자에 맞춤 | `preview/docs/characters/`, PR #2, PR #4 |

## 현재 구현 요약

- **무대**: MapLibre 실제 지도 위에 Three.js 장면을 같은 캔버스로 얹는다. 베이 전경에서 본사 남동쪽 공원까지 연속 줌하며, 8초 안에 공원에 도착한다. 공원에는 카페, 모닥불과 벤치, 정원, 랜턴이 있다.
- **캐릭터**: 리그 Muse 10종 — Jolly(기본형), Sunny(Host), Moss(Gardener), Ripple(Explorer), Ember(Storykeeper), Bloom(Listener), Ink(Reader), Tempo(Music Friend), Orbit(Stargazer), Copper(Maker). 공용 액션 12개와 각자의 고유 액션, 표정 8종, LOD 3단계. 세계 주민 8명이 이 중 8종을 입는다.
- **스토리**: 대본 대화와 행동. 만남 조율은 다섯 후보에 이유 없이 수락/거부하고 주인이 확인하는 흐름을 보여준다. 실제 에이전트·모델 호출·외부 전송은 없다.
- **트랙**: Startup, 테마 Push the Frontier (기획안 9장).
- **배포·검증**: Cloudflare Workers가 `main`을 자동 배포. `npm run check`(Node 테스트 45개, 타입체크, 빌드), 브라우저 회귀 스크립트, glTF Validator.

## 문서별 상태

| 문서 | 상태 |
|---|---|
| `museion-plan-final-2026-10-30.md` 기획안 | 캐릭터 선택(10종), 무대·관전(지도 위 공원), 데모와 프리뷰의 관계를 현재 구현으로 고침. 중고거래 중심 서술을 이웃 간 만남 조율 일반으로 정리하고, 중고거래 수치는 근거로만 남김. 신원·조율·불씨·온도 메커니즘은 다음 단계 |
| `museion-dev-plan-2026-10-30.md` 개발계획 | 기술 스택, 그래픽, 클라이언트 구조, 에셋 파이프라인, 저장소 구조, 검증을 현재 구현으로 다시 씀. 서버·에이전트(1.1, 4~7장)는 다음 단계 계획 |
| `museion-prd-2026-10-30.md` PRD | 마일스톤별 현재 상태(2.1)를 추가하고 M2를 구현된 지도 위 공원·캐릭터 킷 기준으로 다시 씀 |
| `museion-art-direction-2026-10-30.md` 아트 디렉션 | 팔레트·원칙 유지. 캐릭터 형태, 밤 조명, 폰트, 스타일 프레임을 현재 구현으로 고침 |
| `research/` | 해커톤 평가 기준, A2A 신원·하네스 조사. 참고 자료 |

## 문서 목록

- **방향 확정(최신 기준)**: `musely-direction-v2-2026-11-01.md` — 신원·위임(#7)과 프리뷰 데모 v2(#8)를 수용한 데모 단계 기준
- 회의록: `meetings/2026-11-01-sync-call.md`
- 기획: `museion-plan-final-2026-10-30.md`, `museion-dev-plan-2026-10-30.md`, `museion-prd-2026-10-30.md`, `museion-art-direction-2026-10-30.md`
- 리서치: `research/a2a-identity-harness-report-2026-11-01.md`, `research/a2a-sources-consolidated-2026-11-01.md`
- 구현 문서: `../preview/README.md`, `../preview/docs/` (시나리오, 진입 검토, 배포, 캐릭터 킷 설계·결과)
