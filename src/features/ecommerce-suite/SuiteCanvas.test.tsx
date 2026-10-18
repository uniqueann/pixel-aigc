// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SuiteAssetRef, SuiteComposition } from '@shared/ecommerce-suite'
import type { SuiteClient } from './api'
import SuiteCanvas from './SuiteCanvas'

const backupAssetBlob = vi.hoisted(() => vi.fn(async () => new Blob(['preview'], { type: 'image/png' })))
vi.mock('./recoveryPackage', () => ({ backupAssetBlob }))
vi.mock('./render', () => ({ paintSuite: vi.fn(async () => []) }))

const fixture = JSON.parse(readFileSync('docs/verification/ecommerce-suite/phase-one/contract-fixtures.json', 'utf8'))
const asset = fixture.asset as SuiteAssetRef
const composition = fixture.version.composition as SuiteComposition

describe('套图主预览', () => {
  it('轮询替换资产对象时不重新下载原图，切换版本才重新读取', async () => {
    backupAssetBlob.mockClear()
    const client = { assertCurrent: () => undefined } as unknown as SuiteClient
    const signal = new AbortController().signal
    const view = render(<SuiteCanvas asset={asset} composition={composition} client={client} signal={signal} onSelect={() => undefined} onChange={() => undefined} editable={false} />)
    await waitFor(() => expect(backupAssetBlob).toHaveBeenCalledTimes(1))
    view.rerender(<SuiteCanvas asset={{ ...asset }} composition={{ ...composition }} client={client} signal={signal} onSelect={() => undefined} onChange={() => undefined} editable={false} />)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(backupAssetBlob).toHaveBeenCalledTimes(1)
    view.rerender(<SuiteCanvas asset={{ ...asset, assetId: '00000000-0000-4000-8000-000000000099', checksum: 'c'.repeat(64) }} composition={composition} client={client} signal={signal} onSelect={() => undefined} onChange={() => undefined} editable={false} />)
    await waitFor(() => expect(backupAssetBlob).toHaveBeenCalledTimes(2))
    view.unmount()
  })
})
