import { create } from 'zustand'

/** 自由画布生成或导入进行中时，禁止导入 JSON 与新建项目。 */
export const useCanvasActionGate = create<{ blocked: boolean }>(() => ({ blocked: false }))
