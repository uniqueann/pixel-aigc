import { createContext } from 'react'
export interface DraftGuard { dirty: boolean; reason: string; blocked?: string; beforeLeave?: () => Promise<boolean|'saved'>; navigationScope?: 'page'|'canvas-task'; onAbandon?: () => void|Promise<void> }
export interface DraftNavigationContextValue { guards: Map<object, () => DraftGuard>; confirmReplace: (reason: string) => Promise<boolean> }
export const DraftNavigationContext=createContext<DraftNavigationContextValue|null>(null)
