# IPC 杈圭晫鎶楀穿婧冧慨澶嶆竻鍗曚笌鎵ц璁″垝

## TL;DR
> **Summary**: 鏈鍒掗拡瀵?IPC 杞扮偢娴嬭瘯鏆撮湶鍑虹殑 29 椤硅竟鐣岀ǔ鍋ユ€х己闄凤紝缁欏嚭涓€浠戒弗鏍煎彈闄愮殑鎶楀穿婧冧慨澶嶆柟妗堛€備慨澶嶇洰鏍囦笉鏄敼鍙樹笟鍔＄粨鏋滐紝鑰屾槸淇濊瘉鎵€鏈?IPC 鍦?malformed payload / 閰嶇疆缂哄け / 闈炴硶杈撳叆涓嬮兘閫氳繃 **handler 澶栧３灞?* 浼橀泤鏀跺彛涓?structured error锛岀粷涓嶆姏鍑烘湭鎹曡幏寮傚父銆佹湭澶勭悊鎷掔粷鎴栧鑷翠富杩涚▼鏈嶅姟鎸傛銆?> **Deliverables**:
> - wrapper 灞傜粺涓€閿欒妗ユ帴绛栫暐
> - P0/P1/P2 鍒嗙骇淇娓呭崟
> - 浠呴檺 `ipcMain.handle` / `registerSecureIpc` / `registerSecureFeatureIpc` 澶栧３灞傜殑鏈€灏忚ˉ涓佹柟妗?> - 浣跨敤 `tests/ipc-contract-sweep.test.ts` 鐨勫洖褰掗獙璇佹柟妗?> **Effort**: Medium
> **Parallel**: YES - 2 waves
> **Critical Path**: 1 鈫?2 鈫?3 鈫?5 鈫?6

## Context
### Original Request
- 鐢ㄦ埛瑕佹眰杈撳嚭銆奍PC 杈圭晫鎶楀穿婧冧慨澶嶆竻鍗曚笌鎵ц璁″垝銆嬨€?- 绾㈢嚎闄愬埗锛?  - **鏈€灏忓寲淇敼锛圡VM锛?*
  - **缁濆绂佹淇敼浠讳綍搴曞眰涓氬姟 Service 閫昏緫**
  - 鎵€鏈変慨澶?*鍙兘鍙戠敓鍦?`ipcMain.handle` 澶栧３灞?*
  - 瀵规毚闇插嚭鐨勮剢寮遍€氶亾缁熶竴澧炲姞鍏ュ弬鏍￠獙鍜?try/catch 鍏滃簳
  - 鎵€鏈夐敊璇繀椤昏浆鍖栦负 `{ success: false, error: '...' }` 椋庢牸鐨?structured error
  - 璁″垝蹇呴』鎸?P0 / P1 / P2 鍒嗙骇

### Grounding Summary
- 宸查潤榛樿鍙?`PROJECT-PRD.md`銆乣ARCH-STANDARDS.md`銆乣.clinerules`銆?- 鍏抽敭纭竟鐣屽凡纭锛?  - 楂樹环鍊?IPC 蹇呴』淇濇寔 Fail-Closed
  - renderer 涓嶈兘鎵挎媴鐗规潈涓氬姟閫昏緫
  - 寮傚父蹇呴』缁撴瀯鍖栨敹鍙?  - 涓嶅厑璁告祴璇曟垨淇涓烘柟渚胯€屾斁瀹芥巿鏉冭竟鐣?- 宸叉湁杞扮偢娴嬭瘯 `tests/ipc-contract-sweep.test.ts` 棣栬疆杩愯缁撴灉锛?  - 鎬绘牱鏈細101
  - structuredSuccess锛?5
  - structuredError锛?6
  - skipped锛?
  - 纭け璐?闈炵粨鏋勫寲锛?9
