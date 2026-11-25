import { useTranslation } from 'react-i18next'
import type { CountTool } from '@shared/preferences'
import { usePreferencesStore } from './store'
import { countUsesLastUsed } from './toolParameters'

/** 张数来自上次使用、而不是设置里的默认值时，提示并允许恢复默认。 */
export default function CountMemoryHint({ tool, disabled = false }: { tool: CountTool; disabled?: boolean }) {
  const { t } = useTranslation('settings')
  const usesMemory = usePreferencesStore(state => countUsesLastUsed(state.preferences, tool))
  if (!usesMemory) return null
  return (
    <span className="count-memory-hint">
      {t('personalization.countMemory.lastUsed')}
      <button
        type="button"
        aria-label={t('personalization.countMemory.restoreAria')}
        disabled={disabled}
        onClick={() => usePreferencesStore.getState().update({ image: { forgetCounts: [tool] } })}
      >
        {t('personalization.countMemory.restore')}
      </button>
    </span>
  )
}
