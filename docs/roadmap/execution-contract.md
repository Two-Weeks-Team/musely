# Musely 실행 공통 계약

상태: 4단계 로드맵을 이슈로 실행하기 위한 계약 v1. 제품 범위는 방향 v2, 단계·완료 기준은 4단계 로드맵, 공유 인터페이스와 검증 규칙은 이 문서가 기준이다. 과거 PRD의 M0~M8은 역사적 설계 분류이며 현행 착수 순서가 아니다. 새 요구사항을 추가하거나 범위를 줄일 때는 대응 이슈·이 문서·커버리지를 함께 수정한다.

## C01 — 단계·진행·소유권

- S1은 실제 인증/API/MCP 성공 없이도 경험을 확정할 수 있다. fixtures는 별도 시나리오 상태이며 라이브 권한·클레임·보상에 영향을 주지 않는다.
- S2는 S1 게이트 P-07 이후 본구현한다. 이전 구현은 검토·재사용하고, 외부 API/계정의 가능성 조사는 선행할 수 있다. 의존 태스크의 계약만 존재하는 것과 수용 기준이 통과한 것을 구분한다.
- S3는 S2 전체 기능별 수용 기준을 통과한 빌드의 통합 검증이다. 실패하면 담당 S2 이슈를 재개방하고 수정 빌드의 영향을 받는 S3 증거를 갱신한다.
- S4는 일반 사용자 운영 확장이다. 공개 디렉터리 승인·실제 GPS·24시간 수습·일반 OAuth·Gadget 확장을 S1~S3의 숨은 조건으로 추가하지 않는다.
- G-02의 요건 조사·신청 준비는 I-04 이후 S3 완료 전에 ready가 될 수 있는 명시적 예외다. 외부 신청/게시 권한은 이 예외가 부여하지 않는다.
- 상태는 backlog / ready / in-progress / blocked / verification / done. ready는 선행 이슈와 단계 게이트 통과, 대상 파일 소유권 확보를 뜻한다. blocked는 사유·해제 조건·다음 가능한 작업을 기록한다. 담당자는 착수 시 자신을 이슈에 지정한다. 실행 전까지 계획 조정 담당자는 @ComBba이며 코드 변경 소유권을 뜻하지 않는다.
- S2의 E3/E4/E5는 태스크별 의존성으로 교차 진행한다. E3 전체 완료를 E4 착수 조건으로 추가하면 I-04/I-03B가 E4를 기다리는 교착이 생기므로 에픽 전체를 직렬 선행으로 묶지 않는다.
- 태스크마다 하나의 검토 가능한 PR을 기본으로 하되 한 PR이 너무 커지면 동일 수용 기준 아래 순차 PR로 분할한다. 관련 없는 수정은 섞지 않는다. 기존 코드·실행 중 탭·키·배포 설정을 임의로 초기화하지 않는다.

## C02 — 경험 ID와 프리뷰 격리

- P-01은 `preview/docs/EXPERIENCE_MATRIX.md`를 만든다. 행 스키마: `requirementId, sourceSection, entityId, entry, action, success, reject, cancel, retry, sourceMode, visualStatus, ownerTask, acceptanceEvidence`.
- 경험 ID는 `EXP-ENTRY`, `EXP-WORLD`, `EXP-IDENTITY`, `EXP-REWARD`, `EXP-MEETUP`, `EXP-LOCATION`, `EXP-REPLAY`, `EXP-COMMS`. 카탈로그 항목은 실제 `ItemSpec.id`/`ActionSpec.id`/`Place.id`를 참조한다. 대략적인 개수로 누락 검사를 대체하지 않는다.
- `sourceMode`는 live / rule / scripted / replay / planned. planned는 미구현 기능의 안내용이며 라이브 WorldEvent의 source 값에 추가하지 않는다. `visualStatus`는 complete / fallback / missing이고 fallback이면 대체 클립/아이콘을 표시한다.
- 프리뷰 fixture의 세션·인벤토리·주인 승인 상태는 라이브 `/api/*` 쓰기와 격리한다. 모드 전환 시 선택 Muse와 출처 표시를 갱신하고 fixtures가 실제 claim/권한으로 승격되지 않게 한다.
- 전체 화면의 기본 UI는 영어를 유지하고 대본/상태/오류도 같은 용어를 쓴다. 디버그 카운터·구현 상세는 필요한 증거 보기/About에 둔다.

## C03 — 기존 세계·이벤트 계약

