import { BgColorsOutlined, MailOutlined, PictureOutlined, RightOutlined, ToolOutlined } from '@ant-design/icons'
import { Card, Col, Row } from 'antd'
import { Link } from 'react-router-dom'

const ENTRIES = [
  { key: '/email', title: '邮件助手', desc: '总结、回复、润色、检查语法', icon: <MailOutlined /> },
  { key: '/image-workstation', title: '图片工作站', desc: '智能编辑、打光、消除、重绘等 8 项能力', icon: <PictureOutlined /> },
  { key: '/toolbox', title: '工具箱', desc: '抠图、加水印、转比例，支持批量', icon: <ToolOutlined /> },
  { key: '/canvas', title: '自由画布', desc: '文生图、文生视频', icon: <BgColorsOutlined /> },
]

export default function Dashboard() {
  return (
    <div className="dashboard-page">
      <Row gutter={[16, 16]}>
        {ENTRIES.map((item) => (
          <Col xs={24} sm={12} xl={6} key={item.key}>
            <Link className="dashboard-entry" to={item.key} aria-label={`打开${item.title}`}>
              <Card className="dashboard-card" hoverable>
                <span className="dashboard-entry-icon" aria-hidden="true">{item.icon}</span>
                <div className="dashboard-entry-info">
                  <h3>{item.title}</h3>
                  <p>{item.desc}</p>
                </div>
                <RightOutlined className="dashboard-entry-arrow" aria-hidden="true" />
              </Card>
            </Link>
          </Col>
        ))}
      </Row>
    </div>
  )
}
