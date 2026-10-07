# 外贸B2B AI商机智能获客最佳实践落地SOP

> ## 🧭 文档定位：方法论北极星（非实装规格）
>
> 本文是**通用外贸获客方法论 / 战略愿景北极星（Methodology North-Star）**，用于指导产品方向与触达打法，**不是 Kone 的实装开发规格，未纳入强制读链（AGENTS.md 的 10 份文档链）**。
>
> **裁决规则**：本文有价值的增量（评分严谨性、触达方法论）**应按分层方式吸收进 `kone-PRD`**；仅当确实无法调和时（技术栈、平台口径）才以 `kone-PRD.md`（V1.3 全局唯一权威）为准。已知差异点与处置：
>
> | 本文主张 | 处置 |
> |---|---|
> | 评分公式 `Eligibility Gate ×(ICP 55% + Intent 35% + Evidence 10%) − Risk Penalty`（§二） | ✅ **已按分层吸收**至 `kone-PRD §0.5.1`：Eligibility Gate→Scout 准入硬门、Intent 采购意图 / 分级 Risk Penalty→Stage-2 LLM 机会分；确定性预筛 40/30/20/10 保留为 Stage-1（`§零.3`）。二者分属不同阶段、**非取舍关系**——本文该模型更精细严谨，尤其补齐了当前缺失的"采购意图 Why-Now"，值得落地 |
> | 技术栈 FastAPI + SQLite + "坚决不做 Electron/桌面打包"（§七） | ⛔ 以 kone-PRD 为准：Kone **就是 Electron 33 + React 19 + TypeScript 本地桌面应用**（`ARCH-STANDARDS.md`）。本文技术选型属通用 MVP 建议，不适用于本产品 |
> | "坚决不做多账号指纹"（§七） | ⛔ 以 kone-PRD 为准：Kone 交付 `session.fromPartition` 本地多账号沙箱多开（合规低量、只读辅助口径，`kone-PRD §六`） |
> | 指定模型 DeepSeek-V3 + Claude 3.5/GPT-4o（§三） | ⛔ 以 kone-PRD 为准：产品 **BYO-Key、模型无关**，不绑定特定供应商 |
>
> **已吸收的增量价值**（均以"增量目标 `[路线图]`"形式登记，落地前不谎称已实现）：**机会分模型**（Eligibility Gate + Intent 采购意图 + 分级 Risk Penalty，登记于 `kone-PRD §0.5.1`）；14 天全渠道触达节律、冷邮件域名矩阵与送达率红线、邮箱有效性五级分级、证据质量 A/B/C/D 分级、商机智能卡结构（登记于 `kone-PRD §六.4`）。

## 一、 顶层战略与范式转移 (Strategy & Philosophy)
### 模式重塑：从暴力群发转向情报中台
- 淘汰模式 (Spray & Pray)
  - 全网暴力采集公开联系方式
  - 模板化批量冷邮件群发
  - 导致高退信、高投诉与域名/账号封禁
  - 投入产出比恶化 (负向 ROI)
- 现代模式 (Intelligence-Driven)
  - 监听真实商业采购与业务变化意图信号
  - 规则代码与轻量 AI 分层清洗过滤
  - 目标官网与供应链战略缺口深度研读
  - 装配输出高确定性商机智能卡
  - 人机协同 (HITL) 精准触达与转化
### 人机分工原则 (Human-in-the-Loop)
- 机器自动化 (80% 脏活累活)
  - 多源数据发现与公开线索搜集
  - 规则级与代码级零成本硬过滤
  - 瀑布流数据补全与邮箱可用性验证
  - 意图识别、多维打分与事实提炼
  - 150词内千人千面开发信草稿生成
- 人类业务员 (20% 核心高价值节点)
  - 商机情报卡事实与逻辑复核
  - 关键决策人真实人际社交连接
  - 针对性方案报价与深度商务谈判
  - 最终订单签约、交付与成交转化
### 核心准则与价值锚点
- 商机纯度与成交确定性 > 名单触达数量与规模
- 真实采购意图 (Intent) > 单纯联系方式获取
- 数据资产私有化沉淀 > 临时自动化黑客对抗

