# 开发环境授权白名单修复计划

## TL;DR

> **问题**: `resolveLicenseTier()` 已经在开发环境下自动返回 `premium`，但 `ensureTrialAccess()` 没有同步豁免逻辑，导致本地 `npm run dev` 时依然触发 Fail-Closed 拦截，UI 显示“当前授权已失效”。
>
> **目标**: 在**仅限开发环境**（`!app.isPackaged` 或现有的 regression harness 条件）下，对 `ensureTrialAccess()` / 实际拦截链增加安全白名单放行，模拟高级版（Premium）可用状态；并保证**打包后的生产环境绝对不会生效**。
>
> **Deliverables**:
> - `electron/services/license-service.ts`：为 `ensureTrialAccess` 增加开发环境豁免
> - 必要时补充测试：验证 dev 放行、packaged 仍严格拦截
> - 全量测试通过，生产路径零回归

---

## 根因定位

### 已确认的逻辑不一致

#### 1. `resolveLicenseTier()` 已有开发豁免
**位置**: `electron/services/license-service.ts:535-547`
```ts
const resolveLicenseTier = async (): Promise<LicenseTier> => {
  if (!app.isPackaged) return 'premium'
  ...
}
```

这意味着：
- 本地开发环境（`npm run dev`）会被视为 `premium`
- UI 层/套餐层逻辑默认按高级版展示

#### 2. `ensureTrialAccess()` 没有开发豁免
**位置**: `electron/services/license-service.ts:393-427`
```ts
export const ensureTrialAccess = (...) => {
  if (!store) return null
  const claims = licenseGuard.getStoredClaims()
  if (claims && claims.status === 'active' && claims.expiresAt > Date.now()) {
    return null
  }

  const trialStatus = checkTrialStatus(store)
  ...
  if (trialStatus.available) {
    return {
      success: false,
      error: 'TRIAL_EXPIRED',
      message: `${operationName}不可用：请先开启试用或完成授权`,
      operationName,
      code: 403,
    }
  }

  return null
}
```

这意味着：
- 本地开发环境没有有效 claims 时
- 仍然走 trial 检查和 Fail-Closed 兜底
- 最终被拦截（即使 UI/套餐判断认为自己是 premium）

#### 3. `license-guard.ts` 也已有开发模式豁免传统
**位置**: `electron/security/license-guard.ts:149-162`
```ts
if (process.env.NODE_ENV !== 'development') {
  throw createGuardError('生产环境缺少授权校验服务配置', 503)
}

return {
  status: expiresAt > Date.now() ? 'active' : 'expired',
  ...,
  plan: looksValid ? 'enterprise' : 'basic',
}
```

这证明当前架构本来就允许：
- **开发环境宽松 / 生产环境严格**
- 所以上次修复的 Fail-Closed 补丁只需要补一个开发环境白名单即可恢复系统一致性

---

## 修复原则

### 安全目标
必须同时满足：
1. **开发环境本地调试完全放行**
2. **生产环境打包后绝不放行**
3. **Regression harness 保持现有测试能力**
4. **不破坏已修复的 Fail-Closed 生产安全链**

### 推荐策略
不要在很多地方散落判断；而是在 `ensureTrialAccess()` 开头增加一个统一的开发环境白名单函数，例如：

```ts
const shouldBypassLicenseInDev = () => !app.isPackaged || isRegressionDevHarnessEnabled()
```

然后在 `ensureTrialAccess()` 顶部加：

```ts
if (shouldBypassLicenseInDev()) {
  return null
}
```

### 为什么这比“伪造 claims”更安全
更推荐**只在拦截点放行**，而不是修改 `licenseGuard.getStoredClaims()` 返回伪造 Premium claims：

**方案 A：拦截点直接 return null（推荐）**
- 优点：最小改动，只影响试用期拦截层
- 优点：不会污染 claims 存储，不会影响生产授权数据
- 优点：清晰表达“开发环境跳过试用拦截”
- 风险：某些后续 `requireFeature()` 路径如果没有 dev fallback，可能还需要二次补齐

**方案 B：伪造 active premium claims（不推荐作为第一选择）**
- 风险：容易把开发假授权渗透到更多业务链路
- 风险：如果持久化或误复用，会污染生产路径
- 风险：更难证明“生产绝不生效”

所以第一阶段应优先做 **方案 A：只在 `ensureTrialAccess()` 增加 dev bypass**。

---

## 变更范围

### 主改动点
#### `electron/services/license-service.ts`

**新增函数**（建议放在 `ensureTrialAccess` 上方附近）：
```ts
const shouldBypassLicenseInDev = () => !app.isPackaged || isRegressionDevHarnessEnabled()
```

**修改函数**：`ensureTrialAccess()`

当前：
```ts
export const ensureTrialAccess = (...) => {
  if (!store) return null
  const claims = licenseGuard.getStoredClaims()
  ...
}
```

修改后：
```ts
export const ensureTrialAccess = (...) => {
  if (!store) return null

  if (shouldBypassLicenseInDev()) {
    return null
  }

  const claims = licenseGuard.getStoredClaims()
  ...
}
```

