import { describe, expect, it } from 'vitest'
import { hexForColorInput, normalizeHex } from './color'

describe('背景色解析', () => {
  it('接受三位和六位十六进制，并统一为大写', () => {
    expect(normalizeHex('#fff')).toBe('#FFFFFF')
    expect(normalizeHex('0a6b52')).toBe('#0A6B52')
    expect(normalizeHex('  #21cfa0  ')).toBe('#21CFA0')
  })

  it('拒绝非法颜色值', () => {
    expect(normalizeHex('')).toBeNull()
    expect(normalizeHex('#12')).toBeNull()
    expect(normalizeHex('white')).toBeNull()
    expect(normalizeHex('#gggggg')).toBeNull()
  })

  it('原生取色器遇到非法值时回退白色', () => {
    expect(hexForColorInput('#0a6b52')).toBe('#0A6B52')
    expect(hexForColorInput('not-a-color')).toBe('#FFFFFF')
  })
})