## 二、 核心算法与四层决策模型 (Scoring & Decision Engine)
### 综合评分公式架构
- `Final Opportunity Score = Eligibility Gate × (ICP Fit × 55% + Intent × 35% + Evidence × 10%) - Risk Penalty`
### 准入资格硬否决 (Eligibility Gate, 0/1一票否决)
- 明确 B2C / Retail 零售终端
- Repair 维修服务 / Used 二手设备翻新
- Marketplace 电商平台卖家 (Amazon, eBay, AliExpress, Shopee)
- Blog 个人博客 / 纯行业资讯站 / 论坛门户
- 黑名单行业、被制裁国家与高风险结算区域
- 内部 CRM 数据库中保护期内的重复企业
### 软性风险扣分 (Risk Penalty, 0~20分区间，保护隐形冠军)
- 仅有公共通用邮箱 (Gmail, Outlook, Yahoo) 扣 10 分
- 仅有企业通用前缀 (info@, sales@, contact@) 扣 5 分
- 核心采购决策人 (Buyer, Sourcing Specialist) 未识别 扣 5 分
- 官网架构极度简陋或业务规模难以直接判定 扣 5 分
### 行业化 ICP 匹配模型 (ICP Fit, 权重 55%)
- 产品与应用匹配 (30%)
  - 客户官网销售关联产品
  - 存在对应工业/商业应用场景
  - 具备系统集成与选配空间
- 企业定位与商业模式 (20%)
  - 分销商 (Distributor)
  - 进口商 (Importer)
  - 系统集成商 (EPC / System Integrator)
  - 品牌商 / OEM / ODM 工厂
- 市场与区域覆盖 (15%)
  - 主营业务覆盖目标国家/经济体
  - 具备本地仓储与分销网络
- 采购承载力 (15%)
  - 企业人员规模与分支机构体量
  - 产品线技术复杂度与潜在采购预算
- 商业模式与起订量对齐 (10%)
  - 标准品流通商还是工程定制商
  - 与自身工厂产能及起订量 (MOQ) 对齐
- 触达可实现性 (10%)
  - 域名解析活跃度与联系方式可验证性
  - 具备公开可联络的业务接口人
### 采购意图三维拆解 (Intent Score, 权重 35%)
- Tier S / 购买邻近信号 (Purchase Proximity, 权重 45%, 最高优先级)
  - 明确发布寻源需求 / RFQ / 招标公告 (Tender)
  - 招聘采购总监 / 供应链经理 (Procurement Manager / Sourcing)
  - 启动新产品产线量产或发布量产公告
  - 公开招募区域代理商与供应链合作伙伴 (Distributor Recruitment)
- Tier A / 产品相关信号 (Product Relevance, 权重 35%)
  - 官网新增配套产品线或系统集成目录
  - 取得目标市场新准入认证 (如 UL, CE, CB)
  - 报名参展即将举办的行业国际垂直展会
  - 新工厂投产或新增产线扩张公告
- Tier B / 业务变化信号 (Business Change, 权重 20%)
  - 采购/技术高管人事变动 (新官上任 90 天供应链调整期)
  - 宣布进军海外新区域市场
  - 研发与工程技术团队规模化扩招
### 证据质量分级 (Evidence Quality, 权重 10%)
- A 级证据 (置信度 100%)
  - 企业官网原文章节
  - 官方新闻稿与年报
  - 展会主办方官方参展商名录
- B 级证据 (置信度 80%)
  - 权威第三方行业垂直媒体报道
  - 专业行业协会官方名录
- C 级证据 (置信度 50%)
  - 搜索引擎聚合摘要
  - 公开社媒动态更新
- D 级证据 (置信度 20%)
  - LLM 逻辑推论 (必须显式标注 Hypothesis)