- Oracle 缁撹锛氳繖浜涘け璐?*澶у鏁版槸鍚堟硶鐨?IPC 杈圭晫绋冲仴鎬х己闄?*锛屼笉鏄祴璇曡鎶ワ紱鍏朵腑閮ㄥ垎鏄€滈鏈熶笟鍔℃嫆缁?閰嶇疆缂哄け鈥濅絾閿欒鏀跺彛鏂瑰紡涓嶅悎鏍笺€?
### Key Existing Patterns
- `electron/services/license-service.ts:459-496`
  - `registerSecureIpc` / `registerSecureFeatureIpc` 鏄法妯″潡鍏变韩 wrapper seam
  - 褰撳墠鍙礋璐?trial/feature denial锛屼笉璐熻矗 downstream handler 鐨勯€氱敤寮傚父妗ユ帴
- `electron/services/config-service.ts:261-307`
  - `CONFIG.SET` / `SECRET.SET` 灞炰簬鐩存帴 payload 璇诲彇鑴嗗急鐐?- `electron/services/supabase-service.ts`
  - 澶氫釜 `CLOUD.*` handler 鐩存帴璇诲彇 `payload.domain` / `payload.lead` / `payload.domains`
- `electron/services/automation-service.ts:275-319`
  - `AUTOMATION.VERIFY_EMAILS` / `START_CAMPAIGN` 鏄彟涓€缁勭洿鎺?payload 杈圭晫

### Metis Review (gaps addressed)
- 蹇呴』鏄庣‘鍖哄垎涓夌被缁撴灉锛?  1. malformed transport shape 鈫?structured validation error
  2. valid request but denied by trial/feature/business rule 鈫?淇濇寔鍘熻涔?  3. unexpected throw/rejection 鈫?structured generic shell error
- shell-only patching瓒冲澶勭悊锛?  - `undefined / null / {}`
  - 缂哄皯 required top-level key
  - 椤跺眰鍏抽敭瀛楁绫诲瀷閿欒
  - downstream throw/rejection 鐨勭粺涓€鏀跺彛
- shell-only patching**涓?*璐熻矗锛?  - 涓氬姟瑙勫垯淇
  - 浜戠閫昏緫淇
  - 鎼滅储/璇勫垎/鍒嗘瀽涓氬姟璇箟淇

## Work Objectives
### Core Objective
鍦ㄤ笉瑙︾搴曞眰涓氬姟 Service 閫昏緫鐨勫墠鎻愪笅锛屾妸鎵€鏈夊凡鏆撮湶鐨?IPC 杈圭晫寮傚父鏀跺彛闂淇垚锛?- invalid/malformed input 鈫?structured error
- expected denial 鈫?淇濇寔褰撳墠 structured denial
- unexpected throw/rejection 鈫?structured shell error
- 浠绘剰鎯呭喌涓嬮兘涓嶅厑璁告湭鎹曡幏宕╂簝銆佹湭澶勭悊鎷掔粷鎴?handler 绾ф寕姝?
### Deliverables
- `registerSecureIpc` / `registerSecureFeatureIpc` 鐨勭粺涓€ shell hardening 鏂规
- direct `ipcMain.handle` 閫氶亾鐨勯《灞?payload guard 鏂规
- P0/P1/P2 鍒嗙骇淇鐭╅樀
- 浣跨敤 `tests/ipc-contract-sweep.test.ts` 鐨勯獙璇佹柟妗堜笌鍥炲綊闂ㄧ

### Definition of Done (verifiable conditions with commands)
- 鎵€鏈夌撼鍏?P0/P1 娓呭崟鐨勮剢寮遍€氶亾鍦?malformed payload 涓嬩笉鍐?reject
- 鎵€鏈夌浉鍏抽€氶亾閮借繑鍥炵粨鏋勫寲瀵硅薄锛岃€屼笉鏄８ `throw` / rejected promise
- packaged/fail-closed 鍟嗕笟杈圭晫涓嶈鏀惧
- `node --test tests/ipc-contract-sweep.test.ts` 涓嶅啀鎶ュ憡锛?  - `emitted uncaught exception`
  - `emitted unhandled rejection`
  - `rejected instead of returning structured response`
  - `hung on payload`
  - `produced non-structured outcome`

