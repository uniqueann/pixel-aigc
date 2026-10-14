import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider, App as AntdApp, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import RootApp from './App'
import { clearChunkReloadMark } from '@/utils/chunkLoadError'
import { useThemeStore } from '@/store/useThemeStore'
import './styles/global.css'

window.setTimeout(() => clearChunkReloadMark(), 8000)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

export function ThemedApp() {
  const resolvedTheme = useThemeStore(state => state.resolvedTheme)
  const isDark = resolvedTheme === 'dark'

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: isDark
          ? {
              colorPrimary: '#21cfa0',
              colorBgLayout: '#17171a',
              colorBgContainer: '#1f1f23',
              colorBgElevated: '#1f1f23',
              colorBorder: '#38383e',
              colorBorderSecondary: '#2c2c31',
              colorText: '#ededec',
              colorTextSecondary: '#9c9a9f',
              colorTextTertiary: '#6c6a70',
              borderRadius: 8,
              fontFamily:
                "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', Roboto, sans-serif",
            }
          : {
              colorPrimary: '#12a67f',
              colorBgLayout: '#f5f6f8',
              colorBgContainer: '#ffffff',
              colorBgElevated: '#ffffff',
              colorBorder: '#e2e8f0',
              colorBorderSecondary: '#edeef1',
              colorText: '#111827',
              colorTextSecondary: '#64748b',
              colorTextTertiary: '#94a3b8',
              borderRadius: 8,
              fontFamily:
                "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', Roboto, sans-serif",
            },
      }}
    >
      {/* antd v5 的 App 组件提供 message/notification 的主题上下文，
          没有它的话全局提示不会跟着 ConfigProvider 的主题走 */}
      <AntdApp>
        <RootApp />
      </AntdApp>
    </ConfigProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemedApp />
    </QueryClientProvider>
  </React.StrictMode>,
)
