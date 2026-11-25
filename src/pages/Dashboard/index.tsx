import { useTranslation } from 'react-i18next'
import { useUserStore } from '@/store/useUserStore'
import { currentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import ContinueWork from '@/features/dashboard/ContinueWork'
import QuickStart from '@/features/dashboard/QuickStart'
import RecentWorks from '@/features/dashboard/RecentWorks'
import { useRecentWork } from '@/features/dashboard/useRecentWork'
import '@/features/dashboard/dashboard.css'

function DashboardForOwner({ ownerId }: { ownerId: string }) {
  const work = useRecentWork(ownerId)
  return <div className="dashboard-page">
    <ContinueWork ownerId={ownerId} work={work} />
    <QuickStart />
    <RecentWorks ownerId={ownerId} />
  </div>
}

export default function Dashboard() {
  const { t } = useTranslation('common')
  useUserStore(state => state.userId)
  let ownerId: string
  try { ownerId = currentWorkstationHistoryOwner() }
  catch { return <p role="status">{t('status.preparingAccount')}</p> }
  return <DashboardForOwner key={ownerId} ownerId={ownerId} />
}