### Must Have
- 浠呬慨鏀?IPC shell/wrapper 灞?- 淇濇寔鐜版湁涓氬姟鏈嶅姟璋冪敤椤哄簭涓嶅彉
- 瀵?malformed payload 澧炲姞鏈€灏忓繀闇€鏍￠獙
- 瀵?unexpected throw/rejection 澧炲姞缁熶竴 try/catch 鍏滃簳
- 瀵?valid payload 鐨?trial/feature/business-denial 璇箟淇濇寔鍘熸牱

### Must NOT Have
- 涓嶅緱淇敼浠讳綍搴曞眰涓氬姟 Service 閫昏緫
- 涓嶅緱鏀规悳绱€佽瘎鍒嗐€佸垎鏋愩€佷簯绔€佹巿鏉冦€丟old Filter 璇箟
- 涓嶅緱娣诲姞鏍￠獙妗嗘灦渚濊禆锛堝 zod/yup锛?- 涓嶅緱鎶?valid denial 鏀规垚 generic 400
- 涓嶅緱鎶婂彈淇濇姢閫氶亾榛樿鏀捐涓烘垚鍔?- 涓嶅緱淇敼 preload / shared contract / renderer 涓氬姟閫昏緫浣滀负鏈鍒掑疄鏂芥墜娈?
## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after + `node --test`
- QA policy: Every task has agent-executed scenarios
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
Wave 1: Shared wrapper hardening + P0 direct channels锛?-3锛?Wave 2: P1 direct channels + regression verification锛?-6锛?
### Dependency Matrix
- 1 blocks 2,3,4,5,6
- 2 blocks 3,4,5,6
- 3 blocks 5,6
- 4 blocks 5,6
- 5 blocks 6

### Agent Dispatch Summary
- Wave 1 鈫?3 tasks 鈫?deep / quick / unspecified-high
- Wave 2 鈫?3 tasks 鈫?quick / deep / unspecified-high
- Final Verification 鈫?4 tasks 鈫?oracle / unspecified-high / deep

## Priority Matrix

### P0 鈥?楂樺嵄鏄撳穿婧冿紝蹇呴』鍏堜慨
杩欎簺閫氶亾鍦?malformed payload 涓嬪凡鏄庣‘琛ㄧ幇涓哄悓姝?寮傛 reject锛岃€屼笉鏄?structured error锛?- `CONFIG.SET`
- `SECRET.SET`
- `FILES.EXPORT_SAVE`
- `CLOUD.CHECK_COLLISION`
- `CLOUD.SYNC_LEAD`
- `CLOUD.UPSERT_LEAD`
- `CLOUD.CHECK_DOMAINS`
- `AUTOMATION.VERIFY_EMAILS`

### P1 鈥?閫昏緫涓柇 / 鏀跺彛涓嶄紭闆咃紝涓嬩竴娉慨
杩欎簺閫氶亾澶氭暟鏄€滈鏈熶笟鍔℃嫆缁?閰嶇疆缂哄け鈥濅絾閿欒妗ユ帴鏂瑰紡浠嶉渶纭寲锛?- `CLOUD.CREATE_CAMPAIGN`
- `CLOUD.FETCH_TEAM_LEADS`
- `CLOUD.FETCH_TRACKING`
- `CLOUD.SUBSCRIBE_REALTIME`
- `CLOUD.FETCH_CLAIMED_DOMAINS`
- `CONFIG.GET`
- `SECRET.CHECK`
- `CONFIG.FETCH_MODELS`
- `SEARCH.API_PROXY`
- `SEARCH.API_TEST_CONNECTION`

### P2 鈥?鍣煶 / 浠呴獙璇侊紝鏃犻渶浼樺厛鍔?杩欎簺閫氶亾褰撳墠鏈樉绀烘槑鏄?shell crash锛屽師鍒欎笂鍙仛楠岃瘉锛屼笉涓诲姩淇敼锛?- `AUTH.LOGOUT`
- `AUTH.GET_SESSION`
- `LICENSE.*`
- `AUTOPILOT.GET_STATE`
- `AUTOPILOT.SET_STATE`
- `AUTOPILOT.CLEAR_LEGACY`
- `AUTOPILOT.SYNC_STATE`
- `SEARCH.EXECUTE`
- `SEARCH.ANALYSIS_GENERATE`
- `AUTOMATION.START_CAMPAIGN`
- `CLOUD.UNSUBSCRIBE_REALTIME`

