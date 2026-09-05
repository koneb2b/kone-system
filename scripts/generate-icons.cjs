/**
 * generate-icons.cjs — 从新品牌 logo 源图重新生成窗口/托盘图标。
 *
 * 零依赖：手动解析 PNG（IHDR/IDAT + 5 种滤波器），box 下采样到目标尺寸，
 * 重新编码 PNG（无滤波 + zlib deflate + CRC32），并写入单尺寸 PNG 内嵌的 ICO。
 *
 * 用法: node scripts/generate-icons.cjs <source.png> <out.png> <out.ico>
 */
const fs = require('fs')
const zlib = require('zlib')

// ── PNG 解码 ─────────────────────────────────────────────
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
        if (bpp === 4) {
          rgba[di] = out[i]
          rgba[di + 1] = out[i + 1]
          rgba[di + 2] = out[i + 2]
          rgba[di + 3] = out[i + 3]
        } else {
          rgba[di] = out[i]
          rgba[di + 1] = out[i + 1]
          rgba[di + 2] = out[i + 2]
          rgba[di + 3] = 255
        }
      }
    }
    prev = out.slice()
  }
  return { width, height, rgba }
}

// ── 缩放（box 下采样）───────────────────────────────────
function resize(rgba, srcW, srcH, dstW, dstH) {
  const out = Buffer.alloc(dstW * dstH * 4)
  const xRatio = srcW / dstW
  const yRatio = srcH / dstH
  for (let dy = 0; dy < dstH; dy++) {
    const y0 = Math.floor(dy * yRatio)
    const y1 = Math.max(y0 + 1, Math.floor((dy + 1) * yRatio))
    for (let dx = 0; dx < dstW; dx++) {
      const x0 = Math.floor(dx * xRatio)
      const x1 = Math.max(x0 + 1, Math.floor((dx + 1) * xRatio))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const si = (sy * srcW + sx) * 4
          r += rgba[si]
          g += rgba[si + 1]
          b += rgba[si + 2]
          a += rgba[si + 3]
          n++
        }
      }
      const di = (dy * dstW + dx) * 4
      out[di] = Math.round(r / n)
      out[di + 1] = Math.round(g / n)
      out[di + 2] = Math.round(b / n)
      out[di + 3] = Math.round(a / n)
    }
  }
  return out
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
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  // 每行前加 filter byte 0（无滤波）
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

// ── ICO 编码（单尺寸 PNG 内嵌，256×256）────────────────
function encodeIco(pngBuf, size) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type = icon
  header.writeUInt16LE(1, 4) // count
  const entry = Buffer.alloc(16)
  entry[0] = size >= 256 ? 0 : size // width（0 表示 256）
  entry[1] = size >= 256 ? 0 : size // height
  entry[2] = 0 // color count
  entry[3] = 0 // reserved
  entry.writeUInt16LE(1, 4) // planes
  entry.writeUInt16LE(32, 6) // bit count
  entry.writeUInt32LE(pngBuf.length, 8) // bytes in resource
  entry.writeUInt32LE(6 + 16, 12) // image offset
  return Buffer.concat([header, entry, pngBuf])
}

// ── main ─────────────────────────────────────────────────
const [src, outPng, outIco] = process.argv.slice(2)
if (!src || !outPng || !outIco) {
  console.error('用法: node scripts/generate-icons.cjs <source.png> <out.png> <out.ico>')
  process.exit(1)
}

const { width, height, rgba } = decodePng(fs.readFileSync(src))
console.log(`源图 ${width}×${height}`)

// 生成 256×256 窗口/托盘图标
const small = resize(rgba, width, height, 256, 256)
const png256 = encodePng(small, 256, 256)
fs.writeFileSync(outPng, png256)
fs.writeFileSync(outIco, encodeIco(png256, 256))
console.log(`已生成 ${outPng} 与 ${outIco}（256×256）`)