- 기존 타입의 기준 위치: `preview/src/engine/world.ts`의 `WorldState`, `MuseState`, `WorldEvent`, `Decision`, `Source`, `Wants`; 아이템 규칙은 `preview/src/engine/items.ts`, 하네스는 `preview/src/engine/harness.ts`.
- `WorldEvent`의 기존 `id,tick,at,source,kind,muse,other,place,line,data,tags`를 유지한다. `source`는 live / rule / scripted / replay다. 행위 주체의 출처는 `data.actorOrigin: system | connected | trial`로 구분한다. connected 표시를 위해 source enum을 임의로 늘리지 않는다.
- 새 쓰기 명령 계약은 `preview/worker/core/commands.ts`에서 정의한다: `WorldCommand {commandId, worldId, expectedVersion, actorId, action, payload, signed}`. `signed`는 기존 `Signed` 타입이다. 서명 content는 `{worldId, expectedVersion, action, payload}`의 JCS 해시를 포함한다. `commandId === signed.envelope.message_id`, `actorId === signed.envelope.agent_id`(공개키 agent ID이며 engine Muse ID는 trust registry로만 변환), `worldId`는 검증 대상 world와 일치해야 한다. `action === signed.envelope.action`도 확인하고 peer action의 recipient는 payload/Task 참여자에서 정한 수신 agent ID, 비-peer action은 해당 world 처리자 ID와 일치해야 한다. 필드를 바꾼 외부 wrapper를 서명 검증만으로 신뢰하지 않는다. 클라이언트 UI가 쓰는 Muse ID와 공개키 agent ID 변환은 registry만 소유한다. 결과는 `CommandResult {ok, commandId, worldVersion, eventIds, error?}`이며 error는 `{code,retryable}`만 공개한다. 사적인 거절 이유는 넣지 않는다.
- I-01이 `WorldRuntime.executeCommand(command, now): Promise<CommandResult>`와 DO 어댑터를 소유한다. 기존 heartbeat/commitExternal을 전부 새 공개 API로 노출하지 않는다. 모델 호출은 트랜잭션 밖에서, 변경은 검증 후 한 커밋에서 수행한다.
- 이벤트 ID와 외부 명령 ID는 영속 중복 방지 대상이다. 같은 commandId 재호출은 최초 결과를 돌려주며 재보상/재교환하지 않는다. 동일 commandId에 다른 payload는 `command_conflict`로 거부한다.
- 처리 순서: transport 호출자 인증 → wrapper/서명 content·actor 결합 확인 → 동일 주체+commandId의 기존 결과 조회(같은 본문만 재반환, 다른 본문 conflict) → 신규 요청의 현재 위임/클레임/승인/만료·nonce 검증 → expectedVersion 검사 → 커밋. 유효한 과거 요청의 정상 재시도를 이미 사용한 nonce로 새 실행하지 않는다. 철회된 호출 자격은 캐시 조회 전 transport에서 거부한다.
- `expectedVersion`이 낡으면 `stale_world`로 거부하고 새 상태로 재계획한다. 읽기 조회 실패를 빈 세계/성공으로 위장하지 않는다. UI는 마지막 성공 시각과 재시도 상태를 표시한다.