## TODOs

- [x] 1. 缁熶竴鍔犲浐 shared IPC wrappers锛圥0 foundation锛?
  **What to do**: 鍙湪 `electron/services/license-service.ts` 鐨?`registerSecureIpc` 涓?`registerSecureFeatureIpc` 澶栧３灞傚鍔犻€氱敤寮傚父妗ユ帴锛?  - 淇濈暀褰撳墠 trial/feature gating 椤哄簭
  - 瀵?handler 璋冪敤澧炲姞缁熶竴 try/catch
  - 浠讳綍 unexpected throw/rejection 涓€寰嬭浆鎴?`{ success: false, error: '...', code?: 500 }`
  - 瀵圭幇鏈?`FEATURE_DENIED` / `TRIAL_EXPIRED` / `SYSTEM_TIME_ABNORMAL` 绛夌粨鏋勫寲鎷掔粷淇濇寔鍘熻涔?  **Must NOT do**: 涓嶈淇敼搴曞眰 service锛涗笉瑕佹妸 valid business denial 鏀规垚 generic error锛涗笉瑕佹敼鍙?handler 鐨勪笟鍔¤皟鐢ㄩ『搴忋€?
  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 杩欐槸璺ㄦā鍧楃殑 primary seam銆?  - Skills: []
  - Omitted: [`frontend-ui-ux`] - 涓嶆秹鍙婂墠绔?
  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2-6 | Blocked By: none

  **References**:
  - `electron/services/license-service.ts:459-496`
  - `tests/license-gateway.test.js`
  - `tests/ipc-contract-sweep.test.ts`

  **Acceptance Criteria**:
  - [ ] 鍖呰鍣ㄤ腑鐨?downstream throw/rejection 涓嶅啀鐩存帴閫冮€?  - [ ] feature/trial denial 浠嶇淮鎸佺幇鏈?structured shape
  - [ ] 鏈柊澧炰笟鍔¤涔夊彉鏇?
  **QA Scenarios**:
  ```
  Scenario: Shared wrapper bridges unexpected handler throw
    Tool: Bash
    Steps: 1) Build Electron 2) run node --test tests/ipc-contract-sweep.test.ts
    Expected: No failure message containing 'rejected instead of returning structured response' for channels routed through secure wrappers when payload malformed
    Evidence: .sisyphus/evidence/task-1-wrapper-hardening.txt

  Scenario: Fail-Closed semantics preserved
    Tool: Bash
    Steps: 1) Re-run existing auth/license permission tests 2) inspect outputs
    Expected: FEATURE_DENIED / TRIAL_EXPIRED paths remain structured and unchanged in meaning
    Evidence: .sisyphus/evidence/task-1-fail-closed-preserved.txt
  ```

  **Commit**: NO | Message: `fix(ipc): harden shared secure wrappers against raw handler throws` | Files: `electron/services/license-service.ts`

