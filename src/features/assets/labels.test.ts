import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { useLocaleStore } from '@/i18n/store'
import { Capability } from '@/types'
import { capabilityLabel, emailOperationLabel, taskStatusLabel, workstationSlugForCapability, workstationToolLabel } from './labels'

describe('资产列表文案', () => {
  it('工作站工具和邮件操作沿用现有中文名', () => {
    expect(workstationToolLabel('repaint')).toBe('重绘')
    expect(workstationToolLabel('remove')).toBe('消除')
    expect(workstationToolLabel('outpaint')).toBe('扩图')
    expect(capabilityLabel(Capability.Inpaint, 'repaint')).toBe('重绘')
    expect(workstationToolLabel('variation')).toBe('裂变')
    expect(workstationToolLabel('smart-edit')).toBe('智能编辑')
    expect(capabilityLabel(Capability.Variation)).toBe('裂变')
    expect(capabilityLabel(Capability.ImageEdit, 'smart-edit')).toBe('智能编辑')
    expect(emailOperationLabel('summarize')).toBe('总结')
    expect(workstationSlugForCapability(Capability.Variation)).toBe('variation')
    expect(workstationSlugForCapability(Capability.ImageEdit)).toBe('smart-edit')
    expect(taskStatusLabel('succeeded')).toBe('已完成')
    expect(taskStatusLabel('queued')).toBe('排队中')
    expect(taskStatusLabel('pending')).toBe('排队中')
    expect(taskStatusLabel('processing')).toBe('进行中')
    expect(workstationToolLabel('bg-remove')).toBe('智能抠图')
    expect(capabilityLabel(Capability.BgRemove, 'bg-remove')).toBe('智能抠图')
    expect(workstationSlugForCapability(Capability.TextToImage)).toBe('text-to-image')
    expect(workstationToolLabel('text-to-image')).toBe('文生图')
    expect(capabilityLabel(Capability.TextToImage)).toBe('文生图')
    expect(capabilityLabel(Capability.TextToImage, 'text-to-image')).toBe('文生图')
  })
})

describe('assets labels (en-US)', () => {
  afterEach(async () => {
    await useLocaleStore.getState().setLocale('zh-CN')
  })

  afterAll(async () => {
    await useLocaleStore.getState().setLocale('zh-CN')
  })

  it('resolves workstation, toolbox, canvas, email, and status labels in English', async () => {
    await useLocaleStore.getState().setLocale('en-US')
    expect(workstationToolLabel('repaint')).toBe('Inpaint')
    expect(workstationToolLabel('remove')).toBe('Erase')
    expect(workstationToolLabel('outpaint')).toBe('Outpaint')
    expect(workstationToolLabel('variation')).toBe('Variation')
    expect(workstationToolLabel('smart-edit')).toBe('Smart Edit')
    expect(workstationToolLabel('bg-remove')).toBe('Background Removal')
    expect(workstationToolLabel('text-to-image')).toBe('Text to Image')
    expect(workstationToolLabel()).toBe('Image Studio')
    expect(capabilityLabel(Capability.Inpaint, 'repaint')).toBe('Inpaint')
    expect(capabilityLabel(Capability.Variation)).toBe('Variation')
    expect(capabilityLabel(Capability.EmailAssist)).toBe('Email Assistant')
    expect(emailOperationLabel('summarize')).toBe('Summarize')
    expect(emailOperationLabel()).toBe('Email Assistant')
    expect(taskStatusLabel('succeeded')).toBe('Completed')
    expect(taskStatusLabel('failed')).toBe('Failed')
    expect(taskStatusLabel('cancelled')).toBe('Cancelled')
    expect(taskStatusLabel('queued')).toBe('Queued')
    expect(taskStatusLabel('pending')).toBe('Queued')
    expect(taskStatusLabel('processing')).toBe('In progress')
  })
})
