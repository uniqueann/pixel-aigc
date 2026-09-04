import { createBrowserRouter, Navigate } from 'react-router-dom'
import MainLayout from '@/layouts/MainLayout'
import Dashboard from '@/pages/Dashboard'
import EmailAssistant from '@/pages/EmailAssistant'
import ImageWorkstation from '@/pages/ImageWorkstation'
import Toolbox from '@/pages/Toolbox'
import FreeCanvas from '@/pages/FreeCanvas'
import Assets from '@/pages/Assets'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <MainLayout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'email', element: <EmailAssistant /> },
      {
        path: 'image-workstation',
        children: [
          { index: true, element: <Navigate to="smart-edit" replace /> },
          { path: ':tool', element: <ImageWorkstation /> },
        ],
      },
      {
        path: 'toolbox',
        children: [
          { index: true, element: <Navigate to="bg-remove" replace /> },
          { path: ':tool', element: <Toolbox /> },
        ],
      },
      {
        path: 'canvas',
        children: [
          { index: true, element: <Navigate to="text-to-image" replace /> },
          { path: ':mode', element: <FreeCanvas /> },
        ],
      },
      { path: 'assets', element: <Assets /> },
    ],
  },
])