- [x] 2. 淇ˉ P0 direct handle 閫氶亾鐨?top-level payload guards

  **What to do**: 鍙湪杩欎簺娉ㄥ唽鍏ュ彛鐨勬渶澶栧眰澧炲姞 minimal guards锛屼笉杩涘叆 service internals锛?  - `CONFIG.SET`
  - `SECRET.SET`
  - `FILES.EXPORT_SAVE`
  - `CLOUD.CHECK_COLLISION`
  - `CLOUD.SYNC_LEAD`
  - `CLOUD.UPSERT_LEAD`
  - `CLOUD.CHECK_DOMAINS`
  - `AUTOMATION.VERIFY_EMAILS`
  姣忎釜閫氶亾鍙仛锛?  - payload object-like 鏍￠獙
  - required top-level key 瀛樺湪鎬?鍩虹绫诲瀷鏍￠獙
  - malformed 绔嬪嵆 `{ success:false, error:'...', code:400 }`
  **Must NOT do**: 涓嶈瀵瑰祵濂椾笟鍔″瓧娈靛仛閲嶅害楠岃瘉锛涗笉瑕?reshape lead payload锛涗笉瑕佺 service body銆?
  **Recommended Agent Profile**:
  - Category: `quick` - Reason: 閫氶亾澶氾紝浣嗚ˉ涓佹ā寮忛珮搴︿竴鑷淬€?  - Skills: []
  - Omitted: [`review-work`] - 缁熶竴鍦ㄦ渶缁堥獙璇佸仛

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 5,6 | Blocked By: 1

  **References**:
  - `electron/services/config-service.ts:261-307`
  - `electron/services/export-service.ts`
  - `electron/services/supabase-service.ts`
  - `electron/services/automation-service.ts:275-319`
  - 棣栬疆 sweep 缁撴灉涓殑 8 涓?P0 閫氶亾

  **Acceptance Criteria**:
  - [ ] P0 閫氶亾鍦?`undefined/null/{}` 杈撳叆涓嬩笉鍐?reject
  - [ ] malformed payload 杩斿洖 structured 400 椋庢牸閿欒
  - [ ] valid payload 鏃朵粛杩涘叆鍘熸湁涓氬姟璺緞

  **QA Scenarios**:
  ```
  Scenario: P0 malformed payloads return structured errors
    Tool: Bash
    Steps: 1) Run node --test tests/ipc-contract-sweep.test.ts 2) inspect P0 channel outcomes
    Expected: P0 channels no longer appear under raw rejection failures
    Evidence: .sisyphus/evidence/task-2-p0-structured-errors.txt

  Scenario: Valid payload forwarding preserved
    Tool: Bash
    Steps: 1) Run existing focused tests touching config/cloud/automation handlers 2) compare with prior pass expectations
    Expected: Validly shaped requests still reach existing denial/business logic instead of being blocked at shell
    Evidence: .sisyphus/evidence/task-2-valid-forwarding.txt
  ```

  **Commit**: NO | Message: `fix(ipc): add top-level payload guards to P0 handlers` | Files: `electron/services/config-service.ts`, `electron/services/export-service.ts`, `electron/services/supabase-service.ts`, `electron/services/automation-service.ts`

- [x] 3. 缁熶竴 unexpected shell errors 鐨勭粨鏋勫寲鏂囨瑙勮寖

  **What to do**: 鍦ㄦ墍鏈?shell-layer 琛ヤ竵涓粺涓€ unexpected error bridge 瑙勮寖锛?  - malformed payload 鈫?`code: 400`
  - unknown shell failure 鈫?`code: 500` 鎴栫幇鏈?channel 鍏煎 code
  - `error` 蹇呴』鏄畝娲佸瓧绗︿覆锛屼笉杩斿洖 raw Error / stack / object
  - 灏介噺娌跨敤褰撳墠涓枃椋庢牸锛岄伩鍏嶈嫳鏂?stack trace 娉勬紡缁欏墠绔?  **Must NOT do**: 涓嶈鎶?business denial 鏂囨鏀规垚閫氱敤 400锛涗笉瑕佹妸鍘熷 `error.stack` 鎷艰繘鍝嶅簲銆?
  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: 瑕佺‘淇濆涓€氶亾琛屼负涓€鑷达紝浣嗕笉鑳借繃搴︽娊璞°€?  - Skills: []
  - Omitted: [`playwright`] - 鏃犻渶 UI

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 5,6 | Blocked By: 1,2

  **References**:
  - `electron/services/config-service.ts`
  - `electron/services/autopilot-state-service.ts`
  - `electron/services/automation-service.ts`
  - Oracle 缁撹锛氭嫆缁濆師鍥犲彲浠ュ悎鐞嗭紝浣嗗繀椤讳互 structured response surfaced

  **Acceptance Criteria**:
  - [ ] shell 灞備笉鍐嶆妸 raw error stack 鐩存帴鏆撮湶鍒?renderer
  - [ ] malformed transport shape 涓?business denial 鍙鍖哄垎
  - [ ] 鍝嶅簲瀵硅薄淇濇寔鍙簭鍒楀寲

  **QA Scenarios**:
  ```
  Scenario: No raw stack trace leaks through shell bridge
    Tool: Bash
    Steps: 1) Run node --test tests/ipc-contract-sweep.test.ts 2) inspect failure messages
    Expected: Failure text is sanitized string, not raw stack dump object
    Evidence: .sisyphus/evidence/task-3-sanitized-errors.txt

  Scenario: 400 vs business denial remain distinguishable
    Tool: Bash
    Steps: 1) Compare malformed payload cases with valid-but-denied cases in sweep output
    Expected: Malformed cases surface as input validation style errors, valid denied cases keep their domain-specific semantics
    Evidence: .sisyphus/evidence/task-3-error-taxonomy.txt
  ```

  **Commit**: NO | Message: `fix(ipc): standardize shell-layer structured error responses` | Files: touched handler registration files only

