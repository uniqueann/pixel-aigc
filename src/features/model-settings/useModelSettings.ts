import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { authEnabled } from '@/cloud/client'
import { getModelProfiles, getModelSettings, type ModelSettings } from '@/services/api/modelSettings'
import { useUserStore } from '@/store/useUserStore'

export function useModelSettings() {
  const userId = useUserStore(state => state.userId)
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({
    queryKey: ['model-settings', userId],
    queryFn: getModelSettings,
    enabled: authEnabled && Boolean(userId),
    staleTime: 60000,
  })
  const profilesQuery = useQuery({
    queryKey: ['model-profiles', 'email_assist', userId],
    queryFn: getModelProfiles,
    enabled: authEnabled && Boolean(userId),
    staleTime: 300000,
  })

  useEffect(() => {
    if (!authEnabled || !userId) return
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['model-settings', userId], exact: true }, { cancelRefetch: false })
      void queryClient.invalidateQueries({ queryKey: ['model-profiles', 'email_assist', userId], exact: true })
    }
    window.addEventListener('pixel:model-settings-changed', refresh)
    return () => window.removeEventListener('pixel:model-settings-changed', refresh)
  }, [queryClient, userId])

  const updateSettings = useCallback(async (settings: ModelSettings) => {
    const queryKey = ['model-settings', userId]
    // 防止保存前发起的旧请求覆盖刚保存的配置。
    await queryClient.cancelQueries({ queryKey, exact: true })
    queryClient.setQueryData(queryKey, settings)
  }, [queryClient, userId])

  return { settingsQuery, profilesQuery, updateSettings }
}
