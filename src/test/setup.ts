// jsdom 计算 getComputedStyle 时会扫描文档里的全部样式。Ant Design 会注入上千条规则，
// Testing Library 的角色查询又会对每个节点调用它（含 ::before / ::after）。
// 单次查询就能超过 Vitest 默认的 5 秒，GitHub Actions 的双核机器上会间歇失败。
// 查询实际只依赖可见性：hidden 属性、行内 display / visibility，以及组件收起浮层用的 *-hidden 类。
// 直接替换，不用 vi.spyOn，避免用例里的 restoreAllMocks 把慢实现装回去。

const KEEP_VISIBLE = ['required-mark-hidden', 'splitter', 'spin-dot']

function hidesElement(element: Element): boolean {
  const className = element.getAttribute('class')
  if (!className) return false
  for (const token of className.split(/\s+/)) {
    if (!token.endsWith('-hidden')) continue
    if (KEEP_VISIBLE.some(part => token.includes(part))) continue
    return true
  }
  return false
}

function displayOf(element: Element): string {
  if (element.hasAttribute('hidden') || hidesElement(element)) return 'none'
  if (element instanceof HTMLElement) {
    const inline = element.style.getPropertyValue('display')
    if (inline) return inline
  }
  return 'inline'
}

function visibilityOf(element: Element): string {
  let current: Element | null = element
  while (current) {
    if (current instanceof HTMLElement) {
      const inline = current.style.getPropertyValue('visibility')
      if (inline) return inline
    }
    current = current.parentElement
  }
  return 'visible'
}

function styleDeclaration(display: string, visibility: string): CSSStyleDeclaration {
  const read = (name: string) => {
    const normalized = name.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)
    if (normalized === 'display') return display
    if (normalized === 'visibility') return visibility
    // 文本域自适应会 parseFloat 内边距和边框。空字符串会得到 NaN，再写进 height。
    if (normalized.startsWith('padding') || normalized.startsWith('margin') || normalized.endsWith('-width') || normalized === 'width' || normalized === 'height') return '0'
    return ''
  }
  return new Proxy({} as CSSStyleDeclaration, {
    get(_target, property) {
      if (property === 'getPropertyValue') return read
      if (property === 'getPropertyPriority' || property === 'item') return () => ''
      if (property === 'then' || typeof property === 'symbol') return undefined
      if (property === 'length') return 0
      if (typeof property === 'string') return read(property)
      return undefined
    },
  })
}

if (typeof window !== 'undefined') {
  window.getComputedStyle = (element: Element, pseudoElement?: string | null) => {
    if (!(element instanceof Element)) {
      throw new TypeError("Failed to execute 'getComputedStyle' on 'Window': parameter 1 is not of type 'Element'.")
    }
    if (pseudoElement) return styleDeclaration('inline', 'visible')
    return styleDeclaration(displayOf(element), visibilityOf(element))
  }
}