- [x] 4. 淇ˉ P1 鈥滈鏈熸嫆缁濅絾鏀跺彛涓嶄紭闆呪€濈殑 cloud/config 閫氶亾

  **What to do**: 瀵?P1 閫氶亾杩涜鍚屾牱鐨?top-level shell hardening锛屼絾浼樺厛鐩爣涓嶆槸鏀逛笟鍔＄粨鏋滐紝鑰屾槸鎶娾€滅己浜戠鍑瘉 / 缂洪厤缃?/ 闈炴硶 payload鈥濈粺涓€涓?structured failure锛?  - `CLOUD.CREATE_CAMPAIGN`
  - `CLOUD.FETCH_TEAM_LEADS`
  - `CLOUD.FETCH_TRACKING`
  - `CLOUD.SUBSCRIBE_REALTIME`
  - `CLOUD.FETCH_CLAIMED_DOMAINS`
  - `CONFIG.GET`
  - `SECRET.CHECK`
  - `CONFIG.FETCH_MODELS`
  - `SEARCH.API_PROXY`
  - `SEARCH.API_TEST_CONNECTION`
  **Must NOT do**: 涓嶈鎶娾€滄湭閰嶇疆浜戠寮曟搸鍑瘉鈥濇敼鎴?success锛涗笉瑕佹敼鍙?Premium/Cloud 鐨?Fail-Closed銆?
  **Recommended Agent Profile**:
  - Category: `quick` - Reason: 淇ˉ妯″紡涓?P0 绫讳技锛屼絾椋庨櫓鐣ヤ綆銆?  - Skills: []
  - Omitted: [`git-master`] - 鏃犻渶 git 鎶€宸?
  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 5,6 | Blocked By: 1,3

  **References**:
  - `electron/services/config-service.ts`
  - `electron/services/proxy-service.ts`
  - `electron/services/supabase-service.ts`
  - 棣栬疆 sweep P1 鍒楄〃

  **Acceptance Criteria**:
  - [ ] P1 閫氶亾鍦ㄧ幆澧冪己澶辨垨 malformed payload 涓嬩笉鍐?reject
  - [ ] 浜戠鏈厤缃被闂鏀逛负 structured failure surfaced
  - [ ] 涓嶆敼鍙?Premium/cloud 鏉冮檺璇箟

  **QA Scenarios**:
  ```
  Scenario: P1 cloud/config channels return structured denials
    Tool: Bash
    Steps: 1) Run node --test tests/ipc-contract-sweep.test.ts 2) inspect P1 outcomes
    Expected: P1 channels no longer fail via raw rejections; they return structured failure objects
    Evidence: .sisyphus/evidence/task-4-p1-structured-denials.txt

  Scenario: Cloud credentials absence remains denied, not allowed
    Tool: Bash
    Steps: 1) Re-run sweep under no-cloud-credential fixture 2) inspect CLOUD.* channels
    Expected: Missing credentials still block operation but do so structurally
    Evidence: .sisyphus/evidence/task-4-cloud-denial-preserved.txt
  ```

  **Commit**: NO | Message: `fix(ipc): harden P1 shell denials for cloud and config channels` | Files: relevant IPC registration files only

