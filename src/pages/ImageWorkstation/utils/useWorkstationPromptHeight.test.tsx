// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { calculatePromptTargetHeight } from './useWorkstationPromptHeight'

describe('工作站多行文本框高度计算', () => {
  it('右侧参数配置区域小于左侧时，计算扩展高度使左右两栏高度对齐', () => {
    // 左侧展示区高度 600px
    // 右侧设置区高度 360px，其中文本框高 100px，其他元素合计 260px
    // 自然基础高度 100px
    const target = calculatePromptTargetHeight({
      previewHeight: 600,
      settingsHeight: 360,
      textareaHeight: 100,
      naturalHeight: 100,
    })

    // 目标文本框高度 = 600 - 260 = 340px
    expect(target).toBe(340)
  })

  it('右侧参数配置区域大于或等于左侧时，不干预高度（返回 undefined）', () => {
    // 左侧 400px，右侧 500px（文本框 150px，其他 350px）
    const target = calculatePromptTargetHeight({
      previewHeight: 400,
      settingsHeight: 500,
      textareaHeight: 150,
      naturalHeight: 150,
    })

    expect(target).toBeUndefined()
  })

  it('左右高度正好相等时，不干预高度（返回 undefined）', () => {
    const target = calculatePromptTargetHeight({
      previewHeight: 450,
      settingsHeight: 450,
      textareaHeight: 120,
      naturalHeight: 120,
    })

    expect(target).toBeUndefined()
  })

  it('多行文本框内容撑开高度已超出目标高度时，不缩小文本框（返回 undefined）', () => {
    // 用户输入较长内容，scrollHeight 达到 280px，而左侧仅能容纳 250px 的文本框
    const target = calculatePromptTargetHeight({
      previewHeight: 500,
      settingsHeight: 530,
      textareaHeight: 280,
      naturalHeight: 280,
    })

    expect(target).toBeUndefined()
  })

  it('高度异常或非正值时返回 undefined', () => {
    expect(calculatePromptTargetHeight({
      previewHeight: 0,
      settingsHeight: 400,
      textareaHeight: 100,
      naturalHeight: 100,
    })).toBeUndefined()

    expect(calculatePromptTargetHeight({
      previewHeight: 500,
      settingsHeight: 0,
      textareaHeight: 100,
      naturalHeight: 100,
    })).toBeUndefined()
  })
})
