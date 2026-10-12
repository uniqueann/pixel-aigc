// @vitest-environment jsdom
import {cleanup,render,screen} from '@testing-library/react'
import {afterEach,describe,expect,it,vi} from 'vitest'
import CanvasArea from './CanvasArea'
vi.mock('@/hooks/useCapabilities',()=>({useCapabilities:()=>({capabilities:{}})}))
afterEach(cleanup)
describe('工作站恢复任务的预览占位',()=>{
  const props={interactionMode:'light-control' as const,imageNaturalSize:{width:0,height:0},compareMode:'effect' as const,onCompareModeChange:vi.fn(),onImageUpload:vi.fn(),onReady:vi.fn()}
  it('有正在恢复的原任务时，用状态占位取代空白上传提示',()=>{
    render(<CanvasArea {...props} activityLabel="正在恢复进行中的任务"/>)
    expect(screen.getByRole('status').textContent).toContain('正在恢复进行中的任务')
    expect(screen.queryByText('上传需要处理的商品图片')).toBeNull()
  })
  it('已有输入图时保留当前预览，不让恢复占位覆盖编辑内容',()=>{
    render(<CanvasArea {...props} imageUrl="blob:current" activityLabel="正在恢复进行中的任务"/>)
    expect(screen.getByAltText('当前编辑效果').getAttribute('src')).toBe('blob:current')
    expect(screen.queryByText('正在恢复进行中的任务')).toBeNull()
  })
})
