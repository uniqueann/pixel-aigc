export const TOOL_SWITCHER_COMING_SOON = '即将上线'

/** 工具箱与图片工作站共用：未就绪项写成「名称 · 即将上线」。 */
export function formatToolSwitcherLabel(label: string, ready = true) {
  return ready ? label : `${label} · ${TOOL_SWITCHER_COMING_SOON}`
}
