/**
 * domain.ts — 域名归一化工具（全局共享）
 *
 * 所有涉及域名比较、写入云端的场景必须使用此函数，
 * 确保 www.example.com / https://example.com/path 均归一化为 example.com
 */

export const extractDomain = (input: string): string => {
  try {
    let cleaned = input.trim().toLowerCase()
    if (!cleaned.includes('://')) cleaned = `https://${cleaned}`
    return new URL(cleaned).hostname.replace(/^www\./, '')
  } catch {
    return input
      .trim()
      .toLowerCase()
      .replace(/^www\./, '')
  }
}
