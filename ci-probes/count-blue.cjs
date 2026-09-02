// 仅供 fork 内部探测使用：解开一张 PNG，数出接近指定颜色的像素个数。
// 用来判断菜单栏截图里托盘图标的颜色有没有被 setTemplateImage 吃掉。
const fs = require('fs')
const zlib = require('zlib')

function readPng(file) {
  const buf = fs.readFileSync(file)
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len
  }
  if (bitDepth !== 8) throw new Error('unsupported bit depth ' + bitDepth)
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (!channels) throw new Error('unsupported colour type ' + colorType)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(height * stride)
  let src = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[src++]
    const line = raw.subarray(src, src + stride)
    src += stride
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[i] = v & 0xff
    }
  }
  return { width, height, channels, pixels: out }
}

const [, , file, hex, tolRaw] = process.argv
const target = parseInt((hex || '2f7df6').replace('#', ''), 16)
const tol = parseInt(tolRaw || '60', 10)
const tr = (target >> 16) & 0xff
const tg = (target >> 8) & 0xff
const tb = target & 0xff

const img = readPng(file)
let hits = 0
let bluest = null
for (let i = 0; i < img.pixels.length; i += img.channels) {
  const r = img.pixels[i]
  const g = img.pixels[i + 1]
  const b = img.pixels[i + 2]
  if (Math.abs(r - tr) <= tol && Math.abs(g - tg) <= tol && Math.abs(b - tb) <= tol) {
    hits++
    if (!bluest) bluest = [r, g, b]
  }
}
console.log(
  `PROBE 尺寸=${img.width}x${img.height} 通道=${img.channels} 命中像素=${hits} 样例=${bluest ? bluest.join(',') : '无'}`
)
