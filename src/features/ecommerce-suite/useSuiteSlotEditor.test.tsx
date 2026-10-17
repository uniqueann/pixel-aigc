// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { SuiteProjectDetail } from '@shared/ecommerce-suite-runtime'
import type { SuiteClient } from './api'
import { CloudError } from '@/cloud/client'
import { useSuiteSlotEditor } from './useSuiteSlotEditor'
vi.mock('./backup', () => ({ readLocalSuiteDraft: vi.fn().mockResolvedValue(undefined), saveLocalSuiteDraft: vi.fn().mockResolvedValue(undefined), archiveSuiteDraft: vi.fn().mockResolvedValue(undefined) }))
const fixture=JSON.parse(readFileSync('docs/verification/ecommerce-suite/phase-one/contract-fixtures.json','utf8'))
const detail: SuiteProjectDetail = { project:fixture.project,assets:[],versions:[fixture.version],drafts:fixture.project.config.slots.map((slot:{id:string})=>({slotId:slot.id,revision:0,value:null})),tasks:[],batches:[],operations:[] }
describe('生成要求与图层共用草稿', () => {
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
})
