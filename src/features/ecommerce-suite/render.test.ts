import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { SuiteComposition } from '@shared/ecommerce-suite'
import { encodeSuiteImage } from './render'
const fixture = JSON.parse(readFileSync('docs/verification/ecommerce-suite/phase-one/contract-fixtures.json', 'utf8'))
const composition = (rendererVersion: string, layers = false): SuiteComposition => ({ ...fixture.version.composition, rendererVersion, layersSnapshot: layers ? fixture.version.composition.layersSnapshot : [] })
describe('编码入口接受可重放的历史渲染器', () => {
  it('无图层 suite-base-v1 不因渲染器被拒绝，未知或带图层的旧渲染器在画板之前失败', async () => {
    const blob = new Blob(['x'])
    await expect(encodeSuiteImage(blob, composition('suite-unknown-v9'))).rejects.toThrow('不支持该渲染器')
    await expect(encodeSuiteImage(blob, composition('suite-base-v1', true))).rejects.toThrow('不支持该渲染器')
    await expect(encodeSuiteImage(blob, composition('suite-base-v1'))).rejects.not.toThrow('不支持该渲染器')
    await expect(encodeSuiteImage(blob, composition('suite-canvas-v1'))).rejects.not.toThrow('不支持该渲染器')
  })
})
