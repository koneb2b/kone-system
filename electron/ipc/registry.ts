/**
 * IPC 通道注册中心
 *
 * 功能：
 * 1. 所有 handler 必须在注册中心登记，附带合约
 * 2. 启动时断言：所有已声明的 channel 都有 handler（防止漏注册）
 * 3. 运行时校验：请求/响应通过合约校验后转发给实际 handler
 * 4. 通道白名单：未注册的 channel renderer 无法调用
 */

import type { Contract, ContractEntry } from './contracts/types'
import { validateRequest, validateResponse, isContractDevMode } from './contracts/types'

/** 注册中心单例 */
class IpcRegistry {
  private entries = new Map<string, ContractEntry>()
  private _locked = false
  /** P0-4/续：已真实绑定到某个 ipcMain 实例的 channel 集合，按 ipcMain 实例隔离。
   *  用 WeakMap 跟踪每个 ipcMain 实例已绑定的 channel，使 `attach` 对同一实例幂等
   *  （production 主进程唯一 ipcMain 不会重复绑定触发 Electron 报错），同时允许
   *  不同的 ipcMain 实例（如 e2e / 独立测试各自 new 的 mock）都拿到自己的绑定；
   *  后注册的 channel 也会在下次 attach 时补齐到已绑定实例。 */
  private _boundTo = new WeakMap<object, Set<string>>()

  /** 注册一个 IPC handler */
  register<I, O>(channel: string, entry: ContractEntry<I, O>): void {
    if (this._locked) {
      throw new Error(`[Registry] 注册中心已锁定，无法注册 ${channel}`)
    }
    if (this.entries.has(channel)) {
      // P0-4/续：测试进程内 register*Handlers 可能被多个测试文件复用（registry 为全局单例），
      // 抛错会令跨文件单例污染整批用例崩溃；production 中 main.ts 每个通道仅注册一次，
      // 此处幂等覆盖不改变运行时行为。dev 模式给出可观测警告（仍保留"重复注册"可观测性）。
      if (isContractDevMode()) {
        console.warn(`[Registry] channel ${channel} 重复注册，幂等覆盖（测试复用或重复调用 register*Handlers）`)
      }
      this.entries.set(channel, entry as ContractEntry)
      return
    }
    this.entries.set(channel, entry as ContractEntry)
  }

  /** 获取 handler（经由合约校验） */
  async dispatch(channel: string, event: unknown, ...args: unknown[]): Promise<unknown> {
    const entry = this.entries.get(channel)
    if (!entry) {
      const error = `[Registry] 未知通道: ${channel}`
      if (isContractDevMode()) {
        console.error(error)
        throw new Error(error)
      }
      return { success: false, error }
    }

    const { contract, handler, skipValidation } = entry

    // 请求校验
    const request = args[0]
    if (!skipValidation) {
      const valid = validateRequest(contract, request)
      if (!valid.valid) {
        return { success: false, error: valid.error }
      }
    }

    // 执行 handler
    let rawResult: unknown
    try {
      rawResult = await handler(event, ...args)
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Handler 执行异常',
      }
    }

    // 响应校验
    if (!skipValidation) {
      const valid = validateResponse(contract, rawResult)
      if (!valid.valid) {
        console.warn(valid.error)
        return { success: false, error: valid.error }
      }
    }

    return rawResult
  }

  /** 锁定注册中心（启动后禁止新增 channel） */
  lock(): void {
    this._locked = true
  }

  /** 是否已锁定 */
  get locked(): boolean {
    return this._locked
  }

  /** 已注册 channel 列表 */
  get channels(): string[] {
    return Array.from(this.entries.keys())
  }

  /** 断言指定 channel 已注册 */
  assertRegistered(channel: string): void {
    if (!this.entries.has(channel)) {
      throw new Error(`[Registry] 启动断言失败: channel ${channel} 未注册 handler`)
    }
  }

  /** 启动时断言一组核心 channel 全部已注册 */
  assertAllRegistered(channels: string[]): void {
    for (const ch of channels) {
      this.assertRegistered(ch)
    }
    if (isContractDevMode()) {
      console.log(`[Registry]  ${channels.length} 个核心通道全部注册通过`)
    }
  }

  /**
   * P0-4/续：将注册中心已登记的全部 channel 真实绑定到 ipcMain.handle。
   * 按 ipcMain 实例幂等：同一实例不会重复绑定（production 主进程唯一 ipcMain 安全），
   * 但不同的 ipcMain 实例（e2e / 独立测试各自 new 的 mock）都会拿到自己的绑定；
   * 后注册的 channel 会在下次 attach 时补齐到已绑定实例。
   * 既可在 `register*Handlers` 末尾自绑定，也可在 `main.ts` 末尾统一绑定。
   */
  attach(ipcMain: Electron.IpcMain): void {
    let bound = this._boundTo.get(ipcMain)
    if (!bound) {
      bound = new Set<string>()
      this._boundTo.set(ipcMain, bound)
    }
    for (const [channel, entry] of this.entries) {
      if (entry.skipAttach) {
        // Fail-Closed 包装器治理登记：真实 ipcMain 绑定由 registerSecureIpc 等自行完成，
        // 此处不再重复绑定，避免 production 主进程触发 Electron "second handler" 报错。
        continue
      }
      if (!bound.has(channel)) {
        ipcMain.handle(channel, (event, ...args) => this.dispatch(channel, event, ...args))
        bound.add(channel)
      }
    }
  }

  /** P0-4：调试用快照（ARCH-STANDARDS §3 要求 dumpRegistry） */
  dumpRegistry(): Array<{
    channel: string
    hasContract: boolean
    skipValidation: boolean
    skipAttach: boolean
    locked: boolean
  }> {
    return Array.from(this.entries.entries()).map(([channel, entry]) => ({
      channel,
      hasContract: Boolean(entry.contract),
      skipValidation: Boolean(entry.skipValidation),
      skipAttach: Boolean(entry.skipAttach),
      locked: this._locked,
    }))
  }

  /** P0-4：测试隔离用清空（ARCH-STANDARDS §3 要求 resetRegistry） */
  resetRegistry(): void {
    this.entries.clear()
    this._boundTo = new WeakMap()
    this._locked = false
  }
}

/** 全局注册中心实例 */
export const registry = new IpcRegistry()

/**
 * Fail-Closed 包装器治理登记用的占位合约。
 * 包装器通道的真实响应形状由 handler 自带（含 Fail-Closed 的 401/403 信封），
 * 经 `registerSecureIpc` 登记时一律 `skipValidation: true`，故合约内容不参与运行时校验，
 * 仅用于"通道已知已注册"的事实记录，支撑未来 `assertAllRegistered()` 门禁。
 */
export const secureAnyContract: Contract<unknown, unknown> = {
  channel: '',
  requestRule: { type: 'any' },
  responseRule: { type: 'any' },
}

/** 便捷函数：注册 + 校验一站式 */
export function registerIpc<I, O>(
  channel: string,
  contract: ContractEntry<I, O>['contract'],
  handler: ContractEntry<I, O>['handler'],
  options?: { skipValidation?: boolean; skipAttach?: boolean },
): void {
  registry.register(channel, {
    contract,
    handler,
    skipValidation: options?.skipValidation,
    skipAttach: options?.skipAttach,
  })
}
