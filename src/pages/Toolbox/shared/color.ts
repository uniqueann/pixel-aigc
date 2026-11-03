/** 接受 #RGB / #RRGGBB（可省略 #），统一返回大写 #RRGGBB；非法输入返回 null。 */
export function normalizeHex(value: string): string | null {
  const trimmed = value.trim()
  if (!/^#?[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(trimmed)) return null
  const hex = trimmed.replace('#', '')
  const full = hex.length === 3 ? hex.split('').map(char => char + char).join('') : hex
  return `#${full.toUpperCase()}`
}

/** 原生 color input 只接受 #RRGGBB；遇到非法值回退到白色。 */
export function hexForColorInput(value: string) {
  return normalizeHex(value) ?? '#FFFFFF'
}