## 三、 阶梯式算力与成本控制漏斗 (Tiered LLM Funnel)
### Layer 0: 代码级零成本过滤 (成本 ≈ $0)
- 正则匹配与黑名单词库比对
- 域名可访问性与网络连通探测
- 国家、行业与本地 MD5 历史库排重
- 零 API 成本剔除 60%~70% 垃圾数据与噪声
### Layer 1: 轻量 LLM 结构化初筛
- 选用经济型模型 (DeepSeek-V3 / Flash 级模型)
- 仅抓取首页核心文本 (限制在 1000 Tokens 内)
- 强制输出标准化 JSON (主营产品、服务受众、初步 ICP 分)
- 分流标准：Score < 60 自动归档，Score ≥ 60 晋级深度层
### Layer 2: 证据链自动化采集
- 使用 Crawl4AI / Jina Reader 提取纯净 Markdown
- 定向抓取 About Us、Products、News、展会名录及招聘页面
- 彻底剔除导航栏、CSS/JS 及 Cookie 弹窗干扰
### Layer 3: AI 深度研读与缺口分析
- 提炼 Confirmed Facts (确认的产品线与参数)
- 推导 Strategic Gap (产品线缺失规格与供应链痛点)
- 识别 Target Persona (最适配的采购/技术负责人)
### Layer 4: 高价值商机卡装配
- 准入门槛：综合评分 Final Score ≥ 80
- 调用旗舰模型 (Claude 3.5 Sonnet / GPT-4o)
- 单向装配生成破冰切入点与 150 词内定制开发信草稿

## 四、 基础设施与发信/触达合规基建 (Infrastructure & Compliance)
### 冷邮件域名矩阵建设 (对标 2024-2026 网关新规)
- 域名隔离机制
  - 注册 2~3 个与主品牌相关的专用冷发辅助域名
  - 严禁使用企业主域名发送冷触达 (Cold Outreach)
- DNS 协议强制对齐
  - SPF：指定授权发信 IP 范围
  - DKIM：配置 2048 位加密签名
  - DMARC：强制生效并设置监控 (v=DMARC1; p=quarantine/p=none)
  - 强制配置 PTR (rDNS) 与 TLS 1.3 加密传输
- 自动化邮箱预热
  - 接入专业预热池阶梯递增发信
  - 预热 14~21 天至收件箱投递率稳定
- 指标硬性监控
  - Spam Complaint Rate 强制控制在 0.1% 以下
  - 投诉率达到 0.3% 硬上限将触发熔断机制
### 邮箱有效性分级验证 (摒弃单一 SMTP 握手迷信)
- Verified：语法正确、MX 正常、SMTP 握手确认存活 -> 优先进入主发信队列
- Probable：符合企业命名规律且域内有验证记录 -> 允许发送首轮定制信
- Catch_all：企业配置全域接收 -> 限制发信频次，依靠高质量内容防投诉
- Risky：临时邮箱、免费公共邮箱或有软退信记录 -> 降低优先级并扣除 Risk Penalty
- Invalid：MX 缺失、域名失效或返回 User Unknown -> 强制进入抑制列表 (Suppression List)
### 社媒合规与人际触达边界
- 杜绝外挂脚本
  - 严禁在底层依赖多账号指纹浏览器批量模拟加人
  - 规避违反 LinkedIn 官方 ToS 导致的封号与风控
- 渠道职能定位
  - 社媒作为业务员基于商机卡进行的 1-to-1 精准专业互动承接渠道

## 五、 核心交付物：商机智能卡标准结构 (Opportunity Card)
### 企业基本画像与综合评级
- 企业全称、目标国家、官方网址
- ICP Fit 得分、Intent 得分、Evidence 评级、Final Score 与等级 (A+/A/B)
- 扣分项明细 (Risk Penalty 具体扣分原因)
### Why Now 最佳联系时机证据库
- 新增产品线 / 系统集成目录记录 (Confirmed Fact)
- 行业垂直展会参展展位信息 (Confirmed Fact)
- 采购 / 供应链技术岗位招聘动态 (Evidence-backed Inference)
### 商业情报洞察与战略缺口 (Strategic Gap)
- 核心主营业务与目标终端市场定位
- 供应链痛点：交期长、认证不全、缺乏特定高压/大容量规格
### 推荐适配方案与产品型号
- 匹配我方优势产品规格 (如 51.2V 314Ah 工业级机架系统)
- 核心竞争力对齐 (如波兰本地仓 DDP 3-5天交货 / 完整 CE/UL 报告)
### 精准触达策略与定制开发信
- 推荐对接岗位 (Head of Supply Chain / Technical Director)
- 破冰切入角度 (Outreach Hook Angle)
- 150 词定制开发信草稿 (Hook + Bridge + Value + Soft CTA)

