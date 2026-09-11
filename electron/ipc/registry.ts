/**
 * IPC 通道注册中心
 *
 * 功能：
 * 1. 所有 handler 必须在注册中心登记，附带合约
 * 2. 启动时断言：所有已声明的 channel 都有 handler（防止漏注册）
 * 3. 运行时校验：请求/响应通过合约校验后转发给实际 handler
 * 4. 通道白名单：未注册的 channel renderer 无法调用
 */

import type { ContractEntry } from './contracts/types'
import { validateRequest, validateResponse, isContractDevMode } from './contracts/types'

/** 注册中心单例 */
class IpcRegistry {
  private entries = new Map<string, ContractEntry>()
  private _locked = false
  /** P0-4：已真实绑定到 ipcMain.handle 的 channel 集合（防止重复绑定） */
  private _attached = new Set<string>()

  /** 注册一个 IPC handler */
  register<I, O>(channel: string, entry: ContractEntry<I, O>): void {
    if (this._locked) {
      throw new Error(`[Registry] 注册中心已锁定，无法注册 ${channel}`)
    }
    if (this.entries.has(channel)) {
      throw new Error(`[Registry] channel ${channel} 重复注册`)
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
   * P0-4：将注册中心已登记的全部 channel 真实绑定到 ipcMain.handle。
   * 必须在所有 register*Handlers 完成之后调用（main.ts registerIpcHandlers 末尾）。
   * 此后新增的 register() 若在 attach 之后发生，需再次调用 attach 或由
   * register() 内部自动绑定（见 registerIpc 的 attachOnRegister 选项）。
   */
  attach(ipcMain: Electron.IpcMain): void {
    for (const [channel] of this.entries) {
      if (!this._attached.has(channel)) {
        ipcMain.handle(channel, (event, ...args) => this.dispatch(channel, event, ...args))
        this._attached.add(channel)
      }
    }
  }

  /** P0-4：调试用快照（ARCH-STANDARDS §3 要求 dumpRegistry） */
  dumpRegistry(): Array<{ channel: string; hasContract: boolean; skipValidation: boolean; locked: boolean }> {
    return Array.from(this.entries.entries()).map(([channel, entry]) => ({
      channel,
      hasContract: Boolean(entry.contract),
      skipValidation: Boolean(entry.skipValidation),
      locked: this._locked,
    }))
  }

  /** P0-4：测试隔离用清空（ARCH-STANDARDS §3 要求 resetRegistry） */
  resetRegistry(): void {
    this.entries.clear()
    this._attached.clear()
    this._locked = false
  }
}

/** 全局注册中心实例 */
export const registry = new IpcRegistry()

/** 便捷函数：注册 + 校验一站式 */
export function registerIpc<I, O>(
  channel: string,
  contract: ContractEntry<I, O>['contract'],
  handler: ContractEntry<I, O>['handler'],
  options?: { skipValidation?: boolean },
): void {
  registry.register(channel, {
    contract,
    handler,
    skipValidation: options?.skipValidation,
  })
}