---

## 风险评估

### 风险 1：开发白名单泄漏到生产
**风险等级**: 🔴 高

**防线**:
- 只使用 `!app.isPackaged` 和现有 `isRegressionDevHarnessEnabled()`
- 不使用易被误设的单纯 `NODE_ENV === 'development'` 作为唯一条件
- 因为 Electron 打包后 `app.isPackaged === true`，所以生产安装包天然失效

### 风险 2：仅绕过 trial 拦截，但 feature gate 仍拒绝
**风险等级**: 🟡 中

`registerSecureFeatureIpc()` 的执行链是：
1. `registerSecureIpc()` → `ensureTrialAccess()`
2. 然后再执行 `licenseGuard.requireFeature()` / `requireAnyFeature()`

如果开发环境里 `licenseGuard` 本身没有返回合适 claims，则仍可能在 feature 层被拒绝。

**需要在执行阶段额外验证这些场景**：
- `search:execute`
- `analysis:generate`
- `automation:verify-emails`
- `automation:start-campaign`

如果仅修 `ensureTrialAccess()` 还不够，就需要第二阶段计划：让 `license-guard` 在 dev 模式返回模拟高级版 claims，但该步骤应作为**备选方案**，不是第一刀。

### 风险 3：Regression harness 被误伤
**风险等级**: 🟡 中

`isRegressionDevHarnessEnabled()` 现在依赖：
```ts
process.env.KONE_REGRESSION_TEST === '1' && !app.isPackaged
```

如果我们直接用 `!app.isPackaged`，实际上已覆盖 regression harness。
因此：
- 可以直接只用 `!app.isPackaged`
- 也可以显式保留 `isRegressionDevHarnessEnabled()` 以强调测试环境兼容

建议：
```ts
const shouldBypassLicenseInDev = () => !app.isPackaged || isRegressionDevHarnessEnabled()
```
虽然第二项逻辑上被第一项覆盖，但语义更清晰。

---

## 执行计划

### Task 1 — 增加开发环境白名单判断
**文件**: `electron/services/license-service.ts`

**改动**:
1. 新增 `shouldBypassLicenseInDev()`
2. 在 `ensureTrialAccess()` 顶部加早返回

**验收点**:
- 开发环境 `npm run dev` 不再出现“当前授权已失效”
- 生产逻辑分支未改动

---

### Task 2 — 验证 feature gate 是否仍有拦截
**检查路径**:
- `search:execute`
- `analysis:generate`
- `automation:verify-emails`
- `automation:start-campaign`
- 任意 `registerSecureFeatureIpc` 的高级能力

**目的**:
确认只修 `ensureTrialAccess()` 是否已经足够恢复本地调试体验。

**若发现仍被 feature gate 拒绝**:
进入备选修复：
- 在 `license-guard` 的开发环境分支中统一返回模拟 Premium claims
- 但必须严格锁死在 `!app.isPackaged` 下

---

### Task 3 — 测试补充
建议新增/补充测试：

#### 测试 A：开发环境 bypass
- mock `app.isPackaged = false`
- `ensureTrialAccess()` 应直接返回 `null`
- 即使无 claims、无 trial anchor 也不拦截

#### 测试 B：生产环境严格拦截
- mock `app.isPackaged = true`
- 无 claims + 无 trial anchor
- 应继续返回 `TRIAL_EXPIRED`

#### 测试 C：packaged + active claims 正常放行
- 防止破坏原有授权链

---

## 推荐最终实现形态

### 最小安全实现
```ts
const shouldBypassLicenseInDev = () => !app.isPackaged || isRegressionDevHarnessEnabled()

export const ensureTrialAccess = (
  store: ConfigStore | undefined,
  licenseGuard: ReturnType<typeof import('../security/license-guard').createLicenseGuard>,
  operationName: string,
) => {
  if (!store) return null

  if (shouldBypassLicenseInDev()) {
    return null
  }

  const claims = licenseGuard.getStoredClaims()
  if (claims && claims.status === 'active' && claims.expiresAt > Date.now()) {
    return null
  }

  const trialStatus = checkTrialStatus(store)
  ...
}
```

### 备选增强版（仅在必要时）
如果 Task 2 发现 feature gate 仍拦截，则再补：
- 在 dev 模式下让 `license-guard` 返回模拟的 active premium claims
- 但必须确保该分支只在 `!app.isPackaged` 下成立

---

## 成功标准

### 开发环境
- `npm run dev` 启动后 UI 不再提示“当前授权已失效”
- 本地调试可正常访问搜索、分析、高级功能页面

### 生产环境
- 打包环境 `app.isPackaged === true`
- 无有效授权时仍严格 Fail-Closed
- 现有 `TRIAL_EXPIRED` / `SYSTEM_TIME_ABNORMAL` / `FEATURE_DENIED` 流程不变

### 回归验证
- 现有授权测试继续通过
- 新增 dev bypass 测试通过
- 生产路径无回归

---

## 建议计划文件名
`.sisyphus/plans/dev-license-bypass-fix.md`