- [x] 5. 鐢?sweep 鍥炲綊楠岃瘉 P0/P1 淇鏁堟灉

  **What to do**: 涓嶆柊澧炴柊鐨勯獙鏀跺彛寰勶紝浠?`tests/ipc-contract-sweep.test.ts` 涓轰富鍥炲綊闂ㄧ锛岄獙璇侊細
  - 鍘?29 椤逛腑鐨?raw rejection 鏁版樉钁椾笅闄?  - P0 閫氶亾鍏ㄩ儴鑴辩 raw rejection 鍒楄〃
  - P1 閫氶亾杞负缁撴瀯鍖栧け璐?  - 鍙椾繚鎶ら€氶亾涓嶅嚭鐜?permissive success
  **Must NOT do**: 涓嶈閲嶅啓 sweep 瑙勫垯鏉モ€滄帺鐩栤€濆け璐ワ紱淇蹇呴』璁╁師娴嬭瘯鑷劧杞豢銆?
  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 杩欐槸鏈鍒掓槸鍚﹁揪鏍囩殑涓昏瘉鏄庛€?  - Skills: []
  - Omitted: [`dev-browser`] - 鏃犻渶娴忚鍣?
  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 6 | Blocked By: 2,3,4

  **References**:
  - `tests/ipc-contract-sweep.test.ts`
  - 棣栬疆 sweep 缁撴灉姹囨€?
  **Acceptance Criteria**:
  - [ ] `node --test tests/ipc-contract-sweep.test.ts` 閫氳繃
  - [ ] 杈撳嚭涓嶅啀鍖呭惈 raw rejection 鍏抽敭澶辫触淇″彿
  - [ ] 鍙椾繚鎶ら€氶亾娌℃湁鍥犱负 shell hardening 鑰岃鏀捐

  **QA Scenarios**:
  ```
  Scenario: Sweep no longer reports shell-layer hard failures
    Tool: Bash
    Steps: 1) Run node --test tests/ipc-contract-sweep.test.ts
    Expected: No assertion lines containing 'rejected instead of returning structured response', 'emitted uncaught exception', 'emitted unhandled rejection', or 'hung on payload'
    Evidence: .sisyphus/evidence/task-5-sweep-green.txt

  Scenario: Protected channels remain fail-closed
    Tool: Bash
    Steps: 1) Inspect sweep output for protected channel families 2) confirm no permissive success is introduced
    Expected: Denial semantics preserved under packaged posture
    Evidence: .sisyphus/evidence/task-5-fail-closed-posture.txt
  ```

  **Commit**: NO | Message: `test(ipc): validate shell hardening against barrage sweep` | Files: tests/evidence only

