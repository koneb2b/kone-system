/**
 * 客户资料下载端 —— 静态视觉预览生成器。
 *
 * 目的：脱离 Electron/Vite 直接渲染下载端的 HTML 视觉稿，
 * 便于查看配色、信息层级与「可触达渠道分布」的呈现效果。
 * 使用的色值取自 src/index.css 的 CSS 变量（项目设计语言 SSOT）。
 */
const fs = require('node:fs')
const path = require('node:path')

// 项目设计语言（对应 src/index.css）
const T = {
  primary: '#5cb828', // --primary / --brand-green  92 65% 44%
  deepBlue: '#001529', // --deep-blue  210 100% 8%
  border: '#e2e8f0',
  muted: '#f1f5f9',
  mutedFg: '#64748b',
  fg: '#0f172a',
  emerald: '#059669',
  sky: '#0284c7',
  indigo: '#4f46e5',
  amber: '#d97706',
}

const groups = [
  { label: '企业主体', hint: '公司名称 / 行业 / 国家 / 匹配度', checked: true },
  { label: '联系入口', hint: '联系人 / 职位 / 邮箱 / 邮箱等级 / 电话 / 网站', checked: true },
  { label: '可触达渠道', hint: 'WhatsApp / 邮件 / LinkedIn 是否具备自动化条件', checked: true },
  { label: '核心关键人', hint: '决策人最多 3 位（姓名·职位·邮箱·等级·电话）', checked: true },
  { label: '数据溯源', hint: '数据来源', checked: true },
]

const stats = [
  { label: 'WhatsApp', value: 37, tone: T.emerald },
  { label: '邮件', value: 52, tone: T.sky },
  { label: 'LinkedIn', value: 18, tone: T.indigo },
  { label: '待补数据', value: 11, tone: T.amber },
]

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>Kone AI · 客户资料下载端</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: 'Microsoft YaHei','PingFang SC',system-ui,sans-serif;
    background: ${T.muted}; color: ${T.fg}; padding: 40px 20px;
    display: flex; justify-content: center;
  }
  .panel {
    width: 460px; background: #fff; border: 1px solid ${T.border};
    border-radius: 12px; box-shadow: 0 10px 40px rgba(0,21,41,.08); overflow: hidden;
  }
  .head { padding: 20px 22px 16px; border-bottom: 1px solid ${T.border}; }
  .head h1 { font-size: 15px; display: flex; align-items: center; gap: 8px; letter-spacing: .3px; }
  .dot { width: 8px; height: 8px; border-radius: 3px; background: ${T.primary}; }
  .head p { margin-top: 8px; font-size: 12px; color: ${T.mutedFg}; line-height: 1.6; }
  .head b { color: ${T.fg}; }
  .body { padding: 18px 22px 22px; }
  .card {
    border: 1px solid ${T.border}; background: ${T.muted};
    border-radius: 12px; padding: 14px; margin-bottom: 20px;
  }
  .card-top { display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px; }
  .card-top span:first-child { font-size: 12px; font-weight: 700; }
  .card-top span:last-child { font-size: 10px; color: ${T.mutedFg}; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .cell {
    display: flex; justify-content: space-between; align-items: baseline;
    background: #fff; border-radius: 8px; padding: 9px 11px;
  }
  .cell .k { font-size: 11px; color: ${T.mutedFg}; }
  .cell .v { font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .note { margin-top: 10px; font-size: 10px; line-height: 1.65; color: ${T.mutedFg}; }
  .sec-title { display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px; }
  .sec-title span { font-size: 12px; font-weight: 700; }
  .sec-title a { font-size: 11px; color: ${T.primary}; text-decoration: none; }
  .item {
    display: flex; gap: 10px; align-items: flex-start;
    border: 1px solid ${T.border}; border-radius: 8px; padding: 10px 12px; margin-bottom: 6px;
  }
  .box {
    width: 15px; height: 15px; border-radius: 4px; margin-top: 1px; flex-shrink: 0;
    background: ${T.primary}; display:flex; align-items:center; justify-content:center;
    color:#fff; font-size: 10px; font-weight: 700;
  }
  .box.off { background:#fff; border: 1.5px solid #cbd5e1; }
  .item .t { font-size: 12px; font-weight: 600; }
  .item .h { font-size: 10px; color: ${T.mutedFg}; margin-top: 2px; line-height: 1.5; }
  .footer { border-top: 1px solid ${T.border}; padding-top: 16px; margin-top: 16px; }
  .preview { font-size: 11px; color: ${T.mutedFg}; margin-bottom: 12px; line-height: 1.6; }
  .preview b { color: ${T.fg}; }
  .btn {
    width: 100%; padding: 11px; border-radius: 8px; border: none;
    background: ${T.primary}; color: #fff; font-size: 13px; font-weight: 600;
    cursor: pointer; letter-spacing: .3px;
  }
</style></head>
<body>
  <div class="panel">
    <div class="head">
      <h1><span class="dot"></span>客户资料下载端</h1>
      <p>共 <b>68</b> 条线索。按需勾选字段组后导出 CSV（UTF-8 BOM，Excel 可直接打开）。</p>
    </div>
    <div class="body">
      <div class="card">
        <div class="card-top">
          <span>可触达渠道分布</span>
          <span>依据 Agent 消费字段判定</span>
        </div>
        <div class="grid">
          ${stats
            .map(
              (s) => `<div class="cell"><span class="k">${s.label}</span><span class="v" style="color:${s.tone}">${s.value}</span></div>`,
            )
            .join('')}
        </div>
        <p class="note">
          「待补数据」= 缺少电话/邮箱/LinkedIn，无法进入自动化触达。数据源本身不覆盖全部字段，
          建议先通过官网深探或人工补全后再触达。
        </p>
      </div>

      <div class="sec-title"><span>导出字段组</span><a href="#">全部取消</a></div>
      ${groups
        .map(
          (g) => `<div class="item">
        <span class="box${g.checked ? '' : ' off'}">${g.checked ? '✓' : ''}</span>
        <span><span class="t">${g.label}</span><span class="h">${g.hint}</span></span>
      </div>`,
        )
        .join('')}

      <div class="footer">
        <div class="preview">将导出 <b>26</b> 列：公司名称、行业、国家、匹配度、联系人、职位 …</div>
        <button class="btn">导出 CSV（68 条）</button>
      </div>
    </div>
  </div>
</body></html>`

const out = path.join(__dirname, '..', 'export-center-preview.html')
fs.writeFileSync(out, html, 'utf8')
console.log('✅ 下载端预览已生成：' + out)
