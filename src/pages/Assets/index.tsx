import EmptyState from '@/components/EmptyState'

export default function Assets() {
  return (
    <div>
      <h2 style={{ margin: '0 0 16px' }}>我的资产</h2>
      {/* TODO: 接入 listTasks()，按状态/能力类型筛选，展示消耗积分记录；有数据时替换掉下面的空状态 */}
      <EmptyState description="暂无历史任务，去邮件助手或图片工作站生成点内容吧" />
    </div>
  )
}
