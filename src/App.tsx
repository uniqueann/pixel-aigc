import { RouterProvider } from 'react-router-dom'
import PersistenceGate from '@/editor/persistence/PersistenceGate'
import { router } from '@/router'

export default function App() {
  return <PersistenceGate><RouterProvider router={router} /></PersistenceGate>
}
