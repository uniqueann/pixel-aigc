import type { CountTool } from '@shared/preferences'
import { usePreferencesStore } from './store'
import { countUsesLastUsed } from './toolParameters'

/** 张数来自上次使用、而不是设置里的默认值时，提示并允许恢复默认。 */
export default function CountMemoryHint({ tool, disabled = false }: { tool: CountTool; disabled?: boolean }) {
  const usesMemory = usePreferencesStore(state => countUsesLastUsed(state.preferences, tool))
  if (!usesMemory) return null
  return (
    <span className="count-memory-hint">
      上次使用
      <button
        type="button"
        aria-label="恢复默认生成数量"
        disabled={disabled}
        onClick={() => usePreferencesStore.getState().update({ image: { forgetCounts: [tool] } })}
      >
        恢复默认
      </button>
    </span>
  )
}
