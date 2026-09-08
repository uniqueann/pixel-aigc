import { RouterProvider } from 'react-router-dom'
import AuthGate from '@/cloud/AuthGate'
import CloudRuntime from '@/cloud/CloudRuntime'
import PersistenceGate from '@/editor/persistence/PersistenceGate'
import { router } from '@/router'

export default function App() {
  return <AuthGate><PersistenceGate><CloudRuntime /><RouterProvider router={router} /></PersistenceGate></AuthGate>
}
