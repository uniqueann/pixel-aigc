import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SuitePrecheck } from '@shared/ecommerce-suite-precheck'
import { suiteCheck, SUITE_RULE_VERSION } from '@shared/ecommerce-suite-precheck'
const mocks = vi.hoisted(() => ({ encode: vi.fn(), zip: vi.fn() }))
vi.mock('./render', () => ({ encodeSuiteImage: mocks.encode }))
vi.mock('@/pages/Toolbox/shared/zip', () => ({ createResultZip: mocks.zip }))
import { encodeSuiteSelection, suiteExportManifest, zipSuiteExport } from './export'
const fixture = JSON.parse(readFileSync('docs/verification/ecommerce-suite/phase-one/contract-fixtures.json', 'utf8'))
const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])
function report(): SuitePrecheck {
  return { projectId: fixture.project.id, projectRevision: 0, title: '../商品/\n', platform: 'general', ruleProfile: { id: 'general', version: SUITE_RULE_VERSION },
    ruleVersion: SUITE_RULE_VERSION, ruleReviewedAt: '2026-10-17', checkedAt: new Date().toISOString(), fingerprint: 'a'.repeat(64),
    checkedVersionIds: [], output: { platform: 'general', width: 1200, height: 1000, format: 'png', background: 'transparent' }, checks: [],
    items: [0, 1].map(index => ({ slot: { ...fixture.project.config.slots[index], name: '同名/槽位', order: index },
      version: { ...fixture.version, id: crypto.randomUUID(), composition: { ...fixture.version.composition, layersSnapshot: [] } }, asset: fixture.asset, checks: [] })) }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); mocks.encode.mockReset(); mocks.zip.mockReset() })
describe('冻结成品与逐文件失败恢复', () => {
  it('累计成品超过 200 MB 时保留已有文件，阻止超限文件进入 ZIP', async () => {
    const frozen = report()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1200, height: 1000, close: vi.fn() })))
    const large = new Blob([png], { type: 'image/png' })
    Object.defineProperty(large, 'size', { value: 200 * 1024 * 1024 - 5 })
    mocks.encode.mockResolvedValueOnce(large).mockResolvedValueOnce(new Blob([png], { type: 'image/png' }))
    const files = await encodeSuiteSelection(frozen, async () => new Blob([png]), new AbortController().signal)
    expect(files[0].blob).toBe(large)
    expect(files[1].blob).toBeUndefined()
    expect(files[1].error).toContain('超过 200 MB')
  })
  it('只串行处理图片，保留成功项；重试只读取失败文件且不修改冻结快照', async () => {
    const frozen = report(), before = JSON.stringify(frozen), close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1200, height: 1000, close })))
    mocks.encode.mockImplementation(async () => new Blob([png], { type: 'image/png' }))
    const read = vi.fn(async item => { if (item.slot.order === 1) throw new Error('对象暂不可读'); return new Blob([png]) })
    const result = await encodeSuiteSelection(frozen, read, new AbortController().signal)
    expect(result[0].blob).toBeDefined(); expect(result[1].error).toContain('暂不可读')
    expect(close).toHaveBeenCalledTimes(1)
    const retry = vi.fn(async () => new Blob([png]))
    const final = await encodeSuiteSelection(frozen, retry, new AbortController().signal, undefined, result)
    expect(retry).toHaveBeenCalledTimes(1); expect(final[0].blob).toBe(result[0].blob)
    expect(new Set(final.map(file => file.name)).size).toBe(2)
    expect(final.every(file => !/[\n/\\]/.test(file.name))).toBe(true)
    expect(JSON.stringify(frozen)).toBe(before)
  })
  it('确定失败不读取底图，取消停止后续文件', async () => {
    const frozen = report(), read = vi.fn(async () => new Blob([png]))
    frozen.items[0].checks = [suiteCheck('main', 'fail', '主图图层', '不允许')]
    const controller = new AbortController()
    controller.abort()
    await expect(encodeSuiteSelection(frozen, read, controller.signal)).rejects.toThrow()
    expect(read).not.toHaveBeenCalled()
    frozen.items = [frozen.items[0]]
    expect((await encodeSuiteSelection(frozen, read, new AbortController().signal))[0].error).toContain('确定性失败')
    expect(read).not.toHaveBeenCalled()
  })
  it('未知项需要人工确认，部分失败需要确认，成品包不携带恢复身份或短期地址', async () => {
    const frozen = report()
    frozen.checks.push(suiteCheck('manual', 'unknown', '外观', '需人工检查', '', 'manual'))
    const files = [{ slotId: frozen.items[0].slot.id, versionId: frozen.items[0].version.id, name: '01.png', checks: [], blob: new Blob([png]) },
      { slotId: frozen.items[1].slot.id, versionId: frozen.items[1].version.id, name: '02.png', checks: [], error: '对象缺失' }]
    expect(() => suiteExportManifest(frozen, files, [], false)).toThrow('确认')
    await expect(zipSuiteExport(frozen, files, [], true, false)).rejects.toThrow('仅导出成功项')
    mocks.zip.mockResolvedValue(new Blob(['zip']))
    await zipSuiteExport(frozen, files, [], true, true)
    const entries = mocks.zip.mock.calls[0][0] as { name: string; blob: Blob }[]
    expect(entries.map(file => file.name)).toEqual(['01.png', 'manifest.json'])
    const manifest = JSON.parse(await entries[1].blob.text())
    expect(manifest.format).toBe('pixel-suite-export')
    expect(manifest.skipped).toHaveLength(1)
    expect(JSON.stringify(manifest)).not.toMatch(/objectKey|sourceTask|promptSnapshot|access_token|signedUrl/)
  })
})
