/* P2 · 国家名 → ISO 3166-1 alpha-2 代码解析。
 *
 * ## 为什么不能截取前两个字母
 * 原实现在三处用 `country.slice(0, 2).toUpperCase()` 推导国家代码：
 * `Germany` → `GE`（正确应为 `DE`）、`France` → `FR`（碰巧对）、
 * `United States` → `UN`（应为 `US`）。**错误的代码比空值更糟** ——
 * 它会作为"看起来合法"的数据进入表格、导出文件与云端台账。
 *
 * ## 策略
 * 1) 命中映射表（中英文名皆可）→ 返回正确代码；
 * 2) 未命中 → 返回 `''`（**诚实表示未知**），由调用方决定展示兜底，
 *    **不再猜**。
 */

const NAME_TO_CODE: Record<string, string> = {
  // ── 北美 ──
  美国: 'US',
  'united states': 'US',
  usa: 'US',
  'u.s.a.': 'US',
  'united states of america': 'US',
  加拿大: 'CA',
  canada: 'CA',
  墨西哥: 'MX',
  mexico: 'MX',
  // ── 欧洲 ──
  德国: 'DE',
  germany: 'DE',
  英国: 'GB',
  'united kingdom': 'GB',
  uk: 'GB',
  'great britain': 'GB',
  法国: 'FR',
  france: 'FR',
  意大利: 'IT',
  italy: 'IT',
  西班牙: 'ES',
  spain: 'ES',
  荷兰: 'NL',
  netherlands: 'NL',
  holland: 'NL',
  比利时: 'BE',
  belgium: 'BE',
  波兰: 'PL',
  poland: 'PL',
  捷克: 'CZ',
  czechia: 'CZ',
  'czech republic': 'CZ',
  匈牙利: 'HU',
  hungary: 'HU',
  罗马尼亚: 'RO',
  romania: 'RO',
  瑞典: 'SE',
  sweden: 'SE',
  挪威: 'NO',
  norway: 'NO',
  丹麦: 'DK',
  denmark: 'DK',
  芬兰: 'FI',
  finland: 'FI',
  瑞士: 'CH',
  switzerland: 'CH',
  奥地利: 'AT',
  austria: 'AT',
  葡萄牙: 'PT',
  portugal: 'PT',
  希腊: 'GR',
  greece: 'GR',
  爱尔兰: 'IE',
  ireland: 'IE',
  乌克兰: 'UA',
  ukraine: 'UA',
  俄罗斯: 'RU',
  russia: 'RU',
  土耳其: 'TR',
  turkey: 'TR',
  türkiye: 'TR',
  // ── 中东 / 非洲 ──
  阿联酋: 'AE',
  'united arab emirates': 'AE',
  uae: 'AE',
  沙特阿拉伯: 'SA',
  'saudi arabia': 'SA',
  以色列: 'IL',
  israel: 'IL',
  埃及: 'EG',
  egypt: 'EG',
  南非: 'ZA',
  'south africa': 'ZA',
  尼日利亚: 'NG',
  nigeria: 'NG',
  肯尼亚: 'KE',
  kenya: 'KE',
  // ── 南亚 / 东南亚 ──
  印度: 'IN',
  india: 'IN',
  巴基斯坦: 'PK',
  pakistan: 'PK',
  孟加拉国: 'BD',
  bangladesh: 'BD',
  越南: 'VN',
  vietnam: 'VN',
  'viet nam': 'VN',
  泰国: 'TH',
  thailand: 'TH',
  印度尼西亚: 'ID',
  indonesia: 'ID',
  马来西亚: 'MY',
  malaysia: 'MY',
  新加坡: 'SG',
  singapore: 'SG',
  菲律宾: 'PH',
  philippines: 'PH',
  // ── 东亚 ──
  中国: 'CN',
  china: 'CN',
  日本: 'JP',
  japan: 'JP',
  韩国: 'KR',
  'south korea': 'KR',
  korea: 'KR',
  // ── 大洋洲 / 南美 ──
  澳大利亚: 'AU',
  australia: 'AU',
  新西兰: 'NZ',
  'new zealand': 'NZ',
  巴西: 'BR',
  brazil: 'BR',
  阿根廷: 'AR',
  argentina: 'AR',
  智利: 'CL',
  chile: 'CL',
  秘鲁: 'PE',
  peru: 'PE',
  哥伦比亚: 'CO',
  colombia: 'CO',
}

const normalize = (country?: string) =>
  String(country || '')
    .trim()
    .toLowerCase()

/** 解析国家名（中/英）为 ISO alpha-2 代码；未知返回 `''`（诚实，不猜）。 */
export const resolveCountryCode = (country?: string): string => {
  const key = normalize(country)
  if (!key) return ''
  return NAME_TO_CODE[key] || ''
}
