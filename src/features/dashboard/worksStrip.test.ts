import { describe, expect, it } from 'vitest'
import { worksStripFades } from './worksStrip'

describe('worksStripFades', () => {
  it('scrollLeft 为 0 或贴着起点时不显示左侧渐隐', () => {
    expect(worksStripFades({ scrollLeft: 0, clientWidth: 400, scrollWidth: 900 })).toEqual({ left: false, right: true })
    expect(worksStripFades({ scrollLeft: 0.4, clientWidth: 400, scrollWidth: 900 })).toEqual({ left: false, right: true })
    expect(worksStripFades({ scrollLeft: 2, clientWidth: 400, scrollWidth: 900 })).toEqual({ left: false, right: true })
    expect(worksStripFades({ scrollLeft: 3, clientWidth: 400, scrollWidth: 900 })).toEqual({ left: false, right: true })
    expect(worksStripFades({ scrollLeft: 3, clientWidth: 723, scrollWidth: 1368 })).toEqual({ left: false, right: true })
    expect(worksStripFades({ scrollLeft: 8, clientWidth: 400, scrollWidth: 900 })).toEqual({ left: false, right: true })
    expect(worksStripFades({ scrollLeft: -4, clientWidth: 400, scrollWidth: 900 })).toEqual({ left: false, right: true })
  })

  it('离开起点后左侧渐隐，滚到右端后右侧渐隐消失', () => {
    expect(worksStripFades({ scrollLeft: 9, clientWidth: 400, scrollWidth: 900 })).toEqual({ left: true, right: true })
    expect(worksStripFades({ scrollLeft: 200, clientWidth: 400, scrollWidth: 900 })).toEqual({ left: true, right: true })
    expect(worksStripFades({ scrollLeft: 492, clientWidth: 400, scrollWidth: 900 })).toEqual({ left: true, right: false })
    expect(worksStripFades({ scrollLeft: 498, clientWidth: 400, scrollWidth: 900 })).toEqual({ left: true, right: false })
    expect(worksStripFades({ scrollLeft: 500, clientWidth: 400, scrollWidth: 900 })).toEqual({ left: true, right: false })
  })

  it('一行放得下或几乎贴边时两侧都不渐隐', () => {
    expect(worksStripFades({ scrollLeft: 0, clientWidth: 400, scrollWidth: 400 })).toEqual({ left: false, right: false })
    expect(worksStripFades({ scrollLeft: 0, clientWidth: 400, scrollWidth: 402 })).toEqual({ left: false, right: false })
    expect(worksStripFades({ scrollLeft: 40, clientWidth: 400, scrollWidth: 402 })).toEqual({ left: false, right: false })
    expect(worksStripFades({ scrollLeft: Number.NaN, clientWidth: Number.NaN, scrollWidth: Number.NaN })).toEqual({ left: false, right: false })
  })
})
