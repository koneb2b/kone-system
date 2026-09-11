const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// UI 宪法（.opencode/agents/ui-agent.md）：面向用户的界面禁止 emoji；
// 全部操作界面必须为简体中文（AI/N8N/B2B/LLM 等专有品牌词除外）。
// 本测试对渲染层源码做静态扫描，防止 emoji 与英文漏翻回归。

const SRC_ROOT = path.join(__dirname, '..', 'src')

const collectSourceFiles = (root) => {
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
        files.push(full)
      }
    }
  }
  walk(root)
  return files
}

// 覆盖：符号表情块、表情字母数字块、变体选择器、常见彩色表情
const EMOJI_PATTERN = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2705}\u{274C}\u{2728}]/u
// 覆盖：以 \uD83C-\uDBFF 开头的代理对转义序列（code review 最易漏的写法）
const SURROGATE_ESCAPE_PATTERN = /\\u(D[89ABab][0-9A-Fa-f]{2}|D[CDEFcdef][0-9A-Fa-f]{2})/

// 历史上出现过的英文漏翻样本，出现即视为回归
const BANNED_ENGLISH_SNIPPETS = [
  'Searching...',
  'Tips for High-Quality Leads',
  'Pro-Level Manager Insights',
  'AI Prompt Strategy',
  '(Data Source)',
]

test('渲染层源码不得包含 emoji 字符', () => {
  const violations = []
  for (const file of collectSourceFiles(SRC_ROOT)) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    lines.forEach((line, index) => {
      if (EMOJI_PATTERN.test(line)) {
        violations.push(`${file}:${index + 1} ${line.trim().slice(0, 90)}`)
      }
    })
  }
  assert.deepEqual(violations, [], `发现 emoji 残留（违反 UI 宪法）:\n${violations.join('\n')}`)
})

test('渲染层源码不得包含代理对转义序列写法的 emoji', () => {
  const violations = []
  for (const file of collectSourceFiles(SRC_ROOT)) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    lines.forEach((line, index) => {
      if (SURROGATE_ESCAPE_PATTERN.test(line)) {
        violations.push(`${file}:${index + 1} ${line.trim().slice(0, 90)}`)
      }
    })
  }
  assert.deepEqual(violations, [], `发现 \\uD83D 类转义 emoji 写法:\n${violations.join('\n')}`)
})

test('已知英文漏翻样本不得回归', () => {
  const violations = []
  for (const file of collectSourceFiles(SRC_ROOT)) {
    const content = fs.readFileSync(file, 'utf8')
    for (const snippet of BANNED_ENGLISH_SNIPPETS) {
      if (content.includes(snippet)) {
        violations.push(`${file} 包含未本地化文案: ${snippet}`)
      }
    }
  }
  assert.deepEqual(violations, [], `发现英文漏翻回归:\n${violations.join('\n')}`)
})
