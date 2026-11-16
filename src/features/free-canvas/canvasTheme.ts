import { useEffect, useState } from 'react'

export interface CanvasPalette {
  /** 画布（工作区）底色 */
  background: string
  /** 画板纸面与描边：画板始终是"成片预览"，不跟随主题反转 */
  artboard: string
  artboardStroke: string
  artboardShadow: string
  /** 选中框、控制点、框选、处理中占位框的强调色 */
  accent: string
}

const FALLBACK: CanvasPalette = {
  background: '#3a3a3e',
  artboard: '#f7f7f5',
  artboardStroke: '#d6d6d2',
  artboardShadow: 'rgba(0, 0, 0, 0.28)',
  accent: '#21cfa0',
}

type TokenReader = (name: string) => string

function readComputedToken(name: string) {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name)
}

/**
 * fabric 画不出 CSS 变量，只能把令牌的值取出来交给 canvas。
 * 每次调用都读当前主题，主题切换后由调用方负责重绘。
 */
export function readCanvasPalette(readToken: TokenReader = readComputedToken): CanvasPalette {
  const read = (name: string, fallback: string) => readToken(name).trim() || fallback
  return {
    background: read('--color-canvas', FALLBACK.background),
    artboard: read('--color-artboard', FALLBACK.artboard),
    artboardStroke: read('--color-artboard-stroke', FALLBACK.artboardStroke),
    artboardShadow: read('--color-artboard-shadow', FALLBACK.artboardShadow),
    // 选中框同时压在纸面和画布上，用专门的画布强调色（两套主题各自保证 ≥3:1）。
    accent: read('--color-canvas-accent', '')
      || read('--color-accent-text', '')
      || read('--color-accent', FALLBACK.accent),
  }
}

function samePalette(a: CanvasPalette, b: CanvasPalette) {
  return a.background === b.background
    && a.artboard === b.artboard
    && a.artboardStroke === b.artboardStroke
    && a.artboardShadow === b.artboardShadow
    && a.accent === b.accent
}

/** 订阅主题变化（`<html data-theme>`）并返回当前画布配色。 */
export function useCanvasPalette() {
  const [palette, setPalette] = useState<CanvasPalette>(readCanvasPalette)
  useEffect(() => {
    const update = () => setPalette((previous) => {
      const next = readCanvasPalette()
      return samePalette(previous, next) ? previous : next
    })
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
    // 系统主题跟随（data-theme 由应用改写，这里兜底处理外部样式表变化）。
    const scheme = window.matchMedia?.('(prefers-color-scheme: dark)')
    scheme?.addEventListener?.('change', update)
    return () => {
      observer.disconnect()
      scheme?.removeEventListener?.('change', update)
    }
  }, [])
  return palette
}
