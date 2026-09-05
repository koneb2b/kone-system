/**
 * make-transparent.cjs — 白底 logo 转透明底 + 裁剪到图形边界。
 *
 * 原理：白底 logo 的前景为深色/彩色，白色像素按 alpha = 255 - min(r,g,b)
 * 软转透明（深色/彩色不透明、白色全透明、抗锯齿边缘平滑过渡），
 * 然后裁剪到非透明像素的 bounding box。
 *
 * 用法: node scripts/make-transparent.cjs <in.png> <out.png>
 */
const fs = require('fs')
const zlib = require('zlib')

// ── PNG 解码（RGBA 输出）──────────────────────────────
function decodePng(buf) {
  let off = 8
  const idat = []
  let width = 0
  let height = 0
  let colorType = 0
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.slice(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      colorType = data[9]
    }
    if (type === 'IDAT') idat.push(data)
    if (type === 'IEND') break
    off += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const bpp = colorType === 6 ? 4 : 3
  const stride = width * bpp
  const rgba = Buffer.alloc(width * height * 4)
  let prev = new Uint8Array(stride)
  let pos = 0
  const out = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const line = raw.slice(pos, pos + stride)
    pos += stride
    for (let i = 0; i < stride; i++) {
      let v = line[i]
      if (filter === 1) {
        const a = i >= bpp ? out[i - bpp] : 0
        v = (v + a) & 255
      } else if (filter === 2) {
        v = (v + prev[i]) & 255
      } else if (filter === 3) {
        const a = i >= bpp ? out[i - bpp] : 0
        v = (v + ((a + prev[i]) >> 1)) & 255
      } else if (filter === 4) {
        const a = i >= bpp ? out[i - bpp] : 0
        const b = prev[i]
        const c = i >= bpp ? prev[i - bpp] : 0
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
        v = (v + pr) & 255
      }
      out[i] = v
      if (i % bpp === 0) {
        const di = (y * width + i / bpp) * 4
        rgba[di] = out[i]
        rgba[di + 1] = out[i + 1]
        rgba[di + 2] = out[i + 2]
        rgba[di + 3] = bpp === 4 ? out[i + 3] : 255
      }
    }
    prev = out.slice()
  }
  return { width, height, rgba }
}

// ── CRC32 ────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

// ── PNG 编码 ─────────────────────────────────────────────
function encodePng(rgba, width, height) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

// ── 白底转透明（噪声感知版）─────────────────────────────
// 源图白底带压缩噪声（非纯白），简单亮度公式会把噪声变成半透明斑点。
// 分类处理：
//   - 饱和彩色像素（max-min > 60，如蓝色装饰）→ 保留原色不透明
//   - 中性像素按亮度分级：
//       L >= 235（白底及噪声）→ 全透明
//       60 <= L < 235（抗锯齿边缘）→ 前景色(21,30,43) + 渐变 alpha
//       L < 60（前景主体）→ 不透明
function whiteToTransparent(rgba, width, height, fgColor) {
  const FG = fgColor || [21, 30, 43] // logo 主体深色
  const out = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height * 4; i += 4) {
    const r = rgba[i]
    const g = rgba[i + 1]
    const b = rgba[i + 2]
    const a = rgba[i + 3]
    if (a < 100) {
      // 浅噪声/极浅抗锯齿像素整体清除，确保裁剪边界紧贴实体图形
      out[i + 3] = 0
      continue
    }
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const chroma = max - min
    const lum = (r + g + b) / 3
    if (chroma > 60) {
      // 饱和彩色（品牌蓝装饰等）——保留原色不透明
      out[i] = r
      out[i + 1] = g
      out[i + 2] = b
      out[i + 3] = a
    } else if (lum >= 235) {
      // 白底与浅色噪声——全透明
      out[i + 3] = 0
    } else if (lum >= 60) {
      // 抗锯齿过渡——前景深色 + 线性 alpha
      out[i] = FG[0]
      out[i + 1] = FG[1]
      out[i + 2] = FG[2]
      out[i + 3] = Math.min(a, Math.round((255 * (235 - lum)) / (235 - 60)))
    } else {
      // 前景主体
      out[i] = FG[0]
      out[i + 1] = FG[1]
      out[i + 2] = FG[2]
      out[i + 3] = a
    }
  }
  return out
}

// ── 裁剪到非透明 bounding box ───────────────────────────
function trim(rgba, width, height) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = rgba[(y * width + x) * 4 + 3]
      if (a > 20) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return { rgba, width: 0, height: 0 }
  const tw = maxX - minX + 1
  const th = maxY - minY + 1
  const out = Buffer.alloc(tw * th * 4)
  for (let y = 0; y < th; y++) {
    rgba.copy(out, y * tw * 4, ((minY + y) * width + minX) * 4, ((minY + y) * width + minX + tw) * 4)
  }
  return { rgba: out, width: tw, height: th }
}

// ── main ─────────────────────────────────────────────────
const [src, dst] = process.argv.slice(2)
if (!src || !dst) {
  console.error('用法: node scripts/make-transparent.cjs <in.png> <out.png>')
  process.exit(1)
}
const whiteVariant = process.argv.includes('--white')
const { width, height, rgba } = decodePng(fs.readFileSync(src))
const transparent = whiteToTransparent(rgba, width, height, whiteVariant ? [255, 255, 255] : undefined)
const trimmed = trim(transparent, width, height)
fs.writeFileSync(dst, encodePng(trimmed.rgba, trimmed.width, trimmed.height))
console.log(`已生成透明版 ${dst}（裁剪至图形边界 ${trimmed.width}×${trimmed.height}）`)
