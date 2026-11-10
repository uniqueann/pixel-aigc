import type { OutpaintOutputMode } from '@shared/outpaint'

export type OutpaintMode = 'free' | 'preset'

/**
 * 扩图的「输出目标」只有三选一：
 * - free：自由扩展，从原图向外拖拽；
 * - platform-ratio：沿用原图分辨率，只把画幅改成平台比例；
 * - platform-size：输出平台要求的精确像素。
 *
 * 持久化仍使用 outpaintMode + outpaintOutputMode 两个字段，这里负责两者之间的映射，
 * 保证任何入口都同时更新，不会再出现「改了一个、另一个被静默改写」。
 */
export type OutpaintTargetMode = 'free' | 'platform-ratio' | 'platform-size'

export function outpaintTargetMode(
  mode: OutpaintMode,
  outputMode: OutpaintOutputMode,
): OutpaintTargetMode {
  if (mode === 'free') return 'free'
  return outputMode === 'platform' ? 'platform-size' : 'platform-ratio'
}

export function outpaintTargetParameters(target: OutpaintTargetMode): {
  outpaintMode: OutpaintMode
  outpaintOutputMode: OutpaintOutputMode
} {
  switch (target) {
    case 'free':
      return { outpaintMode: 'free', outpaintOutputMode: 'original' }
    case 'platform-ratio':
      return { outpaintMode: 'preset', outpaintOutputMode: 'original' }
    case 'platform-size':
      return { outpaintMode: 'preset', outpaintOutputMode: 'platform' }
  }
}