## 六、 14天跨渠道精准协同触达SOP (Omnichannel & HITL)
### 14天协同执行节律表
- Day 0
  - 系统自动化完成商机挖掘、清洗与情报卡生成
- Day 1 上午
  - 业务员复核商机卡，审核并微调定制开发信
- Day 1 下午
  - 发送第 1 封基于官网痛点与证据的深度定制冷邮件
- Day 3~5 (若无回复)
  - 业务员在 LinkedIn 手动搜索对接人，发送无推销感的同行交流申请
- Day 7~10 (若无回复)
  - 发送 Follow-up 1 邮件 (提供行业对比白皮书或本地仓现货清单)
- Day 12~14 (若无回复)
  - 发送 Follow-up 2 (Break-up 邮件，礼貌确认是否为合适接口人)
### 拟人化与行为控制
- 请求延迟：自动化请求注入 15~60 秒泊松随机延时
- 时区拟合：严格限制在目标客户当地工作时间 (09:00 - 18:00) 运行，夜间及周末休眠
### 人机协同 (HITL) 闭环响应
- AI 意图分类：自动解析客户回复 (明确询盘 / 转交他人 / 暂时拒绝 / 退订)
- 5分钟黄金响应：高意向询盘通过 Webhook 触发企微/飞书即时强提醒，业务员人工接管
- 全局防撞沉淀：触达过的域名与联系人自动打标归档，防止团队内部重复撞单

## 七、 中小外贸团队极简MVP技术栈与演进 (Architecture)
### MVP 极简技术选型 (单兵与微小团队首选)
- 前端交互：Web UI (Next.js / Vue 浏览器端，免去客户端打包、签名与更新泥潭)
- 业务中台：FastAPI (异步高性能核心，利用 Pydantic 强制约束 JSON Schema)
- 本地存储：SQLite (轻量单文件，采用 Repository Pattern 抽象设计)
- 算力调用：DeepSeek API (经济型初筛) + Claude 3.5 Sonnet / GPT-4o (深度生成)
- 搜索与解析：Serper.dev + Jina Reader / Crawl4AI (Markdown 提纯)
### MVP 坚决不做清单
- 坚决不做桌面客户端跨平台打包 (Tauri / Electron)
- 坚决不做多账号指纹黑客对抗与批量外挂机器人
- 坚决不做复杂双 Agent 内部辩论死循环 (避免浪费 Token 与超时报错)
- 坚决不做重型分布式数据库集群与全功能复杂 CRM
### 成熟阶段演进路线 (V2.0 规模化协同)
- 数据层演进：SQLite -> PostgreSQL (支持多业务员权限隔离与并发)
- 调度层演进：Cloudflare Workers + Queue 实现云端自动化编排（Phase 1）
- 资产层演进：打通自建开源 CRM (Twenty CRM / Mautic) 实现全生命周期管理

## 八、 七步全流程落地执行清单 (Checklist)
- Step 1: 多源发现
  - 导入垂直展会名录、官网目录及 Google 定向长尾词
- Step 2: 准入过滤
  - Layer 0 正则规则一票否决 B2C、维修点、电商卖家及黑名单
- Step 3: ICP 粗筛
  - Layer 1 轻量大模型输出 JSON，筛选 ICP Fit Score ≥ 60 的企业
- Step 4: 意图与证据校验
  - 提取产线变化与展会记录，完成 Intent 打分与置信度标记
- Step 5: AI 深度研读
  - 提炼客户供应链 Strategic Gap，与自身优势精准对齐
- Step 6: 商机卡交付
  - 自动装配 Final Score ≥ 80 的高确定性商机情报卡
- Step 7: 人机协同触达
  - 业务员审核商机卡并执行 14 天触达序列，数据反哺优化评分模型