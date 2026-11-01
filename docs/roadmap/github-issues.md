# Musely 실행 이슈 인덱스

문서 PR: [#31](https://github.com/Two-Weeks-Team/musely/pull/31) (등록 시점 draft, 미병합). 이슈의 계약은 공개된 커밋 `9d5332a365460f9b6d1a1da8cf2aaa74f26ecf63`와 줄 범위에 고정되어 있다. 본문 링크는 후속 문서 개정으로 바뀌지 않는다.

8개 에픽·30개 태스크가 등록됐다. 등록/검토 완료는 제품 구현 완료가 아니다. **첫 작업은 P-01 #40, S1 완료 게이트는 P-07 #46**이다. S2는 #46 통과 후 기존 구현을 재사용해 진행한다. S2 에픽 전체를 직렬 선행으로 묶지 말고 태스크별 선행을 따른다.

## 에픽

| 단계 | 에픽 |
|---|---|
| S1 | [S1-E1 #32](https://github.com/Two-Weeks-Team/musely/issues/32) |
| S1 | [S1-E2 #33](https://github.com/Two-Weeks-Team/musely/issues/33) |
| S2 | [S2-E3 #34](https://github.com/Two-Weeks-Team/musely/issues/34) |
| S2 | [S2-E4 #35](https://github.com/Two-Weeks-Team/musely/issues/35) |
| S2 | [S2-E5 #36](https://github.com/Two-Weeks-Team/musely/issues/36) |
| S3 | [S3-E6 #37](https://github.com/Two-Weeks-Team/musely/issues/37) |
| S3 | [S3-E7 #38](https://github.com/Two-Weeks-Team/musely/issues/38) |
| S4 | [S4-E8 #39](https://github.com/Two-Weeks-Team/musely/issues/39) |

## 태스크와 선행 이슈

| 태스크 | 이슈 | 선행 |
|---|---|---|
| P-01 전체 경험·카탈로그·상태 대응표 확정 | [#40](https://github.com/Two-Weeks-Team/musely/issues/40) | 없음 |
| P-02 관전·체험·내 Muse 연결 진입과 하네스 선택 | [#41](https://github.com/Two-Weeks-Team/musely/issues/41) | #40 |
| P-03 신원·보상·조율·주인 개입의 상태별 프리뷰 | [#42](https://github.com/Two-Weeks-Team/musely/issues/42) | #40 |
| P-04 프리뷰 경험과 구현 요구사항·수용 기준 고정 | [#43](https://github.com/Two-Weeks-Team/musely/issues/43) | #40, #41, #42 |
| P-05 지도부터 근경까지 하나로 이어지는 프리뷰 경험 | [#44](https://github.com/Two-Weeks-Team/musely/issues/44) | #41, #42 |
| P-06 출처·위치·하이라이트·재생·증거 UI 완성 | [#45](https://github.com/Two-Weeks-Team/musely/issues/45) | #44 |
| P-07 프리뷰 전체 워크스루와 S1 완료 게이트 | [#46](https://github.com/Two-Weeks-Team/musely/issues/46) | #43, #44, #45 |
| I-01 모든 공유 상태 변경의 권한 검증·원자 커밋 | [#47](https://github.com/Two-Weeks-Team/musely/issues/47) | #46 |
| I-02 클레임·웹캠 맞이·주인 철회 실제 구현 | [#48](https://github.com/Two-Weeks-Team/musely/issues/48) | #47 |
| I-03A MCP transport·자격·도구 스키마와 어댑터 | [#49](https://github.com/Two-Weeks-Team/musely/issues/49) | #47 |
| I-03B MCP 전체 도구와 에이전트 인박스 통합 | [#50](https://github.com/Two-Weeks-Team/musely/issues/50) | #49, #54, #55, #57, #48 |
| I-04 본인 Muse 커넥터의 실제 상호작용 실증 | [#51](https://github.com/Two-Weeks-Team/musely/issues/51) | #48, #50 |
| I-05 세계 하트비트·4자유도·실제 상대 응답 | [#52](https://github.com/Two-Weeks-Team/musely/issues/52) | #47 |
| I-06 전체 아이템 효과·보상·제작·만료·이력 | [#53](https://github.com/Two-Weeks-Team/musely/issues/53) | #47 |
| I-07 거래·봉인 조율·양쪽 주인 인박스 승인 | [#54](https://github.com/Two-Weeks-Team/musely/issues/54) | #49, #52, #53, #48 |
| I-08 주인 목적지·Muse 현재 셀·이동·인증 순간이동 | [#55](https://github.com/Two-Weeks-Team/musely/issues/55) | #52, #53 |
| I-09 실제 세계와 3D 행동·소품·대화 투영 연결 | [#56](https://github.com/Two-Weeks-Team/musely/issues/56) | #52, #53, #54, #55, #57 |
| I-13 엽서·선물·모닥불 초대·도움 요청 소통 | [#57](https://github.com/Two-Weeks-Team/musely/issues/57) | #49, #52, #53, #54, #55 |
| I-10 버전 포함 실행 원기록·하이라이트·자율성 집계 | [#58](https://github.com/Two-Weeks-Team/musely/issues/58) | #47, #52 |
| I-11 1·10·60배 읽기 전용 실행 기록 재생 | [#59](https://github.com/Two-Weeks-Team/musely/issues/59) | #56, #58 |
| I-12 프록시·할당·예산·Gateway 개인정보 운영 경계 | [#60](https://github.com/Two-Weeks-Team/musely/issues/60) | #48, #52 |
| D-01 동일 배포 빌드의 전체 사용자 경로 통합 검증 | [#61](https://github.com/Two-Weeks-Team/musely/issues/61) | #48, #50, #51, #56, #59, #60 |
| D-02 P0·P1·P2와 자율성 수치의 실제 근거 확정 | [#62](https://github.com/Two-Weeks-Team/musely/issues/62) | #61 |
| D-03 장시간·장애·철회·비공개성 운영 검증 | [#63](https://github.com/Two-Weeks-Team/musely/issues/63) | #61, #59, #60 |
| D-04 실기기·첫 방문·FPS·메모리·DPR 최종 판정 | [#64](https://github.com/Two-Weeks-Team/musely/issues/64) | #61, #56 |
| D-05 실제 하이라이트 기반 3분 데모 영상 | [#65](https://github.com/Two-Weeks-Team/musely/issues/65) | #62, #63, #64 |
| D-06 제출 패키지·요건·귀속·심사 안내 완성 | [#66](https://github.com/Two-Weeks-Team/musely/issues/66) | #65 |
| G-01 일반 사용자 온보딩·인증·안전·운영 준비 | [#67](https://github.com/Two-Weeks-Team/musely/issues/67) | #66 |
| G-02 공개 디렉터리 요건·신청·심사·승인 추적 | [#68](https://github.com/Two-Weeks-Team/musely/issues/68) | #51 |
| G-03 파일럿 유입·활성화·재방문·비용 관찰 | [#69](https://github.com/Two-Weeks-Team/musely/issues/69) | #67 |

## 검증

- 등록된 38개 본문을 GitHub에서 다시 읽어 생성된 최종 본문과 동일함을 확인했다.
- 261개 문서 참조의 커밋·줄 범위를 원문과 대조했다. 에픽별 자식·태스크별 선행 이슈 번호가 해소됐음을 확인했다.
- `python3 scripts/validate-roadmap.py`: 태스크 DAG·S1 게이트·계약/원 요구 절·링크 검사 통과.
- 지정된 읽기 전용 검토 탭은 게시 전 차단점 없음, 38개 본문/261개 링크 오류 0건을 보고했다.
- 운영 배포·실계정·실기기·제품 구현 완료는 이번 계획 작업의 검증 결과가 아니다.
