import { describe, expect, it } from 'vitest'
import { Capability } from '@/types'
import { capabilityLabel, emailOperationLabel, taskStatusLabel, workstationToolLabel } from './labels'

describe('资产列表文案', () => {
  it('工作站工具和邮件操作沿用现有中文名', () => {
    expect(workstationToolLabel('repaint')).toBe('重绘')
    expect(workstationToolLabel('remove')).toBe('消除')
    expect(workstationToolLabel('outpaint')).toBe('扩图')
    expect(capabilityLabel(Capability.Inpaint, 'repaint')).toBe('重绘')
    expect(emailOperationLabel('summarize')).toBe('总结')
    expect(taskStatusLabel('succeeded')).toBe('已完成')
  })
})
