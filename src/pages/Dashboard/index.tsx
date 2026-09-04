import { Card, Col, Row } from 'antd'
import { useNavigate } from 'react-router-dom'

const ENTRIES = [
  { key: '/email', title: '邮件助手', desc: '总结、回复、润色、检查语法' },
  { key: '/image-workstation', title: '图片工作站', desc: '智能编辑、打光、消除、重绘等 8 项能力' },
  { key: '/toolbox', title: '工具箱', desc: '抠图、加水印、转比例，支持批量' },
  { key: '/canvas', title: '自由画布', desc: '文生图、文生视频' },
]

export default function Dashboard() {
  const navigate = useNavigate()
  return (
    <div>
      <h2 style={{ margin: '0 0 16px' }}>工作台首页</h2>
      <Row gutter={16}>
        {ENTRIES.map((item) => (
          <Col span={6} key={item.key}>
            <Card hoverable onClick={() => navigate(item.key)}>
              <div style={{ fontWeight: 500, marginBottom: 6 }}>{item.title}</div>
              <div style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>{item.desc}</div>
            </Card>
          </Col>
        ))}
      </Row>
      {/* TODO: 最近任务 / 草稿列表，接入 listTasks() */}
    </div>
  )
}
