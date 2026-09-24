const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array) {
  const body = new Uint8Array(4 + data.length)
  body.set([...type].map(char => char.charCodeAt(0)), 0)
  body.set(data, 4)
  const out = new Uint8Array(12 + data.length)
  new DataView(out.buffer).setUint32(0, data.length)
  out.set(body, 4)
  new DataView(out.buffer).setUint32(8 + data.length, crc32(body))
  return out
}

async function deflate(data: Uint8Array) {
  const stream = new CompressionStream('deflate')
  const writer = stream.writable.getWriter()
  await writer.write(new Uint8Array(data))
  await writer.close()
  return new Uint8Array(await new Response(stream.readable).arrayBuffer())
}

export async function encodeMockMatte(width: number, height: number) {
  const safeWidth = Math.max(1, Math.round(width))
  const safeHeight = Math.max(1, Math.round(height))
  const stride = safeWidth * 4 + 1
  const raw = new Uint8Array(stride * safeHeight)
  const radiusX = safeWidth * 0.28
  const radiusY = safeHeight * 0.36
  const centerX = safeWidth / 2
  const centerY = safeHeight / 2
  for (let y = 0; y < safeHeight; y += 1) {
    const row = y * stride
    for (let x = 0; x < safeWidth; x += 1) {
      const dx = (x + 0.5 - centerX) / radiusX
      const dy = (y + 0.5 - centerY) / radiusY
      if (dx * dx + dy * dy > 1) continue
      const pixel = row + 1 + x * 4
      raw[pixel] = 32
      raw[pixel + 1] = 168
      raw[pixel + 2] = 132
      raw[pixel + 3] = 255
    }
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, safeWidth)
  view.setUint32(4, safeHeight)
  header[8] = 8
  header[9] = 6
  const png = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', await deflate(raw)),
    chunk('IEND', new Uint8Array()),
  ]
  const bytes = new Uint8Array(png.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of png) {
    bytes.set(part, offset)
    offset += part.length
  }
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `data:image/png;base64,${btoa(binary)}`
}
