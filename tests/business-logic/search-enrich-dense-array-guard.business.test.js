/**
 * search-enrich-dense-array-guard.business.test.js
 *
 * 背景（2026-10-12 真实缺陷，实测复现并抓取栈）：
 * `executeScoring` 的富化阶段原用 `new Array(baseResults.length)` 初始化结果数组。
 * 并发 worker 在「job 被抢占」时会**提前 `return`**（`if (myJobId !== activeJobIdFor()) return`），
 * 该索引**不写回** → 数组出现**空洞（hole）**。
 * 随后 `new Map(scoredResults.map(...))` 因 `Array.prototype.map` **跳过空洞**而产出稀疏数组，
 * `new Map()` 迭代空洞得到 `undefined` → 抛
 *   `TypeError: Iterator value undefined is not an entry object`
 * → **整轮搜索在富化进行中直接中断**（实测：50 条线索全部评完后崩）。
 *
 * 修复：改用 `baseResults.slice()` **密集初始化**。
 * 本测试锁定：① 源码不得回退为稀疏初始化；② 机制复现（证明该守卫为何必要）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const SRC = path.join(ROOT, 'electron', 'services', 'search-service.ts')

/** 剥离 // 与 /* *\/ 注释（避免被说明性注释误触发） */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/[^\n]*/g, '')

test('富化结果数组必须**密集初始化**（不得用 new Array(baseResults.length)）', () => {
  const src = stripComments(fs.readFileSync(SRC, 'utf8'))
  assert.ok(
    !/new Array\(\s*baseResults\.length\s*\)/.test(src),
    '富化结果不得用 new Array(baseResults.length) 初始化：并发 worker 提前 return 会留下空洞，' +
      '后续 new Map(稀疏数组) 会抛 "Iterator value undefined is not an entry object" 中断整轮搜索。',
  )
  assert.ok(/baseResults\.slice\(\)/.test(src), '应以 baseResults.slice() 密集初始化富化结果数组')
})

test('（机制复现）new Map 迭代稀疏数组会抛错 —— 说明上面的守卫为何必要', () => {
  const sparse = new Array(2) // 索引 1 为空洞
  sparse[0] = ['key', { company: 'A' }]
  assert.throws(() => new Map(sparse), /not an entry object/)

  // 密集数组则安全
  const dense = [['key', { company: 'A' }]]
  assert.equal(new Map(dense).size, 1)
})