- 2026-11-02 구현 대응 (I-01 #47, `feature/i01-command-runtime`): 위 C03 원문과 원래 SHA·줄 참조는 당시 계약으로 남기고, 실제 구현이 다른 점만 적는다.
  - 위치: `preview/worker/core/commands.ts`가 아니라 본 제품 `app/worker/core/commands.ts`다.
  - 진입점: `WorldRuntime.executeCommand(command, now)` 대신 `executeCommand(ctx: {trust, runtime}, command: WorldCommand, handler: CommandHandler, now?): Promise<CommandOutcome>`다. action의 적용(apply)은 호출부(MCP 도구, 주인 Muse 거래)가 가지므로 runtime만으로는 실행할 수 없기 때문이다. `CommandOutcome.result`가 C03의 `CommandResult {ok, commandId, worldVersion, eventIds, error?: {code, retryable}}`다. DO 어댑터는 `WorldRuntime.commitCommand`·`commitRefusal`·`commandRow`이고 모두 `ctx.storage.transactionSync` 안에서 커밋한다.
  - 서명 content는 `{worldId, expectedVersion, action, payload}` 그 자체다. 중복 판정 hash는 `{worldId, action, payload}`의 JCS 해시이며 expectedVersion을 넣지 않는다(새 버전으로 다시 서명한 재시도를 같은 명령으로 본다). 서버 상태(예: `discover`의 현재 장소)는 payload에 넣지 않는다.
  - MCP 쓰기 도구는 선택 인자 `command_id`·`expected_version`을 받고 응답 `command`에 실제로 쓴 값을 돌려준다. `expected_version`을 생략하면 서명 content의 expectedVersion은 `null`이고 버전 검사(사전·커밋 시)를 하지 않으며, 응답 `world_version`은 실제 커밋된 버전이다. `get_world_state`가 `world_version`을 준다. 비-peer 수신자 ID는 `musely:world:<worldId>`다.
  - 처리 순서 구체화: wrapper 결합 → 서명 → 위임 철회·버전(철회된 행위자는 저장 결과도 조회하지 못한다) → 저장 결과(같은 hash 재반환, 다른 hash `command_conflict`, 같은 ID 진행 중 `in_progress` retryable) → nonce를 소비하지 않는 envelope 검증(기대 수신자 포함) → 상대 카드·위임 → `stale_world` → 트랜잭션 밖 작업(think; 반환한 `settle`은 executeCommand가 finally에서 호출하고, think는 throw 전에 스스로 정산한다. think와 상대 확인에는 15초 데드라인) → 하나의 트랜잭션에서 저장 결과·world version·양쪽 위임을 다시 확인한 뒤 nonce 소비·적용·이벤트·결과 행. 거부는 nonce를 소비하지 않으므로 같은 commandId로 재시도할 수 있다.
  - 거부는 world version을 올리지 않고 상태가 그대로면 세계 행을 다시 쓰지 않는다. 규칙 거부(apply 실패)는 상태가 실제로 바뀐 경우에만 버전을 올리며 결과 행은 저장한다. 같은 (actor, 상대, code, step) 거부는 10분 창에서 이벤트 하나로 합치고 횟수는 `refusals` 테이블에 둔다. 창이 닫히면 반복이 있었던 키마다 `refusal_repeats` 이벤트(`repeat_count`)를 남긴다. P0 같은 증거 흐름(`ownerTrade`)은 합치지 않는다. `decision_discarded`는 think가 있을 때만 쓰고, 그 밖의 커밋 시점 거부는 일반 거부(handler 기록·Blocked 알림)로 남긴다. `stale_world`·`command_conflict`·`replay`·`in_progress`는 주인 Blocked 알림과 `p0_refused` 태그에서 제외한다.

- 2026-11-02 구현 대응 (I-03B #50): MCP `ToolCtx.now`를 커밋 시각으로 다시 읽고 `CommandCtx.now?: () => number`를 사용하는 호출은 async 검증 뒤 Task apply·상대 자격·자기 위임/봉투 만료를 실제 커밋 시각으로 판정한다. 시계가 없는 기존 호출은 전달한 `now`를 유지한다. MCP `ToolCtx.ownerClaimedNow?: () => boolean`은 현재 클레임을 커밋 직전 재조회하며, self/claim 거부 전에 아이템 upkeep을 실행하지 않는다. 전체 도구의 localhost 실제 TLS→Worker/DO→서명→커밋 증거는 `app/docs/MCP_INTEGRATION.md`; fixture와 실제 배포/실계정(I-04/D-01) 증거는 구분한다.

## C04 — 신원·권한과 커밋

- 기존 `identity/envelope.ts`의 `Signed`, `Envelope`, `Verdict`, `TrustRegistry`, `verifyEnvelope`와 ES256/JCS·위임장 계약을 재사용한다. JSON 정규화/서명을 별도 임의 구현하지 않는다.
- 클레임/카드 신뢰 루트·위임 버전·범위·만료·수신자·본문 해시·재사용 방지·승인 대상 검증은 인사/교환/보상 등 부작용 전에 끝나야 한다. await 뒤 커밋 직전에 버전/철회를 다시 확인한다. 정상 NPC 흐름도 검증을 우회하지 않는다.
- 명령 실행·nonce 소비·이벤트·아이템 이력을 원자적으로 처리한다. 검증 실패는 거부 이벤트만 남기고 인벤토리/위치/보상은 불변이다. 불법 요청이 정상 요청의 nonce를 소모하지 못하게 한다.
- 승인에는 `approval_ref`와 정확한 `content_hash`가 필요하다. 제안 내용·대상·시간·장소가 달라지면 양쪽 승인은 무효다. 평판·아이템·하네스 역할은 금지 권한을 열지 않는다.
- 시스템 주민은 등록된 시스템 루트와 위임으로 통제하며 actorOrigin system 및 demo principal임을 표시한다. 시스템 루트의 신뢰를 실제 사람의 Meta 클레임으로 표현하지 않는다. 주인 클레임 필수 정책은 connected/trial 개인 에이전트에 적용하고 visitor 미클레임 거래는 거부한다.
- 실제 계정 클레임은 해당 주인에게만 속한다. 미클레임 방문자는 관전/격리된 체험만 가능하며 다른 Muse와 실제 거래할 수 없다. 맞이 의식 기록 재생도 새 방문자를 인증하지 않는다.
- 철회는 현재 위임 버전을 폐기하고 대기 Task/늦은 응답을 종료한다. 새 위임 발급은 주인 의사로 별도 처리하며 테스트 편의를 위한 자동 재위임은 제품 철회 경로에 넣지 않는다.

- 2026-11-02 구현 대응 (I-01 #47): 주민끼리 만나는 정상 흐름도 heartbeat가 tick 전에 양쪽 Agent Card(신뢰 루트)와 `server_heartbeat` 위임(서명·버전·철회·만료·scope)을 검증하고, 엔진의 `canMeet` gate가 커밋 시점에 철회를 다시 확인한 뒤에만 인사·거래를 실행한다. 실패하면 `meeting_refused`만 남기고 두 Muse는 바뀌지 않는다. gate가 설정되지 않았거나 검증을 실행할 수 없으면 만남을 거부한다(fail closed; 시험만 명시적으로 끌 수 있다). `verifyEnvelope`는 기대 수신자(`expect.recipient`)가 필수이며 다르면 nonce 소비 전에 `wrong_recipient`로 거부한다.

## C05 — 모델·시간·실행 한계

- 기존 `/api/muse`의 허용 동작 spotlight / encounter / trade / negotiate / challenge, 서버 프롬프트 조립·구조화 출력 검증을 유지한다. 외부 SDK/API 변경은 구현 전에 현재 공식 계약과 실제 요청으로 확인한다.
- 세계 시간대 America/Los_Angeles, heartbeat 60초, 모델 타임아웃 8초. 문서 개정 시점 기본 하루 예산은 wrangler 설정 $12이고 실행 당시 값을 증거에 기록한다. 방문자 체험 시간당 3회, challenge 별도 할당은 기존 정책을 보존한다.
- 실행 선택: 거래 최대 3응답 라운드(첫 응답+역제안 최대 2회), 만남 후보 최대 5개, encounter 응답 1회, 모델 동시 실행 세계당 최대 2개. 이는 상한을 구체화한 구현 기본값이며 조정은 비용/시간 측정과 계약 변경을 함께 남긴다.
- 각 모델 요청 전에 최대 비용 예약, 성공/실패 후 정산. 재시도·예약 중복·불명확한 사용량·늦은 답의 정산은 기존 ledger 규칙을 따른다. 예산/장애 시 유효한 기록 재생 또는 시나리오로 전환하고 실제 출처를 표시한다.
- 엔진의 랜덤 시드만으로 모델 응답·사용자 승인 순서를 재현했다고 주장하지 않는다.

## C06 — Task·MCP·주인 승인

- PR #26의 `core/mcp-server.ts`, `core/mcp-tools.ts`, `core/connected.ts`, `core/agent-keys.ts`, `core/owner-api.ts`, `engine/inbox.ts`, `engine/location.ts`, `engine/travel.ts`를 선행 구현으로 재사용한다. 병합된 구현을 지우고 중복 MCP/인박스/이동 엔진을 만들지 않는다. 기존 judge=owner 처리는 I-02에서 별도 owner 세션으로 분리하고 agent key 발급/철회·owner location 쓰기도 함께 이관한다.
- 새 공유 워크플로 타입은 `preview/worker/core/tasks.ts`: `TaskRecord {id,kind,participants,status,revision,contentHash,expiresAt,payload,approvalRefs,eventIds}`. kind는 trade / meetup / help; status는 submitted / input-required / completed / rejected / expired / cancelled.
- I-03A는 MCP transport/router/인증·도구 스키마와 인박스 표면을 소유하고, I-07/I-13이 실제 Task 상태 전이와 동작을 소유한다. transport가 아직 없는 도구를 성공으로 응답하지 않는다. `capability_not_ready`를 반환하고 I-03B는 I-07/I-13 완료 전 전체 도구 통합 검증을 닫지 않는다. 따라서 태스크 의존성은 I-03a(transport) → 워크플로 → I-03b(전체 도구 검증)로 실행한다.
- `engine/inbox.ts`의 기존 Task를 버리지 않고 `core/tasks.ts`가 version 2 facade/migration을 소유한다. 기존 id/deadline/offer/history 유지, pending은 응답 전 submitted/응답 대기 input-required로, failed는 cancelled로 매핑한다. existing inbox messages/mail/notifications/connected와 AgentKeys 저장을 보존한다. 마이그레이션 전후 동일 Task/아이템/수신함 개수와 재시작 idempotency 시험을 I-07에 둔다.
- tool 목록은 방향 v2 7.2의 모든 이름을 그대로 사용한다. 초대/도움은 기존 7.2에 동작만 있고 도구 이름이 없으므로 `invite_campfire`, `propose_help`, `answer_help`를 같은 scope 체계에 추가한다. I-03A가 스키마, I-13이 backend, I-03B가 호출 통합을 소유한다. 각 tool의 JSON 입출력 스키마를 `preview/docs/MCP_TOOLS.md`에 고정한다. 읽기는 호출 에이전트에게 허용된 공개 세계/자기 상태, 쓰기는 등록된 실행자 자격과 C03~04를 통한다.
- `heartbeat_check`는 대기 Task·받은 메시지·기한을 반환한다. 주인 인박스는 합의 후보/거래 완료/차단만 표시한다. 두 인박스를 합치지 않는다.
- 주인 인증 구현 선택: 별도 `OWNER_CONTROL_TOKEN`을 Worker 비밀값으로 보관하고 `POST /api/owner/session`에서 교환해 주인 ID·만료·권한에 바인딩한 HttpOnly/Secure/SameSite 쿠키를 발급한다. 발급 TTL 1시간, 서버 검증·CSRF Origin 검사를 적용한다. 일반 judge 세션은 owner가 아니며 공개 심사 링크로 주인 제어 권한을 얻지 않는다. 키 전달은 계정 주인의 비밀값 설정 checkpoint이며 URL/채팅 본문/로그에 넣지 않는다. S4에서 일반 OAuth owner 세션으로 확장한다. I-02가 발급/갱신/철회·owner↔agent registry 결합을 소유한다. 두 주인 권한 시험용으로 별도 `DEMO_PEER_CONTROL_TOKEN`을 발급해 다른 ownerId/루트/에이전트로 묶고, 본인 토큰으로 상대 승인·철회를 시도하면 거부한다. 시험 상대는 팀이 통제하는 system demo principal로 표시하고 두 번째 실제 Meta 계정/사람의 클레임이라고 주장하지 않는다. I-02는 두 주체 준비·독립 쿠키 jar·키 세팅 절차를 문서화하고 I-07이 두 주체 승인을 검증한다.
- 신규 주인 UI API는 `GET /api/owner/inbox`, `POST /api/owner/approvals`(taskId,revision,contentHash,decision), `POST /api/owner/revoke`다. 요청자 주인 인증이 필수이며 owner ID를 본문만 믿지 않는다. 데모 계정의 한계를 표시한다.
- trade는 소유·거리·양도·만료·일일 제한과 양쪽 잠금 검증 후 원자 교환한다. meetup은 양쪽 로컬 accept/reject 후 candidate를 만들고 양쪽 주인이 같은 revision/hash를 승인할 때만 completed/Meetup Ember를 발행한다. 하나라도 거절/만료/철회되면 확정하지 않는다.
- 사적 조건은 각 클라이언트의 로컬 평가기에 남는다. Spark 입력/상대 메시지/분석 로그에 넣지 않는다. 공개 응답은 accept/reject와 필요한 후보 식별자뿐이다.
- 기한 기본값: 기존 `engine/inbox.ts`의 TASK_TTL_MS=30분을 trade/meetup/help에 유지한다. 새 주인 승인도 30분이며 화면에 표시한다. 기한은 서버 시간으로 판정하고 화면에 표시한다. 제품 결정 변경은 계약과 해당 테스트를 함께 수정한다.

## C07 — 보상·장소·이동

- 기존 ItemSpec/ActionSpec/Place IDs와 방향 v2 전체 카탈로그를 재사용한다. 목록 등록만으로 능력 구현을 완료하지 않는다. 카탈로그 각 행에 effectRule·소모/만료·전달·시각 상태·수용 테스트를 연결한다.
- 장소별 하루 1회, 하루 최대 10회 발견. 쌍당 거래 하루 1회, 100m 이내, 역제안 최대 2회. 같은 종류 반복 획득의 호기심 보상 0, 능력 변화 없는 교환은 거래로 인정하지 않는다. 유물/스탬프는 판매하지 않는다.
- Transit Pass는 서로 다른 정류장 3곳 방문으로 일일 제작권, 24시간 유효. 영구 스탬프는 소모하지 않는다. Garden Pass+Clover Seed로 Bloom 제작 시 씨앗만 소모한다.
- 주인 위치 목적지 셀과 Muse 현재 셀은 별개다. 실제 활동은 Muse의 현재 셀·서버 이동 상태로 검증한다. 가상 위치 변경만으로 발견/거래 장소를 바꾸지 않는다. Taxi Token은 같은 가상 위치 기반 인증과 토큰 소모가 있을 때만 이동을 확정한다.
- PR #26의 상수·소모를 유지한다: 엽서/선물은 각각 Muse당 하루 3회, 엽서 배달은 거리/(WALK_MPS×5)를 60초~2시간으로 제한한 실제 시간이다. 모임 하이라이트는 동시 참석 3명 이상이다. 이미 있는 소비/제한 계약과 중복 소모하지 않는다. 실측으로 조정하면 계약도 갱신한다.

## C08 — 장면·재생·기록

- 라이브 3D와 지도 표식은 같은 Muse ID·같은 스냅샷 버전을 참조한다. 대본 인물과 서버 Muse를 이름만으로 매핑하지 않는다. scripted 모드는 별도 라벨과 상태를 쓴다.
- `preview/src/ui/live-scene.ts`가 서버 WorldView→캐릭터/말풍선/소품 투영을 소유한다. 서버 판단은 클라이언트 애니메이션 프레임에서 다시 실행하지 않는다. 두 캐릭터 접촉·소품 전달·LOD 전환에서도 인벤토리와 액션 위상 유지. I-09의 seek는 액터 애니메이션 로컬 시계의 재설정이며 RunRecord player seek는 I-11에서 구현/검증한다. 따라서 I-09가 I-11에 역의존하지 않는다.
- `RunRecord {runId,worldId,schemaVersion,engineVersion,harnessVersion,catalogVersion,seed,initialSnapshot,inputs,events}`를 I-10이 `preview/worker/core/run-log.ts`에 정의한다. 개인정보/웹캠 원본은 저장하지 않고 모델 requestId/output과 공개 승인 입력 순서를 보존한다.
- I-11의 `preview/src/replay/player.ts`는 `loadRun(record)`, `seek(at)`, `setSpeed(1|10|60)`로 읽기 전용 투영을 만든다. 플레이어에 라이브 command executor/모델 호출을 주입하지 않는다. 스키마/카탈로그 버전 불일치는 `incompatible_record`로 표시한다.
- 태그·Muse·장소·시각으로 하이라이트를 찾고 해당 이벤트/서명·권한 결과/모델 ID를 연다. rule/서명 검증 이벤트에는 모델 requestId를 꾸며 넣지 않는다.

## C09 — 자율성 6항목의 집계

- I-05/I-07/I-13이 생성하는 이벤트 data: encounter는 `{encounterId,initiatedByIntent,actorOrigin}`이고 정렬된 두 참가자+회합 ID당 1회, 서명 검사 이벤트는 `{verificationId,verdict,scope,delegationVersion}`이며 검증 시도당 1회, 모델 응답은 `{model,requestId,responseId}`를 `data.evidence`에, 상태 변화는 `{beforeHash,afterHash}`를 저장한다. I-10이 eventId/encounterId/verificationId/requestId별 중복 제거와 runId/worldId 배정을 소유한다.
- 같은 worldId·runId·시각 구간에서 집계한다. 기간·표본 수·live/rule/scripted/replay 구분을 표시한다. 재생은 원기록 조회이며 새 실시간 실행 횟수를 늘리지 않는다.
- 자율 개시율 = `initiatedByIntent=true`인 encounter 수 / 전체 encounter 수. 분모 0은 미측정이다. 규칙 엔진의 개시와 실제 연결 Muse의 개시는 actorOrigin별로 분리한다.
- 주인 개입 = owner approval 요청 이벤트 수, 일상 인사/거래 제안과 확정 약속을 분리한다. 서명 검증 = 실제 검사 통과/거부 이벤트 수. 모델 호출 = unique requestId의 live/replay 수(모델 없는 검증 이벤트 제외).
- 능력 변화 = 실제 상태 전후가 달라진 ability_change 이벤트 수. 차단 = injection_blocked 및 범위 밖 거부 이벤트 수를 각각 표시한다. 이름이 같은 이벤트의 중복 전달은 id로 제거한다.

- 2026-11-02 구현 대응 (I-10 #58, `feature/i10-run-log`, PR #93 검토 반영): 위 C08·C09 원문과 원래 SHA·줄 참조는 당시 계약으로 남기고, 실제 구현만 적는다.
  - 위치: `preview/worker/core/run-log.ts`가 아니라 본 제품 `app/worker/core/run-log.ts`다. 재집계 oracle은 `app/worker/core/autonomy-oracle.ts`, 패널 집계는 `app/src/ui/autonomy.ts`이고 `app/scripts/run-log.test.mjs`가 둘을 같은 이벤트로 비교한다.
  - RunRecord는 한 행(`runs`)과 커밋 순서의 입력 행(`run_inputs`)으로 나눠 저장한다. `runs`: runId, worldId, schemaVersion(`run-log-1`), engineVersion(`ENGINE_VERSION`, 이 PR에서 `engine-2`), harnessVersion·catalogVersion(HARNESSES, ITEMS+BEATS+PLACES의 JCS SHA-256 앞 12자리), seed(시작 시점 day seed), initialSnapshot(공개 상태 본문과 해시), startedAt, origin, prevRunId, legacy. `RunRecord.inputs`는 `run_inputs`, `RunRecord.events`는 `events.run_id`로 조회한다. run별 입력·이벤트 수는 커밋 트랜잭션에서 갱신하는 `run_counts`에 둔다(기록이 아니라 카운터 캐시다).
  - run은 새 세계(`fresh`), 버전이 바뀐 시작(`version_change`), 그리고 run log 이전부터 돌던 세계의 첫 시작(`pre-run-log`, 한 번)에 연다. pre-run-log run의 스냅샷은 run log 시작 시점 상태이고, 그 이전 이벤트(`run_id` NULL)는 이 run에 속하며 legacy에 개수를 남긴다. 그 이벤트들의 코드 버전·모델 입력은 기록되지 않았다.
  - `run_inputs` 한 행 = 한 커밋: kind(tick/command/refusal/external), label, day, tick, 버전 전후, 공개 세계 상태 해시 전후, I-06 아이템 이력 head·seq, 실제로 INSERT된 이벤트 행 수(`changes()`; 같은 id로 무시된 행은 세지 않는다), 입력. tick 입력: 스포트라이트·만남 응답의 출력(id·enum·boolean만 그대로, 대사·이유 같은 문장은 SHA-256), source, 사유 코드, 사용 여부, model/requestId/responseId·replayOf id. command 입력: actorId, commandId, action, payloadHash, 액션별 허용 필드(`COMMAND_FIELDS`: 아이템·대상 Muse·장소·Task id, mode, answer 등 id 값만), 빠진 키 이름(`omitted`), 결과. 프롬프트는 저장하지 않는다. 이벤트는 `run_id`·`input_seq`로 자기 커밋 행을 가리킨다.
  - run log에는 자유 문장을 남기지 않는다: 인사·엽서 글·wants goal·모델 대사와 이유·성찰·기억·메시지와 알림 문장은 run_inputs에 없고, 스냅샷에는 SHA-256(`text-sha256:`)으로만 있다. 문장은 공개 이벤트에만 있고 #91의 key purge가 그곳을 익명화한다. 그래서 run_inputs·runs는 purge 대상이 아니고 append-only를 유지한다.
  - 스냅샷은 허용 목록(`SNAPSHOT_FIELDS`)이다. 목록에 없는 상태 필드는 빠지고, 시험이 실제 상태의 모든 필드가 목록에 있는지 검사한다(새 필드를 추가하면 규칙을 정해야 시험이 통과한다).
  - 저장하지 않는 것: 웹캠 프레임(세계에 들어오지 않는다), 주인 위치(cell·preset·target, Muse의 anchor cell), 만남 후보의 시간·장소(inbox candidate, 주인 알림 detail). 해시도 이 값들을 뺀 공개 상태에 대해 계산한다.
  - actorOrigin(C03 값만): encounter는 개시자가 상대 Muse를 목표로 한 intent를 가졌고(`initiatedByIntent`도 이때만 true) 그때 연결 상태였을 때만 `connected`이고, 동전 던지기로 정해진 개시자·다른 Muse를 향한 intent·주민이 연결 Muse에게 다가간 경우는 `system`이다. MCP 쓰기(`actor: 'your Muse'`)는 `connected`, 방문자 스포트라이트 요청·방문자/심사 링크의 맞이 의식·demo 검사(impostor, injection)·심사 링크의 P0 실행은 `trial`이다. 세계의 자체 처리는 커밋 시점에 `system`으로 채운다. 이전 패널 값 `muse`/`person`은 계약 값이 아니므로 미기록으로 센다.
  - 한계: C03에는 주인 본인의 행위를 나타내는 값이 없다. 주인의 철회·재위임(과 그로 멈추거나 재개된 Task·Muse 이벤트), 주인 세션의 맞이 의식, 주인이 실행한 P0는 actorOrigin을 두지 않고 `data.actor`(`owner`, `owner (P0 run)`)만 기록한다. 집계에서는 actorOrigin 미기록으로 센다. 값을 추가하려면 C03을 먼저 바꾼다.
  - 능력 변화: `ability_change` 이벤트마다 그 이벤트의 Muse(muse·other)의 inventory와 아이템 만료 시계만으로 계산한 해시를 `beforeHash`/`afterHash`(`abilityOf`에 대상 Muse)에 넣는다. 두 값이 같으면(아이템 순서만 바뀐 경우 포함) 변화로 세지 않는다. 세계 상태 해시는 run_inputs에 따로 있다.
  - 집계 중복 제거: eventId는 처음 전달된 것, encounter는 encounterId, 서명 검사는 verificationId(있을 때, 로그 순서의 첫 이벤트)로 한 번씩 센다. 분모 0·증거 없음은 미측정이다.
  - API: `GET /api/world/run`(현재 run 요약, `runId`·`snapshot=1`로 특정 run과 스냅샷 본문), `GET /api/world/run/inputs?runId&since&limit`, `GET /api/world/event?id`(이벤트·커밋 행·run), `GET /api/world/autonomy?from&to|day&runId`(기본 최근 24시간, `day`는 그 세계일 ±2시간의 `at` 범위로 인덱스를 탄다, 최대 48시간·표본 20,000건이며 넘으면 `partial: true`, 여러 run이면 run별 값도 준다). 이 네 경로는 응답을 30초 `public`으로 캐시하고(Cache API), 캐시가 없을 때 BURST 요청 제한(초과 시 429)을 건다. `GET /api/world/highlights?limit&before&from&to`(최대 300건/페이지, `before`가 cursor). 잘못된 정수·`from >= to`는 400이다.

## C10 — 검증과 종료 증거

- 공통 완료 기록: issueId, owner, commitSha, PR, environment, deployId(배포시), URL, configVersion, testedAt, command, result, artifact, limitations. 빈 증거/skip은 PASS가 아니다. 기존 완료 PR은 재사용 근거일 뿐 남은 수용 기준을 자동 통과시키지 않는다.
- 제품 변경은 해당 Node 회귀→`npm run check`(preview cwd)→관련 browser 스크립트. 로컬 Workers 호환성 한계는 기록하고 서버 실증은 실제 배포에서 한다. docs-only는 링크/줄 범위·스키마·DAG·범위 커버리지·diff 검사를 수행하며 제품 테스트 통과로 대체하지 않는다.
- P0: 업무 내용과 대상은 같게, 새 요청 ID/nonce로 철회 전후 실행. 철회된 위임이 거부 원인인지 확인하고 인벤토리 불변/거부 이벤트를 대조한다. 선행 거래 때문에 일일 제한에 걸린 결과를 철회 효과로 주장하지 않는다.
- P1: 동일 초기 스냅샷·시드·시간·공개 입력, 아이템 유무만 다르게 두 실행을 통제한다. 모델을 쓰면 같은 기록 입력으로 통제한 비교와 실제 live 장면을 구분한다. 다른 랜덤 모델 답변을 아이템 인과 증명으로 쓰지 않는다.
- P2: 장면의 runId/eventId에서 실제 모델 requestId 또는 서명/권한 검증 결과까지 연결. 원기록을 재생한 장면은 replay로 표시한다. 수치 6항목을 원기록으로 다시 집계해 일치 확인.
- S3는 동일 release SHA/배포 ID/설정을 식별한다. 운영 서비스에 장애를 주입하지 않고, 동일 빌드의 격리 배포에서 fault 시험을 수행한 경우 격리 환경으로 명시한다. 실제 데모 URL의 예산/할당/폴백은 별도 검증한다. 각 증거의 환경을 합쳐 하나의 PASS로 쓰지 않는다.

## C11 — 자산·성능 합격 조건

- 캐릭터 킷 기존 계약을 적용: LOD0/1/2 각각 28,000/8,000/3,000 삼각형 이하, LOD0 동시 최대 2명, 캐릭터 draw ≤10, 8명 commons Three 레이어 draw ≤90(MapLibre 제외), 공유 8명 payload ≤15MiB, 캐릭터 texture 추정 ≤96MiB. 10명 장면은 별도 집계하며 8명 예산을 검증 없이 확장하지 않는다.
- rig digest/asset hash/Validator·지지발·가구 관통·접촉·액션 coverage는 기존 character-kit/actions 테스트로 검증한다. 대체 표현이 허용된 항목을 신규 클립 전체 완성 조건으로 바꾸지 않는다.
- 첫 방문: 캐시 없음, 4Mbps/150ms, 실제 도착 장면 표시 ≤8초(ENTRY_REVIEW 기준). desktop 210초 고정 경로 median ≥55FPS/p95 frame ≤33ms, 명시한 실기기 mobile median ≥30FPS/p95 ≤50ms. 390×844/1440×1000 레이아웃에서 가로 overflow 0·주요 조작 접근 가능.
- 기준 데스크톱은 MacBook Air M1, 실제 사용한 모바일 모델/OS/browser/DPR을 기록한다. 기준 기기가 없으면 다른 기기의 결과를 별도 기록하고 기준 기기 게이트는 미검증으로 남긴다. DPR 상한은 시험 전 후보를 정하고 결과/화질로 결정한다.
- 브라우저 total 메모리의 공통 절대 상한은 아직 제품 결정이 없으므로 임의로 발명하지 않는다. D-04는 시험 전 baseline/candidate를 같은 기기에서 비교하는 메모리 수용 표를 기록하고 승인된 예산을 연결해야 ready가 된다. 이 항목이 미정이면 명시적으로 blocked이며 임의 통과시키지 않는다.

### C11 승인 변경 기록 — 2026-11-02, D-04

- 현재 실행 대화의 명시적 승인에 따라 D-04 기준 데스크톱을 **MacBookPro18,2**로 변경한다. 위 MacBook Air M1 원문은 이력으로 보존하며 Pro 결과를 Air M1 실측으로 기재하지 않는다. 210초 경로와 FPS/p95 기준은 유지한다.
- 실제 모바일은 Galaxy S23 Ultra(SM-S918N), Android 16/API 36이다. 승인된 동일 기기·DPR 1.5·210초 baseline 비교에서 Chrome process-group PSS peak/end 증가를 각각 `max(baseline의 20%, 64MiB)` 이하로 판정하고 crash/지속 상승은 원시 추세로 별도 확인한다. 임의의 절대 total-memory 상한을 추가하지 않는다.
- 측정 pin은 HTML과 필수 runtime 자산 및 외부 JS/CSS의 served manifest를 묶고, baseline 파일 hash와 실제 기록된 공통 context를 대조한다. 과거 미기록 기기/OS/route/cache는 선언으로 보충한 실측으로 쓰지 않으며 수치 비교와 context 확인을 구분한다. RAF 정지 중에도 visibilitychange 기록을 유지한다.
- 재현 도구·실제 도착 기준·캐시 동등성 한계·8명/10명 분리와 최종 release 동결 전 측정 금지는 [DEVICE_ACCEPTANCE](../../app/docs/DEVICE_ACCEPTANCE.md)를 따른다. 준비 문서는 기기 통과 증거가 아니다.

## C12 — 외부 의존성·범위 밖

- 실제 웹캠 수행·본인 Muse 연결/자격 입력·Threads 게시 승인 등 계정 주인 행동이 필요한 checkpoint는 해당 이슈에 명시한다. 준비/실행/응답/receipt를 분리하고 미응답을 성공으로 쓰지 않는다.
- 공개 디렉터리 승인 기간과 Muse 예약·무인 쓰기 허용은 미확정이다. I-04에서 실계정으로 확인한다. 지원되지 않으면 지원되지 않음을 표시하고 수동 실행 대안을 검증하며 실제 연동을 연출로 바꾸지 않는다.
- 실제 결제·예약·외부 초대·일정 원본 공유는 금지. 일반 사용자 OAuth/GPS/운영 수습은 G-01, Gadget M8·추가 3D 지역·온도/현장 SAM 원장은 현행 데모 필수가 아니다. 과거 기획의 항목은 자동 부활시키지 않는다.
- D-06의 done은 제출 준비 검증 완료다. 실제 제출은 별도 execution 상태(not-authorized / authorized / submitted / confirmed)와 receipt로 추적하며 준비 이슈를 닫았다고 제출 완료로 표시하지 않는다. G-02의 done은 요건 확인과 신청 패키지 준비 완료이며 신청/심사/승인 상태와 receipt는 별도 추적 필드다.
- 제출/공개 전환/디렉터리 신청은 별도 실행 권한과 실제 receipt가 필요하다. 계획/이슈 등록은 해당 외부 실행의 승인으로 확대하지 않는다.

## C13 — 추적 표·단계 게이트·미결정 결정 (P-04, 2026-11-01 추가)

- 이 절은 P-04 #43에서 추가했다. 이슈들이 고정 참조하는 `9d5332a`의 C01~C12 원문과 줄 범위는 바꾸지 않는다.
- 경험 요구 → S2 구현 → S3 검증의 추적 표는 [`preview/docs/EXPERIENCE_MATRIX.md` 9절](../../preview/docs/EXPERIENCE_MATRIX.md#9-traceability-preview--s2-implementation--s3-verification-p-04)이 소유한다.
  - 요구 ID마다 주 담당 S2 태스크는 정확히 하나다. 기여 태스크는 따로 적는다.
  - 모든 요구는 S3 검증 태스크(D-*)에 닿아야 한다.
  - 모든 I-*·D-* 태스크는 최소 한 요구에서 도달해야 한다.
  - 범위 밖은 행마다 명시한다.
  - `node scripts/experience-matrix-check.mjs`(cwd `preview/`)가 위 조건을 전수 검사한다. 실패는 PASS가 아니다.
- 단계 게이트와 미결정 결정(DEC-*)은 같은 문서 10절이 소유한다. 결정마다 담당 태스크·해제 조건·막는 대상을 적는다.
  - 미정인 사실은 값으로 발명하지 않는다. 그 값이 필요한 태스크는 해제 조건이 충족될 때까지 blocked다.
  - 결정을 바꾸면 10절과 영향받는 이슈를 함께 갱신한다.
- 과거 PRD의 M0~M8 순서는 착수 조건으로 쓰지 않는다. 순서는 [`execution-tasks.json`](execution-tasks.json)의 의존성만 따른다.
- S1 경험의 승인(DEC-01, P-07) 없이 제품 방향을 확정하지 않는다. 제출·공개 전환(DEC-06·DEC-07)은 C12의 별도 실행 권한과 receipt를 따른다.

## Implementation evidence updates

### I-07 / C03·C04·C06 (2026-11-03)

[Owner workflow acceptance](../../app/docs/OWNER_WORKFLOW_ACCEPTANCE.md) records the original five I-07criteria,150actual deployed owner/demo-peer checks, the machine-verified claim, and source-equivalence reuse from8b13to494. [Experience mapping](../../app/docs/EXPERIENCE_MATRIX.md#i-07-owner-workflow-evidence-update-2026-11-03) connects EXP-REWARD/EXP-MEETUP/EXP-COMMS/AUTONOMY. This updates the I-07 evidence for C03/C04/C06; C05 retains separate I-12/D-03 evidence. Contract requirements are unchanged. Local privacy/migration tests, original operating receipts and remaining personal Muse/webcam/S3 prerequisites stay distinct.
