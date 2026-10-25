# KONE UI AND STATE AGENT PROTOCOL

## 1. Visual Positioning
Kone is an industrial B2B SaaS workspace. The UI must remain disciplined, quiet, and operationally clear. Any consumer-style decoration that weakens trust, hierarchy, or data readability is forbidden.

### 1.3 Localization
Kone 面向国内中小外贸企业，所有的 UI 操作界面（按钮、表单、状态栏、Toast 提示、弹窗文案）必须强制保持纯正的【简体中文】显示，严禁在面向用户的可视区域使用未翻译的英文词汇（专有品牌词如 AI, N8N, B2B, LLM 除外）。

---

## 2. Structured 3+1 Palette

### 2.1 Neutral foundation
Use neutral tones for roughly 80 percent of the interface.
- app background: `bg-slate-50`
- immersive sidebar: `bg-slate-950`
- main containers: `bg-white border-slate-200`
- headline text: `text-slate-900`
- body text: `text-slate-700`
- auxiliary text on light surfaces: `text-slate-500`
- auxiliary text on dark surfaces: `text-slate-400`

### 2.2 Primary brand blue
Primary action and active selection must converge on:
- `bg-blue-600 text-white hover:bg-blue-700`
- active text/icon state: `text-blue-600`
- direct website links: `#2563eb` / `text-blue-600`

Allowed uses:
- main search
- save/confirm/submit/export primary intent
- active navigation item
- high-confidence score emphasis
- website direct links

Forbidden uses:
- green/orange/purple main action buttons
- gradient branding for core workflow affordances

### 2.3 Semantic accents
Semantic colors are allowed only for meaning, never decoration.
- success: `emerald-600`
- premium or pending reminder: `amber-500`
- destructive or serious warning: `rose-600`

### 2.4 Secondary structural action style
Secondary buttons must default to:
- `bg-white border border-slate-300 text-slate-700 hover:bg-slate-50`

Disabled state must remain quiet:
- `bg-slate-100 text-slate-400 cursor-not-allowed`

---

## 3. Z-Index and Surface Guard
1. `Select`, `DropdownMenu`, `Popover`, and equivalent overlays must render above dense data surfaces.
2. Content layers must use strong overlay protection such as `z-50 bg-white border-slate-200 shadow-md`.
3. Never allow dropdowns or select lists to be visually contaminated by tables, charts, or card grids beneath them.

---

## 4. ICP Scoring UX Rules

### 4.1 Progressive rendering law
Search UI must communicate the real Scout -> Brain sequence:
1. lead skeleton arrives first
2. score arrives later
3. user sees progress rather than a blocked blank page

### 4.2 Unscored state presentation
When `matchScore` is not a valid number, the UI must present an explicit in-progress or pending state.
Approved wording includes:
- `待评估`
- `评估中...`
- `AI 正在分析该线索...`

Forbidden:
- showing fake `0%`
- collapsing missing score into a failure state without explanation
- showing broken numeric artifacts like `NaN%` or `0NaN%`

### 4.3 Skeleton and motion requirement
For ICP scoring in progress, add restrained, low-noise visual feedback:
- row-level shimmer or pulse skeleton for score cell only
- subtle progress copy tied to stream stage
- never animate the full table aggressively

### 4.4 Score color semantics
Score feedback must stay restrained:
- high-value scored leads: emphasize with blue family
- unscored or low-signal leads: neutral gray family
- destructive red only for genuine error or blocked state, not low commercial fit alone

### 4.5 Degraded-state copy law
When scoring is downgraded but the system remains usable, UI copy must stay in calm Simplified Chinese.
Approved degraded wording includes:
- `待人工复核`
- `盲评中`
- `基于简介轻量评估（官网无法访问）`
- `官网无法访问，建议人工复核`

Forbidden degraded wording:
- frightening red failure copy for normal fallback
- untranslated English phrases like `fallback`, `manual review`, `blind score`

---

