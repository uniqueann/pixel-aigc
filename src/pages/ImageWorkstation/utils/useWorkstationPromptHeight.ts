import { useEffect, useState } from 'react'

export interface CalculatePromptTargetHeightParams {
  previewHeight: number
  settingsHeight: number
  textareaHeight: number
  naturalHeight: number
}

/**
 * 计算多行文本框目标高度：
 * 仅在右侧参数配置区域小于左侧展示或图片上传区域时，计算弥补高度差后的文本框高度，
 * 使右侧参数设置区域整体高度与左侧保持一致。
 * 若右侧参数区域本身已大于或等于左侧，或文本框内容撑开的高度已超出目标高度，则不干预（返回 undefined）。
 */
export function calculatePromptTargetHeight({
  previewHeight,
  settingsHeight,
  textareaHeight,
  naturalHeight,
}: CalculatePromptTargetHeightParams): number | undefined {
  if (previewHeight <= 0 || settingsHeight <= 0 || textareaHeight <= 0) return undefined
  // 右侧除文本框以外的所有其他元素（标题、状态、模型选择、分辨率、边距等）所占高度
  const otherHeight = settingsHeight - textareaHeight
  if (otherHeight < 0) return undefined

  // 要让 settingsHeight === previewHeight，文本框所需高度为 previewHeight - otherHeight
  const target = Math.round(previewHeight - otherHeight)

  // 仅在右侧参数配置区域小于左侧（即 target > naturalHeight）时才处理
  if (target > naturalHeight) {
    return target
  }
  return undefined
}

export interface UseWorkstationPromptHeightOptions {
  previewPanelRef: React.RefObject<HTMLElement | null>
  settingsPanelRef: React.RefObject<HTMLElement | null>
  activeToolSlug?: string
  enabled?: boolean
}

export function useWorkstationPromptHeight({
  previewPanelRef,
  settingsPanelRef,
  activeToolSlug,
  enabled = true,
}: UseWorkstationPromptHeightOptions) {
  const [promptMinHeight, setPromptMinHeight] = useState<number | undefined>(undefined)

  useEffect(() => {
    if (!enabled) return

    const preview = previewPanelRef.current
    const settings = settingsPanelRef.current
    if (!preview || !settings) return

    let currentHeight: number | undefined
    let baseNaturalHeight = 0

    const desktopQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 901px)') : null

    const update = () => {
      if (desktopQuery && !desktopQuery.matches) {
        if (currentHeight !== undefined) {
          currentHeight = undefined
          setPromptMinHeight(undefined)
        }
        return
      }

      const textarea = settings.querySelector('textarea')
      if (!textarea) {
        if (currentHeight !== undefined) {
          currentHeight = undefined
          setPromptMinHeight(undefined)
        }
        return
      }

      const wrapper = (textarea.closest('.ant-input-textarea-show-count') || textarea) as HTMLElement
      const previewHeight = preview.getBoundingClientRect().height
      const settingsHeight = settings.getBoundingClientRect().height
      const textareaHeight = wrapper.getBoundingClientRect().height

      if (baseNaturalHeight === 0 && textareaHeight > 0) {
        baseNaturalHeight = textareaHeight
      }

      const naturalHeight = Math.max(
        baseNaturalHeight || 0,
        textarea.scrollHeight || 0,
      )

      const target = calculatePromptTargetHeight({
        previewHeight,
        settingsHeight,
        textareaHeight,
        naturalHeight,
      })

      if (target !== currentHeight) {
        currentHeight = target
        setPromptMinHeight(target)
      }
    }

    const rafId = requestAnimationFrame(update)

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    observer?.observe(preview)
    observer?.observe(settings)

    const onMediaChange = () => update()
    if (desktopQuery?.addEventListener) {
      desktopQuery.addEventListener('change', onMediaChange)
    } else if (desktopQuery?.addListener) {
      desktopQuery.addListener(onMediaChange)
    }

    return () => {
      cancelAnimationFrame(rafId)
      observer?.disconnect()
      if (desktopQuery?.removeEventListener) {
        desktopQuery.removeEventListener('change', onMediaChange)
      } else if (desktopQuery?.removeListener) {
        desktopQuery.removeListener(onMediaChange)
      }
      setPromptMinHeight(undefined)
    }
  }, [enabled, previewPanelRef, settingsPanelRef, activeToolSlug])

  return enabled ? promptMinHeight : undefined
}
