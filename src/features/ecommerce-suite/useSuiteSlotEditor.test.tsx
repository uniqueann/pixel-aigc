// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { SuiteProjectDetail } from '@shared/ecommerce-suite-runtime'
import type { SuiteClient } from './api'
import { CloudError } from '@/cloud/client'
import { saveLocalSuiteDraft } from './backup'
import { useSuiteSlotEditor } from './useSuiteSlotEditor'
vi.mock('./backup', () => ({ readLocalSuiteDraft: vi.fn().mockResolvedValue(undefined), saveLocalSuiteDraft: vi.fn().mockResolvedValue(undefined), archiveSuiteDraft: vi.fn().mockResolvedValue(undefined) }))
const fixture=JSON.parse(readFileSync('docs/verification/ecommerce-suite/phase-one/contract-fixtures.json','utf8'))
const detail: SuiteProjectDetail = { project:fixture.project,assets:[],versions:[fixture.version],drafts:fixture.project.config.slots.map((slot:{id:string})=>({slotId:slot.id,revision:0,value:null})),tasks:[],batches:[],operations:[] }
describe('生成要求与图层共用草稿', () => {
  beforeEach(() => { vi.mocked(saveLocalSuiteDraft).mockResolvedValue(undefined) })
  it('旧阶段只有生成要求的空基准草稿可以继续编辑当前成品，原要求保留', async () => {
    const slot=detail.project.config.slots[0].id, version={...fixture.version,slotId:slot}
    const data: SuiteProjectDetail={...detail,versions:[version],project:{...detail.project,slotHeads:detail.project.slotHeads.map(head=>head.slotId===slot?{...head,activeVersionId:version.id}:head)},
      drafts:detail.drafts.map(item=>item.slotId===slot?{...item,value:{expectedDraftRevision:0,baseVersionId:null,promptNote:'旧阶段已保存的生成要求',count:1,resolution:'1k',modelProfileId:null,layers:[]}}:item)}
    const signal=new AbortController().signal, client={} as SuiteClient
    const view=renderHook(()=>useSuiteSlotEditor(data,client,signal,false))
    await waitFor(()=>expect(view.result.current.records.get(slot)?.value.baseVersionId).toBe(version.id))
    expect(view.result.current.records.get(slot)?.value.promptNote).toBe('旧阶段已保存的生成要求')
    expect(view.result.current.records.get(slot)?.value.layers).toEqual(version.composition.layersSnapshot)
    view.unmount()
  })
  it('连续修改两个页签后只按同一修订保存完整草稿，不丢失对方字段', async () => {
    const draft=vi.fn().mockImplementation(async (_id,_slot,value)=>({value,revision:value.expectedDraftRevision+1}))
    const client={draft} as unknown as SuiteClient, signal=new AbortController().signal
    const view=renderHook(()=>useSuiteSlotEditor(detail,client,signal,false)), slot=detail.project.config.slots[0].id
    await waitFor(()=>expect(view.result.current.records.has(slot)).toBe(true))
    act(()=>{view.result.current.edit(slot,{promptNote:'保留商品颜色'});view.result.current.edit(slot,{layers:fixture.version.composition.layersSnapshot})})
    await act(()=>view.result.current.flushAll())
    expect(draft).toHaveBeenCalledTimes(1)
    expect(draft.mock.calls[0][2]).toMatchObject({expectedDraftRevision:0,promptNote:'保留商品颜色',layers:fixture.version.composition.layersSnapshot})
    expect(view.result.current.records.get(slot)?.dirty).toBe(false)
    view.unmount()
  })
  it('409 保留完整本机草稿，后台读模型不能替换脏编辑', async () => {
    const client={draft:vi.fn().mockRejectedValue(new CloudError(409,'云端修订已变','SUITE_REVISION_CONFLICT'))} as unknown as SuiteClient, signal=new AbortController().signal
    const view=renderHook(({data})=>useSuiteSlotEditor(data,client,signal,false),{initialProps:{data:detail}}), slot=detail.project.config.slots[0].id
    await waitFor(()=>expect(view.result.current.records.has(slot)).toBe(true))
    act(()=>view.result.current.edit(slot,{promptNote:'本机未同步内容',layers:fixture.version.composition.layersSnapshot}))
    view.rerender({data:{...detail,drafts:detail.drafts.map(item=>({...item,revision:9}))}})
    await act(async()=>{await expect(view.result.current.flushAll()).rejects.toThrow('云端修订已变')})
    expect(view.result.current.records.get(slot)).toMatchObject({dirty:true,value:{promptNote:'本机未同步内容',layers:fixture.version.composition.layersSnapshot}})
    expect(view.result.current.records.get(slot)?.error).toContain('冲突')
    view.unmount()
  })
  it('读取云端会等待在途草稿保存，避免用旧修订覆盖下一次编辑', async () => {
    const slot = detail.project.config.slots[0].id
    const cloudDraft = { expectedDraftRevision: 0, baseVersionId: null, promptNote: '云端草稿', count: 1 as const, resolution: '1k' as const, modelProfileId: null, layers: [] }
    let releaseDraft: (value: { value: unknown; revision: number }) => void = () => undefined
    let releaseGet: (value: SuiteProjectDetail) => void = () => undefined
    let serverRevision = 0
    const draft = vi.fn(() => new Promise<{ value: unknown; revision: number }>(resolve => { releaseDraft = resolve }))
    // 读取请求在保存提交之前发出，但响应晚于保存返回：这是本轮要覆盖的真实时序。
    const get = vi.fn(() => {
      const revision = serverRevision
      return new Promise<SuiteProjectDetail>(resolve => {
        releaseGet = () => resolve({ ...detail, drafts: detail.drafts.map(item => item.slotId === slot ? { ...item, revision, value: cloudDraft as never } : item) })
      })
    })
    const client = { draft, get } as unknown as SuiteClient
    const signal = new AbortController().signal
    const view = renderHook(() => useSuiteSlotEditor(detail, client, signal, false))
    await waitFor(() => expect(view.result.current.records.has(slot)).toBe(true))

    act(() => view.result.current.edit(slot, { promptNote: '本机编辑' }))
    const flushing = view.result.current.flushSlot(slot)
    const reading = view.result.current.readCloud(slot)
    await waitFor(() => expect(draft).toHaveBeenCalledTimes(1))

    // 保存仍在途时不能先读云端，否则读到的是保存前的修订。
    expect(get).not.toHaveBeenCalled()

    serverRevision = 1
    releaseDraft({ value: { ...cloudDraft, promptNote: '本机编辑' }, revision: 1 })
    await act(async () => { await flushing })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    releaseGet(detail)
    await act(async () => { await reading })

    expect(view.result.current.records.get(slot)?.value.expectedDraftRevision).toBe(1)
    expect(view.result.current.records.get(slot)?.dirty).toBe(false)
    view.unmount()
  })
  it('重置后多个等待者恢复时不会用同一修订号重复保存', async () => {
    const slot = detail.project.config.slots[0].id
    const version = { ...fixture.version, slotId: slot }
    let releaseFirst: (value: { value: unknown; revision: number }) => void = () => undefined
    let releaseGet: (value: SuiteProjectDetail) => void = () => undefined
    const used = new Set<number>()
    let calls = 0
    const draft = vi.fn((_id: string, _slot: string, value: { expectedDraftRevision: number }) => {
      // 服务端按修订号串行：两个保存用同一修订号时后者必然 409。
      if (used.has(value.expectedDraftRevision)) return Promise.reject(new CloudError(409, '云端修订已变', 'SUITE_REVISION_CONFLICT'))
      used.add(value.expectedDraftRevision)
      if (++calls === 1) return new Promise<{ value: unknown; revision: number }>(resolve => { releaseFirst = resolve })
      return Promise.resolve({ value, revision: value.expectedDraftRevision + 1 })
    })
    const get = vi.fn(() => new Promise<SuiteProjectDetail>(resolve => { releaseGet = resolve }))
    const client = { draft, get } as unknown as SuiteClient
    const signal = new AbortController().signal
    const view = renderHook(() => useSuiteSlotEditor(detail, client, signal, false))
    await waitFor(() => expect(view.result.current.records.has(slot)).toBe(true))

    act(() => view.result.current.edit(slot, { promptNote: '本机编辑' }))
    const flushing = view.result.current.flushSlot(slot)
    const resetting = view.result.current.reset(slot, version)
    // 自动保存定时器在重置等待期间也排队，重置结束后两个等待者会同时恢复。
    const waiting = view.result.current.flushSlot(slot)
    await waitFor(() => expect(draft).toHaveBeenCalledTimes(1))
    releaseFirst({ value: { promptNote: '本机编辑' }, revision: 1 })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    releaseGet({ ...detail, drafts: detail.drafts.map(item => item.slotId === slot ? { ...item, revision: 1 } : item) })
    await act(async () => { await Promise.all([flushing, resetting, waiting]) })

    // 每次保存必须使用不同的修订号，否则后一个会被误判为冲突。
    expect(draft.mock.calls.map(call => call[2].expectedDraftRevision)).toEqual([...used])
    expect(used.size).toBe(draft.mock.calls.length)
    expect(view.result.current.records.get(slot)?.error).toBeUndefined()
    view.unmount()
  })
  it('本机草稿写入失败时仍保存云端，并清除本机错误提示', async () => {
    vi.mocked(saveLocalSuiteDraft).mockRejectedValue(new Error('本地存储空间不足'))
    const draft=vi.fn().mockImplementation(async (_id:string,_slot:string,value:{expectedDraftRevision:number})=>({value,revision:value.expectedDraftRevision+1}))
    const client={draft} as unknown as SuiteClient, signal=new AbortController().signal
    const view=renderHook(()=>useSuiteSlotEditor(detail,client,signal,false)), slot=detail.project.config.slots[0].id
    await waitFor(()=>expect(view.result.current.records.has(slot)).toBe(true))
    act(()=>view.result.current.edit(slot,{promptNote:'本机编辑'}))
    await act(async()=>{await view.result.current.flushAll()})
    expect(draft).toHaveBeenCalledTimes(1)
    expect(view.result.current.records.get(slot)?.dirty).toBe(false)
    expect(view.result.current.records.get(slot)?.error).toBeUndefined()
    view.unmount()
  })
})
