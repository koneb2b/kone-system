import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Lock, Rocket } from 'lucide-react'

type N8nSettings = {
  webhookUrl: string
  autoPush: boolean
  minScore: number
  roleFilter: string
}

interface N8nSettingsTabProps {
  n8nSettings: N8nSettings
  locked?: boolean
  onRequestUpgrade?: () => void
  onUpdateN8n: (patch: Partial<N8nSettings>) => void
  onSave: () => void
  isSaving: boolean
  manualSaving: boolean
}

export function N8nSettingsTab({
  n8nSettings,
  locked = false,
  onRequestUpgrade,
  onUpdateN8n,
  onSave,
  isSaving,
  manualSaving,
}: N8nSettingsTabProps) {
  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Kone 协同引擎</CardTitle>
          <CardDescription>配置云端发送队列地址，并管理高分线索同步策略。</CardDescription>
        </CardHeader>
        {locked ? (
          <CardContent>
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center shadow-sm">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm">
                <Lock className="size-6" />
              </div>
              <h3 className="mt-5 text-lg font-semibold text-slate-900">该功能为高级版专属</h3>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-600">
                升级解锁企业云端引擎配置，实现多节点自动化队列推送。
              </p>
              <Button
                type="button"
                onClick={onRequestUpgrade}
                className="mt-6 gap-2 bg-slate-900 text-white hover:bg-slate-800"
              >
                <Rocket className="size-4" />
                立即升级高级版
              </Button>
            </div>
          </CardContent>
        ) : (
          <>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="n8n-webhook">云端发送队列地址</Label>
                <Input
                  id="n8n-webhook"
                  placeholder="https://your-cloud-queue.example.com/queue-entry"
                  value={n8nSettings.webhookUrl}
                  onChange={(e) => onUpdateN8n({ webhookUrl: e.target.value })}
                  className="h-10 border-slate-200 bg-white focus-visible:ring-2 focus-visible:ring-blue-500/20 focus-visible:ring-offset-0"
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-slate-800">自动同步至协同引擎</span>
                  <span className="text-xs text-slate-500">开启后将自动同步新线索到云端发送队列</span>
                </div>
                <Switch
                  checked={n8nSettings.autoPush}
                  onCheckedChange={(checked) => onUpdateN8n({ autoPush: checked })}
                />
              </div>
              {n8nSettings.autoPush ? (
                <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="n8n-min-score">同步最低分数线</Label>
                    <p className="text-xs text-slate-500">低于此分数的线索将被拦截，不会进入 Kone 协同引擎。</p>
                    <div className="flex items-center gap-3">
                      <Input
                        id="n8n-min-score"
                        type="number"
                        min={0}
                        max={100}
                        value={n8nSettings.minScore}
                        onChange={(e) =>
                          onUpdateN8n({ minScore: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })
                        }
                        className="h-10 w-28 border-slate-200 bg-white focus-visible:ring-2 focus-visible:ring-blue-500/20 focus-visible:ring-offset-0"
                      />
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={n8nSettings.minScore}
                        onChange={(e) => onUpdateN8n({ minScore: Number(e.target.value) })}
                        className="h-2 flex-1 accent-blue-600"
                      />
                      <span className="w-10 text-right text-sm font-medium text-slate-700">{n8nSettings.minScore}</span>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="n8n-role-filter">特定角色同步范围</Label>
                    <p className="text-xs text-slate-500">
                      可选，留空则不限角色；填写后仅推送推断角色中包含该关键词的线索。
                    </p>
                    <Input
                      id="n8n-role-filter"
                      placeholder="例如：distributor / procurement manager / integrator"
                      value={n8nSettings.roleFilter}
                      onChange={(e) => onUpdateN8n({ roleFilter: e.target.value })}
                      className="h-10 border-slate-200 bg-white focus-visible:ring-2 focus-visible:ring-blue-500/20 focus-visible:ring-offset-0"
                    />
                  </div>
                </div>
              ) : null}
            </CardContent>
            <CardFooter className="justify-between">
              <div className="text-xs text-slate-500">配置会自动保存，建议保存后返回业务页面确认协同引擎状态。</div>
              <Button type="button" onClick={onSave} className="gap-2" disabled={isSaving} isLoading={manualSaving}>
                {manualSaving ? '保存中' : '保存协同引擎配置'}
              </Button>
            </CardFooter>
          </>
        )}
      </Card>
    </div>
  )
}