## 5. Resilience and Data-Retention UX
1. On 429 or network interruption, preserve existing `searchResults` and saved leads.
2. Use toast plus inline warning surfaces rather than destructive resets.
3. A failed AI enhancement may degrade visual status, but it must not wipe the operator's acquired list.
4. Trial expiry or Premium lock must block future action cleanly without flashing protected content first.

### 5.1 高敏感字段防呆规范
1. 对影响搜索通断的输入字段（如目标城市、目标国家/地区、搜索源、质量控制开关）必须提供视觉增强与即时引导。
2. 关键字段可使用红色 `*`、辅助文案、非阻塞轻提示等方式，明确说明错误输入的后果与系统自愈路径。
3. 对搜索降级链路相关字段，提示文案必须提前告知系统会自动切换而非静默失败。
4. 防呆提示必须保持专业、克制、简体中文，不得使用恐慌式错误表达。

#### 5.1.1 目标城市规范样板
1. `目标城市` 属于搜索高敏感字段，标签后必须加红色星号。
2. 输入框下方必须附带说明文案，明确提示 Google Maps 依赖具体城市名。
3. 当城市识别受阻或输入不精确时，兜底提示必须说明系统会自动扩大识别范围或切换到网页补位，而不是静默失败。
4. 错误输入场景的提示必须保持非阻塞、专业、简体中文，不得制造恐慌或误导用户认为系统已彻底失败。

### 5.2 降级透明化强制规则
1. 第零级 AnySearch 穿透时，UI 必须显示：`🤖 AnySearch 正在通过全网海关数据、全球展会名录及社媒多渠道深度穿透高管决策人...`
2. 二级关键词容错时，UI 必须显示：`地图定位受限，正在尝试扩大识别范围...`
3. 三级 Organic 补位时，UI 必须显示：`未发现地图商户，已自动为您补位全局网页线索...`
4. 降级文案必须通过后端状态语义驱动，不能依赖用户自行猜测。
5. 缺失 AI 密钥属于可恢复降级状态，前端必须以 Amber 或等价的非阻塞方式展示提醒，不得误报为致命错误。

### 5.3 高级质量控制闭环
1. `优先官网`、`优先本土域名`、`只看高相关`、`优先 B2B 角色词` 等高级质量控制模块属于搜索确定性的核心，不得移除或仅保留视觉外壳。
2. UI 勾选状态必须作为契约入参透传至主进程。
3. 主进程必须依据该配置在 Scout 阶段执行真实过滤与排序，确保所见即所得。
4. 若前端可见但后端未挂载逻辑，视为严重违例。

### 5.4 多源数据徽标规范 (V1.3)
1. 搜索数据源选择器标签使用纯简体中文，不得含英文辅助文案。
2. 数据源徽标颜色按来源分类：海关提单 `emerald`、展会名录 `amber`、行业黄页 `purple`、LinkedIn `blue`、Facebook `blue`、Google Maps `blue`、网页搜索 `slate`。
3. 决策人、海关数据、展会足迹徽标以非侵入方式展示在线索卡片头部区域。
4. 多源覆盖率统计卡片在数据中心页面使用水平条形图展示来源分布。

---

## 6. Search Card Interaction Closure
1. `website` 字段若存在，必须渲染为可点击外链，而不是纯文本。
2. 外链必须使用：
   - `target="_blank"`
   - `rel="noopener noreferrer"`
3. 链接视觉必须体现“直达跳转”感，但保持克制：
   - `text-blue-600`
   - hover 可提升到 `text-blue-700`
   - 可使用下划线或轻量外链图标
4. 外链打开后，不得打断用户回到软件继续执行“一键保存”闭环。

---

## 7. Autopilot Panel Quietness Rules
Autopilot is a background companion panel, not the hero surface.

1. The panel must feel low-noise and operational.
2. Show only essential telemetry:
   - lifecycle
   - current job
   - discovered
   - qualified
   - saved
   - deduped
   - last error
3. Avoid celebratory colors, pulsing gradients, or dashboard-style overstatement.
4. Prefer neutral shells with selective blue emphasis for active running state.
5. Error presentation should be concise and serious, not visually explosive.
6. Autopilot must visually read as local background execution, not remote cloud automation.

