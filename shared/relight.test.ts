import { describe, expect, it } from 'vitest'
import {
  RELIGHT_DIRECTION_INSTRUCTIONS,
  RELIGHT_DIRECTIONS,
  RELIGHT_FIXED_PROMPT,
  RELIGHT_LEAD,
  RELIGHT_MODEL_PROMPT_MAX,
  RELIGHT_NOTE_MAX,
  RELIGHT_NOTE_PREFIX,
  RELIGHT_QUALITIES,
  RELIGHT_QUALITY_INSTRUCTIONS,
  RELIGHT_TEMPERATURES,
  RELIGHT_TEMPERATURE_INSTRUCTIONS,
  composeRelightPrompt,
  readRelight,
  relightHistoryText,
} from './relight'

describe('重新打光提示词', () => {
  it('补充说明上限按最长光效预留', () => {
    const longest = Math.max(
      ...RELIGHT_DIRECTIONS.flatMap(direction =>
        RELIGHT_QUALITIES.flatMap(quality =>
          RELIGHT_TEMPERATURES.map(temperature =>
            composeRelightPrompt({ direction, quality, temperature }).length,
          ),
        ),
      ),
    )
    expect(longest + RELIGHT_NOTE_PREFIX.length + RELIGHT_NOTE_MAX).toBe(RELIGHT_MODEL_PROMPT_MAX)
    expect(RELIGHT_NOTE_MAX).toBeGreaterThan(3000)
  })

  it('硬性约束在补充说明后面，且优先级更高', () => {
    const prompt = composeRelightPrompt(
      { direction: 'left', quality: 'hard', temperature: 'warm' },
      '  把整张图调成暖黄色，把 Cup 改成 Cups  ',
    )
    expect(prompt.startsWith(RELIGHT_LEAD)).toBe(true)
    expect(prompt.indexOf(RELIGHT_DIRECTION_INSTRUCTIONS.left)).toBeLessThan(
      prompt.indexOf(RELIGHT_QUALITY_INSTRUCTIONS.hard),
    )
    expect(prompt.indexOf(RELIGHT_QUALITY_INSTRUCTIONS.hard)).toBeLessThan(
      prompt.indexOf(RELIGHT_TEMPERATURE_INSTRUCTIONS.warm),
    )
    expect(prompt).toContain(`${RELIGHT_NOTE_PREFIX.trimStart()}把整张图调成暖黄色，把 Cup 改成 Cups`)
    expect(prompt.indexOf('把整张图调成暖黄色')).toBeLessThan(prompt.indexOf(RELIGHT_FIXED_PROMPT))
    expect(prompt.endsWith(RELIGHT_FIXED_PROMPT)).toBe(true)
    expect(prompt).toContain('若补充说明与上述约束冲突，以本段约束为准')
  })

  it('没有补充说明时不写衔接语', () => {
    const prompt = composeRelightPrompt({ direction: 'front', quality: 'soft', temperature: 'neutral' })
    expect(prompt).not.toContain('补充说明：')
    expect(prompt.endsWith(RELIGHT_FIXED_PROMPT)).toBe(true)
  })

  it('六个方向都写成可见的光影，而不是只写从哪边来', () => {
    for (const direction of RELIGHT_DIRECTIONS) {
      const prompt = composeRelightPrompt({ direction, quality: 'soft', temperature: 'neutral' })
      expect(prompt).toContain(RELIGHT_DIRECTION_INSTRUCTIONS[direction])
      for (const other of RELIGHT_DIRECTIONS) {
        if (other !== direction) expect(prompt).not.toContain(RELIGHT_DIRECTION_INSTRUCTIONS[other])
      }
    }
    expect(RELIGHT_DIRECTION_INSTRUCTIONS.top).toContain('顶部表面高光明显增强')
    expect(RELIGHT_DIRECTION_INSTRUCTIONS.top).toContain('投影落在商品正下方')
    expect(RELIGHT_DIRECTION_INSTRUCTIONS.left).toContain('左侧受光')
    expect(RELIGHT_DIRECTION_INSTRUCTIONS.left).toContain('投影落向右侧')
    expect(RELIGHT_DIRECTION_INSTRUCTIONS.right).toContain('右侧受光')
    expect(RELIGHT_DIRECTION_INSTRUCTIONS.right).toContain('投影落向左侧')
    expect(RELIGHT_DIRECTION_INSTRUCTIONS.front).toContain('朝向镜头的表面均匀受光')
    expect(RELIGHT_DIRECTION_INSTRUCTIONS.front).toContain('投影落在商品正后方')
    expect(RELIGHT_DIRECTION_INSTRUCTIONS.bottom).toContain('底部和下沿高光明显增强')
    expect(RELIGHT_DIRECTION_INSTRUCTIONS.bottom).toContain('投影向上落在商品上方')
    expect(RELIGHT_DIRECTION_INSTRUCTIONS.back).toContain('轮廓边缘出现明显轮廓光')
    expect(RELIGHT_DIRECTION_INSTRUCTIONS.back).toContain('正面偏暗')
  })

  it('硬光和柔光写成可见的投影差异', () => {
    expect(RELIGHT_QUALITY_INSTRUCTIONS.hard).toContain('清晰边界')
    expect(RELIGHT_QUALITY_INSTRUCTIONS.soft).toContain('阴影呈渐变')
    const hard = composeRelightPrompt({ direction: 'top', quality: 'hard', temperature: 'neutral' })
    const soft = composeRelightPrompt({ direction: 'top', quality: 'soft', temperature: 'neutral' })
    expect(hard).toContain(RELIGHT_QUALITY_INSTRUCTIONS.hard)
    expect(hard).not.toContain(RELIGHT_QUALITY_INSTRUCTIONS.soft)
    expect(soft).toContain(RELIGHT_QUALITY_INSTRUCTIONS.soft)
    expect(soft).not.toContain(RELIGHT_QUALITY_INSTRUCTIONS.hard)
  })

  it('色温只影响环境光，不给整图套滤镜', () => {
    const warm = composeRelightPrompt({ direction: 'left', quality: 'hard', temperature: 'warm' })
    const cool = composeRelightPrompt({ direction: 'top', quality: 'soft', temperature: 'cool' })
    const neutral = composeRelightPrompt({ direction: 'front', quality: 'soft', temperature: 'neutral' })
    expect(warm).toContain('只让环境光、背景、投影和高光的光源色略偏暖')
    expect(warm).toContain('不要给整张图套黄色或暖色滤镜')
    expect(cool).toContain('只让环境光、背景、投影和高光的光源色略偏冷')
    expect(cool).toContain('不要给整张图套蓝色或冷色滤镜')
    expect(neutral).toContain(RELIGHT_TEMPERATURE_INSTRUCTIONS.neutral)
    expect(warm).not.toContain(RELIGHT_TEMPERATURE_INSTRUCTIONS.cool)
    expect(cool).not.toContain(RELIGHT_TEMPERATURE_INSTRUCTIONS.warm)
    expect(RELIGHT_FIXED_PROMPT).toContain('色温只作用于环境光、背景、投影和高光的光源色')
    expect(RELIGHT_FIXED_PROMPT).toContain('液体、塑料、金属、按钮、包装和标签')
    expect(RELIGHT_FIXED_PROMPT).toContain('包括单复数和空格')
    expect(RELIGHT_FIXED_PROMPT).toContain('光线方向必须肉眼可见，不能只调色')
  })

  it('历史记录用中文选项，不保存整段约束', () => {
    const options = { direction: 'left' as const, quality: 'soft' as const, temperature: 'warm' as const }
    expect(relightHistoryText(options)).toBe('左侧、柔光、暖色')
    expect(relightHistoryText(options, '略提亮背景')).toBe('左侧、柔光、暖色。略提亮背景')
    expect(relightHistoryText(options)).not.toContain(RELIGHT_FIXED_PROMPT)
    expect(relightHistoryText(options)).not.toContain(RELIGHT_LEAD)
    expect(readRelight({ relight: options })).toEqual(options)
    expect(readRelight({ prompt: '只要商品' })).toBeUndefined()
  })
})