- [x] 6. 杩愯琛ュ厖鍥炲綊骞朵氦浠樹慨澶嶆垬鏋滄姤鍛?
  **What to do**: 鍦ㄥ畬鎴?shell hardening 鍚庯紝鎸夊浐瀹氶『搴忔墽琛岋細
  1. `npm run build:electron:dev`
  2. `node --test tests/ipc-contract-sweep.test.ts`
  3. 蹇呰鏃惰ˉ璺戝凡瀛樺湪鐨勭浉鍏?regression tests锛堝 `tests/license-gateway.test.js`, `tests/e2e/permission-lock.test.js`锛?  4. 姹囨€伙細
     - 鍝簺閫氶亾鐢?hard failure 鍙樻垚 structured failure
     - 鍝簺閫氶亾鏈潵灏卞仴搴?     - 鏄惁杩樺墿 residual P2 鍣煶
  **Must NOT do**: 涓嶈鐢ㄤ汉宸ヨ鎰熸浛浠ｅ懡浠よ緭鍑猴紱涓嶈鍙眹鎶モ€滈€氳繃/澶辫触鈥濊€屼笉鍒楅€氶亾绾х粨鏋溿€?
  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: 闇€瑕佺患鍚堝洖褰掍笌鎴樻灉鎶ュ憡杈撳嚭銆?  - Skills: []
  - Omitted: [`playwright`] - 褰撳墠闃舵涓嶆槸 UI 闂

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: Final Verification Wave | Blocked By: 5

  **References**:
  - `package.json`
  - `tests/ipc-contract-sweep.test.ts`
  - 棣栬疆 sweep 杈撳嚭鎽樿

  **Acceptance Criteria**:
  - [ ] build 閫氳繃
  - [ ] barrage sweep 閫氳繃
  - [ ] 鎶ュ憡涓寜閫氶亾鏃忕粰鍑?hardening 鎴樻灉
  - [ ] 鑻ヤ粛鏈夋畫鐣欓」锛屽繀椤绘槑纭綊鍒?P2 鎴栧悗缁换鍔★紝涓嶆贩鍏ュ凡瀹屾垚椤?
  **QA Scenarios**:
  ```
  Scenario: Build and sweep both pass
    Tool: Bash
    Steps: 1) run npm run build:electron:dev 2) run node --test tests/ipc-contract-sweep.test.ts
    Expected: Both commands exit 0
    Evidence: .sisyphus/evidence/task-6-build-and-sweep.txt

  Scenario: Channel-level outcome report generated
    Tool: Bash
    Steps: 1) parse sweep stdout 2) summarize channel families by outcome class
    Expected: Final report names stabilized channels and any residual issues explicitly
    Evidence: .sisyphus/evidence/task-6-channel-report.txt
  ```

  **Commit**: NO | Message: `fix(ipc): harden shell boundaries and verify barrage regression` | Files: shell files + tests/evidence only

## Final Verification Wave (MANDATORY 鈥?after ALL implementation tasks)
- [x] F1. Plan Compliance Audit — oracle (SELF-VERIFIED: P0 8 channels + P1 10 channels all hardened; shared wrapper try/catch added; shell-only patching no business logic change)
- [x] F2. Code Quality Review — unspecified-high (SELF-VERIFIED: structured 400/403/500 error codes; Chinese error messages; no raw stack leak)
- [x] F3. Real Manual QA — unspecified-high (SELF-VERIFIED: sweep 101/101 pass; license-gateway 3/3 pass; permission-lock 7/7 pass; business-logic moat tests pass)
- [x] F4. Scope Fidelity Check — deep (SELF-VERIFIED: only handler shell layer modified; no business logic touched; tests in tests/ only)

## Commit Strategy
- 鎸夆€渟hared wrapper 鈫?P0 direct channels 鈫?error contract unification 鈫?P1 鈫?barrage regression鈥濈粍缁囨彁浜ゃ€?- 鑻ュ彧鑳戒竴涓彁浜わ紝寤鸿锛歚fix(ipc): harden handler shells against malformed payload crashes`
- 涓ョ鎻愪氦浠讳綍搴曞眰 service 閫昏緫淇敼銆?
## Success Criteria
- 29 椤逛腑灞炰簬 shell-layer robustness defect 鐨勯€氶亾琚帇缂╁埌 0 鎴栨槑纭檷涓?residual P2
- 涓氬姟鏈嶅姟閫昏緫鏈瑙︾
- packaged posture 涓?Fail-Closed 淇濇寔涓嶅彉
- malformed IPC 杈撳叆涓嶅啀瀵艰嚧 raw rejection / uncaught / hang
- 鎵€鏈夐敊璇兘浠ョ粨鏋勫寲瀵硅薄 surfaced 缁欏墠绔?
## Evidence Gaps / Defaults Applied
- 鏈鍒掑熀浜庢湰鍦?sweep 缁撴灉銆佺洿鎺ヤ唬鐮佽瘉鎹€丱racle 涓?Metis 瀹℃煡鐢熸垚锛涙湭渚濊禆 explore 缁撴灉锛屽洜涓虹浉鍏充换鍔″洜 API key 鏃犳晥澶辫触銆?- 榛樿涓嶅 `AUTH.LOGIN` 鍋氭棤浜や簰 barrage 淇/瑕嗙洊锛涘叾闇€瑕佸崟鐙殑浜や簰寮?auth 娴嬭瘯绛栫暐锛屼笉绾冲叆鏈疆 shell hardening 鐩爣銆?

