# Blender 작업 지시 — Museion 카페 디오라마 렌더

## 방법
이 Mac의 Blender 5.2에 blender_mcp 애드온(`~/Library/Application Support/Blender/5.2/scripts/addons/blender_mcp.py`)이 설치돼 있다. Blender를 실행하고 애드온을 활성화해 MCP 서버(기본 포트 9876)를 시작한 뒤, MCP 클라이언트(Claude Code/Codex — 서버 미등록 시 `uvx blender-mcp` 로 등록)로 연결해 장면을 구축한다. MCP 연결이 끝내 안 되면 Blender 백그라운드 실행(`blender -b -P 스크립트`)으로 대체한다. 어느 쪽이든 결과물인 렌더 PNG가 목표다.

## 장면 스펙 (아트 디렉션 — 밤의 모닥불이 유일한 광원)
- 배경 밤색 #101623, 지면 #1B2436, 중앙 원형 광장 #2A3550, 뒤쪽 건물 실루엣 #232E47
- 중앙 모닥불이 유일한 광원: 통나무 3개, 불꽃(주황 #FF9E45 → 노랑 #FFD98A), 따뜻한 주황 포인트 라이트, 위로 오르는 불티 파티클
- 크림색 후드를 쓴 작은 아바타 2명(약 2.2등신, 둥근 몸통, 어두운 얼굴 #3A3247)이 불을 사이에 두고 마주 앉는다
- 의자 6개, 작은 카페 테이블 2개, 컵 등 소품 약간
- 카메라: 고정 3/4 직교(orthographic) 뷰, (8,9,8) 방향에서 원점을 봄. 로우폴리, 플랫한 음영
- 지배색 3개 이하(밤·크림·불), 실루엣 우선

## 출력
- 렌더 PNG 1920×1080 → `~/museion-renders/diorama-hero.png`
- .blend → `~/museion-renders/museion-cafe.blend`
- 끝나면 결과 경로, 사용한 방법(MCP/백그라운드), 발생한 문제를 요약할 것

## 후속 (이 작업이 통과하면 이어서)
- 같은 씬에서 불씨가 둘로 갈라져 두 아바타의 폰으로 들어가는 순간 스틸 1장 (`ember-split.png`)
- 콜드 오픈용 결(紋) 문양 배경과 어울리는 어두운 여백 구도 1장
