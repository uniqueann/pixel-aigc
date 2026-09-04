import { WORKSTATION_TOOLS } from '@/pages/ImageWorkstation/tools'
import { TOOLBOX_TOOLS } from '@/pages/Toolbox/tools'
import { CANVAS_MODES } from '@/pages/FreeCanvas/modes'

/** 顶层导航路径 -> 中文标题，供菜单选中态、面包屑、页面标题共用 */
export const NAV_META: Record<string, string> = {
  '/': '工作台首页',
  '/email': '邮件助手',
  '/image-workstation': '图片工作站',
  '/toolbox': '工具箱',
  '/canvas': '自由画布',
  '/assets': '我的资产',
}

/** 二级路由（子工具/子模式）slug -> 中文标签，聚合自各页面自己的配置，新增子工具时改那边即可，这里不用动 */
export const SUB_ROUTE_LABELS: Record<string, Record<string, string>> = {
  'image-workstation': Object.fromEntries(WORKSTATION_TOOLS.map((t) => [t.slug, t.label])),
  toolbox: Object.fromEntries(TOOLBOX_TOOLS.map((t) => [t.slug, t.label])),
  canvas: Object.fromEntries(CANVAS_MODES.map((m) => [m.slug, m.label])),
}
