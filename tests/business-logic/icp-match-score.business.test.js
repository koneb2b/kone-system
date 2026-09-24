const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// §0.5 宪法算法符合性测试（kone-PRD §L194-204，权重结构不得改动）：
//   域名存在度 40/10 ｜ 产品词命中 30 ｜ B2B 信号词 20/10/0 ｜ 联系人资产 10 ｜ 上限 100
// 其中「联系人资产」明文包含 decisionMakers[].email / .phone / .linkedinUrl
// （此前实现漏了这三项，仅有决策人联系方式的线索会少 10 分，可能被 >=60 门槛挡在 Agent 管道外）。
//
// 注意：B2B 信号词是**子串**匹配（`text.includes(signal)`），故 'distributor' 并不命中
// 'distribute'（'distribut' 后接 'o' 而非 'e'）。测试用词均为真实命中的信号词。
const { computeIcpMatchScore } = require(
  path.join(__dirname, '..', '..', 'dist-electron', 'electron', 'services', 'search', 'scoring.js'),
)

test('§0.5: 四维满配 = 40(官网) + 30(产品词) + 20(≥3 B2B) + 10(联系人) = 100', () => {
  const lead = {
    website: 'https://acme-industrial.com',
    company: 'Acme',
    snippet: 'wholesale import dealer of industrial widgets',
    contact: 'John',
  }
  assert.equal(computeIcpMatchScore(lead, ['widgets']), 100)
})

test('§0.5: 无官网降级为 10 分（域名存在度 40/10）', () => {
  const lead = {
    company: 'Acme',
    snippet: 'wholesale import dealer of industrial widgets',
    contact: 'John',
  }
  assert.equal(computeIcpMatchScore(lead, ['widgets']), 10 + 30 + 20 + 10)
})

test('§0.5: B2B 信号词三级阶梯（≥3 → 20，≥1 → 10，0 → 0）', () => {
  const base = { website: 'https://acme.com', company: 'Acme' }
  assert.equal(computeIcpMatchScore({ ...base, snippet: 'wholesale' }, []), 40 + 10)
  assert.equal(computeIcpMatchScore({ ...base, snippet: 'wholesale import dealer' }, []), 40 + 20)
  assert.equal(computeIcpMatchScore({ ...base, snippet: 'nothing relevant here' }, []), 40)
})

test('§0.5: 产品词未命中则不计 30 分', () => {
  const lead = { website: 'https://acme.com', company: 'Acme' }
  assert.equal(computeIcpMatchScore(lead, ['widgets']), 40)
  assert.equal(computeIcpMatchScore(lead, []), 40)
})

test('§L203: 仅有 decisionMakers[].email 亦计联系人资产 10 分', () => {
  const lead = {
    website: 'https://acme.com',
    company: 'Acme',
    decisionMakers: [
      { name: 'A', title: 'Buyer', email: 'buyer@acme.com', phone: '', source: 'x', confidenceScore: 80 },
    ],
  }
  assert.equal(computeIcpMatchScore(lead, []), 40 + 10)
})

test('§L203: 仅有 decisionMakers[].phone 亦计联系人资产 10 分', () => {
  const lead = {
    website: 'https://acme.com',
    company: 'Acme',
    decisionMakers: [{ name: 'A', title: 'Buyer', email: '', phone: '+1-555', source: 'x', confidenceScore: 80 }],
  }
  assert.equal(computeIcpMatchScore(lead, []), 40 + 10)
})

test('§L203: 仅有 decisionMakers[].linkedinUrl 亦计联系人资产 10 分', () => {
  const lead = {
    website: 'https://acme.com',
    company: 'Acme',
    decisionMakers: [
      {
        name: 'A',
        title: 'Buyer',
        email: '',
        phone: '',
        linkedinUrl: 'https://linkedin.com/in/a',
        source: 'x',
        confidenceScore: 70,
      },
    ],
  }
  assert.equal(computeIcpMatchScore(lead, []), 40 + 10)
})

test('§L203: 决策人字段全空则不计联系人资产', () => {
  const lead = {
    website: 'https://acme.com',
    company: 'Acme',
    decisionMakers: [{ name: 'A', title: 'Buyer', email: '', phone: '', source: 'x', confidenceScore: 70 }],
  }
  assert.equal(computeIcpMatchScore(lead, []), 40)
})

test('§0.5: 无任何联系人资产时联系人维度为 0', () => {
  assert.equal(computeIcpMatchScore({ website: 'https://acme.com', company: 'Acme' }, []), 40)
})

test('§0.5: 上限硬截断 100、无官网下限 10', () => {
  const lead = {
    website: 'https://acme.com',
    company: 'Acme',
    snippet: 'wholesale import dealer widgets',
    contact: 'John',
  }
  assert.equal(computeIcpMatchScore(lead, ['widgets']), 100)
  assert.equal(computeIcpMatchScore({}, []), 10) // 无官网 10，其余 0
})
