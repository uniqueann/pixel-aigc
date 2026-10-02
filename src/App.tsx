import { RouterProvider } from 'react-router-dom'
import AuthGate from '@/cloud/AuthGate'
import CloudRuntime from '@/cloud/CloudRuntime'
import PersistenceGate from '@/editor/persistence/PersistenceGate'
import { router } from '@/router'
import AuthPages from '@/cloud/AuthPages'
import PreferencesGate from '@/features/preferences/PreferencesGate'

export default function App() {
  if (['/login','/register','/verify-email','/forgot-password','/auth/callback','/reset-password','/account-disabled'].includes(window.location.pathname)) return <AuthPages />
  if (new URLSearchParams(window.location.search).has('code')) {
    window.location.replace('/auth/callback' + window.location.search)
    return null
  }
  return <AuthGate><PreferencesGate><PersistenceGate><CloudRuntime /><RouterProvider router={router} /></PersistenceGate></PreferencesGate></AuthGate>
}