---

## 8. Commercial UX Guardrails
1. Trial is 7-day time-boxed access to the local Basic experience.
2. Basic users may access local search, ICP scoring, analysis, and Autopilot.
3. Premium-only views and actions must remain clearly locked until authorization succeeds.
4. Paywall or blocked-state surfaces must avoid flashing protected data beneath them.
5. Upgrade prompts must stay professional and conversion-oriented, not manipulative.

---

## 9. V1.3 Multi-Agent Panel UX Rules

### 9.1 AgentsPanel (`/agents`)
1. Three agent cards (WhatsApp/LinkedIn/Email) render in a responsive 3-column grid.
2. Each card shows: agent label, description, progress bar, daily quota, success/fail counts.
3. Start button text: `启动智能体` or `启动`; Stop: `停止`; Pause: `暂停`.
4. Trial users must see only an upgrade/promo surface, not live agent metrics.
5. Paid Basic users may see Email and low-volume WhatsApp Web cards when configured; LinkedIn is Premium/Enterprise only and must be clearly labeled as read-only Profile辅助 + AI 文案生成, not auto outreach.
6. Locked or unavailable capabilities show lock icon + upgrade CTA, but must not expose fake progress metrics.
7. Email agent checks for connected email sandbox before allowing start; shows failure toast if no SMTP/IMAP account connected.
8. Daily quota badge visible at panel top; WhatsApp Basic low-volume limit and Email Basic daily cap (authoritative values: `kone-PRD.md §零.3`) must be displayed clearly.
9. Autopilot physical boundary warning banner: `本地 AI 智能体群正在安全复用您本机的住宅网络和独立沙箱环境...`
10. LinkedIn UI must never show `自动加好友`、`自动私信` or equivalent wording. Approved wording: `浏览 Profile`、`生成破冰文案`、`复制文案人工触达`。

### 9.2 AccountsManagement (`/accounts`)
1. "Add account sandbox" cards display 5 account types: SMTP, IMAP, LinkedIn, Facebook, WhatsApp.
2. Each card shows the account type icon, label, and description.
3. Locked cards show semi-transparent overlay with `升级解锁` or `需配置账号` badge. WhatsApp Web Basic may be enabled as low-volume local session; WhatsApp Cloud API remains Premium.
4. Email cards show `基础版仅支持 1 个邮箱实例` when Basic user already has one connected.
5. Connected account cards display: connection status badge (已连接/已断开/被限速/异常), last health check timestamp, disconnect button.
6. Empty state shows shield icon with operational guide text.

### 9.3 DNS Health Check Warning UX
1. DNS health check result displays as compact info/warning card.
2. Green (passed): `域名信誉合格` with MX/SPF/DKIM/DMARC check results.
3. Red (failed): `域名合规告警` with specific error reason (missing SPF/DKIM/blacklisted).
4. Campaign send button becomes `disabled` when DNS check has errors.
5. Disabled state shows red warning bar: `发信域名存在安全风险，发送按钮已软锁定`.

---

## 10. Tech and State Rules
1. Tailwind syntax must remain compatible with Tailwind CSS v4 (the project upgraded from v3.4; v4-only class availability and the dead-class pitfall for custom `animate-*` names must be considered).
2. Cross-component operational state belongs in Zustand.
3. UI should read from store truth instead of duplicating business state locally when the state spans components or pages.
4. Any score-derived aggregate shown in UI must filter invalid numeric values first.
5. UI optimization should prefer low-noise rendering and avoid effects that burden low-spec office machines.
6. V1.3 agent and account status use `onAgentStatusChanged`/`onAccountStatusUpdate` listeners, not polling.
7. Data source label/color mappings must use shared constants (avoid per-component ternary chains for DataSourceType display).
8. Localized-search progress must be displayed through backend stage events in Simplified Chinese; renderer must not infer country language on its own.
9. Agent success UI must be driven by backend `AgentState` and persistent `LeadItem.agentStatus`; no frontend-only optimistic success counters.
