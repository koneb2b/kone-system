import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { IcpProfile } from '@/store/config-store'

interface IcpSettingsTabProps {
  icpProfile: IcpProfile
  onUpdateIcp: (patch: Partial<IcpProfile>) => void
  onSave: () => void
  isSaving: boolean
  manualSaving: boolean
}

export function IcpSettingsTab({ icpProfile, onUpdateIcp, onSave, isSaving, manualSaving }: IcpSettingsTabProps) {
  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">ICP 目标客户画像</CardTitle>
          <CardDescription>
            请填写更接近真实采购决策的信息。画像越清晰，系统越能优先识别高质量 B2B 客户。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="icp-product">主力产品 / 核心品类</Label>
            <p className="text-xs text-slate-500">
              填写客户最可能搜索和采购的产品关键词，优先使用行业通用词或英文产品名。
            </p>
            <Input
              id="icp-product"
              placeholder="例如：贴片电容 / 医用注射器 (切忌填大类)"
              value={icpProfile.targetProduct}
              onChange={(e) => onUpdateIcp({ targetProduct: e.target.value })}
              className="h-10 border-slate-200 bg-white focus-visible:ring-2 focus-visible:ring-blue-500/20 focus-visible:ring-offset-0"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="icp-persona">目标买家类型</Label>
            <p className="text-xs text-slate-500">请选择你最希望成交的客户类型，系统会优先识别对应的商业角色。</p>
            <select
              id="icp-persona"
              value={icpProfile.buyerPersona}
              onChange={(e) => onUpdateIcp({ buyerPersona: e.target.value as IcpProfile['buyerPersona'] })}
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-blue-500/20 focus-visible:ring-offset-0"
            >
              <option value="">请选择买家定位</option>
              <option value="distributor">Distributor（区域分销商：有渠道网络，批量采购）</option>
              <option value="integrator">Integrator（项目集成商：做工程项目与系统交付）</option>
              <option value="brand_owner">Brand Owner（品牌商：自有品牌找代工）</option>
              <option value="oem">OEM（代工伙伴）</option>
              <option value="wholesaler">Wholesaler（批发商）</option>
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="icp-advantage">核心成交优势</Label>
            <p className="text-xs text-slate-500">
              填写客户愿意向你采购的真实原因，优先填写可验证信息，勿填虚泛的口号。
            </p>
            <Input
              id="icp-advantage"
              placeholder="例如：支持 50 件起订 / 承诺 7 天打样 / 拥有欧美双认证 (需量化硬实力)"
              value={icpProfile.coreAdvantage}
              onChange={(e) => onUpdateIcp({ coreAdvantage: e.target.value })}
              className="h-10 border-slate-200 bg-white text-sm focus-visible:ring-2 focus-visible:ring-blue-500/20 focus-visible:ring-offset-0"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="icp-negative">绝对不碰的客户 (Negative ICP)</Label>
            <p className="text-xs text-slate-500">填写你明确不想成交的客户类型，帮助系统减少无效线索和错误匹配。</p>
            <Input
              id="icp-negative"
              placeholder="例如：不接个人零买(B2C) / 避开同行竞争者 / 不做跨境卖家"
              value={icpProfile.negativeIcp}
              onChange={(e) => onUpdateIcp({ negativeIcp: e.target.value })}
              className="h-10 border-slate-200 bg-white text-sm focus-visible:ring-2 focus-visible:ring-blue-500/20 focus-visible:ring-offset-0"
            />
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="font-medium">填写建议 (Tips for High-Quality Leads)</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-amber-900/90">
              <li>产品词尽量具体，优先填客户会搜索的标准产品名，切忌大而全。</li>
              <li>买家类型只选最常成交的一类，避免范围过宽导致线索失焦。</li>
              <li>成交优势请填写认证、交期、MOQ、定制、价格带等硬实力。</li>
              <li>画像越具体，AI 越能精准排除 C 端散客，锁定 B2B 采购决策人。</li>
            </ul>
          </div>
        </CardContent>
        <CardFooter className="justify-between">
          <div className="text-xs text-slate-500">画像配置会自动保存，可手动点击保存进行确认。</div>
          <Button type="button" onClick={onSave} className="gap-2" disabled={isSaving} isLoading={manualSaving}>
            {manualSaving ? '保存中' : '保存 ICP 策略'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
