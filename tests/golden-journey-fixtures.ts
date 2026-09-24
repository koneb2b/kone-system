/**
 * GJ-01: Golden Journey 测试夹具
 *
 * 本文件定义搜索、评分、分析和自动化链路的确定性测试数据。
 * 目标：同一 commit 重跑结果稳定，不依赖公网 SerpApi/LLM/Supabase。
 *
 * 使用方式（测试中 import）：
 *   import { MOCK_SEARCH_RESULTS, MOCK_LEAD, MOCK_ANALYSIS } from './golden-journey-fixtures'
 */

export const MOCK_SEARCH_RESULTS = [
  {
    id: 'fixture-001',
    company: 'SolarTech GmbH',
    website: 'https://solartech.de',
    email: ' procurement@solartech.de',
    phone: '+49 30 12345678',
    country: 'Germany',
    countryCode: 'DE',
    industry: 'Solar Energy',
    source: 'google_maps',
    dataSourceType: 'google_maps',
    matchScore: 85,
    scoreSource: 'ai' as const,
    matchReasons: ['B2B manufacturer', 'Solar panel distributor', 'Wholesale pricing'],
    riskFlags: [],
    inferredRole: 'Procurement Manager',
    snippet:
      'SolarTech GmbH is a leading distributor of high-performance solar panels and energy storage systems in the DACH region.',
    isB2B: true,
    unlocked: false,
    contact: 'Hans Mueller',
    contactTitle: 'Head of Procurement',
    address: 'Berlin, Germany',
  },
  {
    id: 'fixture-002',
    company: 'BatteryWorld Ltd',
    website: 'https://batteryworld.co.uk',
    email: 'info@batteryworld.co.uk',
    phone: '+44 20 87654321',
    country: 'United Kingdom',
    countryCode: 'GB',
    industry: 'Energy Storage',
    source: 'google_organic',
    dataSourceType: 'google_organic',
    matchScore: 78,
    scoreSource: 'deterministic' as const,
    matchReasons: ['B2B supplier', 'Battery wholesaler'],
    riskFlags: ['No direct contact form'],
    inferredRole: 'Sales Director',
    snippet: 'BatteryWorld Ltd supplies industrial-grade lithium batteries for renewable energy storage applications.',
    isB2B: true,
    unlocked: false,
    contact: 'Sarah Chen',
    contactTitle: 'Sales Director',
    address: 'London, UK',
  },
  {
    id: 'fixture-003',
    company: 'PowerCell Systems',
    website: 'https://powercell.se',
    email: 'orders@powercell.se',
    phone: '+46 8 5551234',
    country: 'Sweden',
    countryCode: 'SE',
    industry: 'Fuel Cell',
    source: 'linkedin_search',
    dataSourceType: 'linkedin_search',
    matchScore: 92,
    scoreSource: 'ai' as const,
    matchReasons: ['B2B manufacturer', 'Fuel cell systems', 'European certified'],
    riskFlags: [],
    inferredRole: 'CTO',
    snippet:
      'PowerCell Systems designs and manufactures hydrogen fuel cell systems for industrial and marine applications.',
    isB2B: true,
    unlocked: false,
    contact: 'Erik Lindberg',
    contactTitle: 'Chief Technology Officer',
    address: 'Gothenburg, Sweden',
  },
]

export const MOCK_LEAD = MOCK_SEARCH_RESULTS[0]

export const MOCK_ANALYSIS = {
  companyProfile: 'SolarTech GmbH 是德国领先的太阳能板和储能系统分销商，覆盖 DACH 地区，年营收约 5000 万欧元。',
  painPoints: '依赖单一供应商，缺乏东南亚低成本采购渠道；储能系统认证周期长。',
  valueMapping: '我们提供 30% 成本优势的磷酸铁锂电池，已获 CE/IEC 双认证，可缩短其采购到货周期 40%。',
  emailSubject: 'SolarTech 采购成本优化 — 30% 降幅的东南亚直供方案',
  emailBody:
    'Dear Hans,\n\nI noticed SolarTech GmbH has been expanding its DACH solar distribution network. Our CE/IEC-certified LFP batteries offer 30% cost reduction with 40% faster delivery from our Shenzhen facility...\n\nBest regards',
  confidence: 0.85,
  source: 'website',
  usedKnowledgeTitles: ['循环寿命优势', 'CE/IEC双认证'],
}

export const MOCK_CAMPAIGN_RESULT = {
  triggered: true,
  pushed: true,
  accepted: 2,
  rejected: 1,
  message: '已成功同步 2 条线索至云端发送队列，已拦截 1 条低分或无邮箱线索',
}

export const MOCK_PROVISIONAL_RESULT = {
  triggered: true,
  pushed: false,
  accepted: 2,
  rejected: 1,
  message: '渐进式开发模式：数据组装成功，云端 Webhook 暂未配置，已取消推送',
}

export const MOCK_COLLISION_RESULT_AVAILABLE = {
  collision: false,
  domain: 'solartech.de',
  unknown: false,
}

export const MOCK_COLLISION_RESULT_UNKNOWN = {
  collision: false,
  domain: 'solartech.de',
  unknown: true,
  error: '网络不可达，无法确认防撞状态',
}

export const MOCK_COLLISION_RESULT_CLAIMED = {
  collision: true,
  domain: 'batteryworld.co.uk',
  ownerLabel: 'Team B',
  ownerMachineId: 'machine-xyz',
  unknown: false,
}
