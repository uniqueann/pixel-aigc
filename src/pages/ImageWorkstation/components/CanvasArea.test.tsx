// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
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
  it('预览图可以用键盘打开大图',()=>{
    const onPreview=vi.fn()
    render(<CanvasArea {...props} imageUrl="blob:current" onPreview={onPreview}/>)
    const image=screen.getByRole('button',{name:'打开效果大图'})
    expect(image.getAttribute('src')).toBe('blob:current')
    fireEvent.keyDown(image,{key:'Enter'})
    expect(onPreview).toHaveBeenCalledWith('effect')
    fireEvent.keyDown(image,{key:' '})
    expect(onPreview).toHaveBeenCalledTimes(2)
  })
  it('已有图片时用画布浮层展示生成中与结果不可读状态',()=>{
    const view=render(<CanvasArea {...props} imageUrl="blob:current" processingLabel="正在生成，结果会显示在下方"/>)
    expect(screen.getByRole('status').textContent).toContain('正在生成')
    view.rerender(<CanvasArea {...props} imageUrl="blob:current" errorLabel="结果暂时无法读取，可重试"/>)
    expect(screen.getByRole('alert').textContent).toContain('结果暂时无法读取')
    expect(screen.queryByText('正在生成，结果会显示在下方')).toBeNull()
  })
  it('没有结果时隐藏原图/效果切换，脚注说明下一步',()=>{
    render(<CanvasArea {...props} interactionMode="params-only" imageUrl="blob:current" compareAvailable={false}/>)
    expect(screen.queryByText('原图')).toBeNull()
    expect(screen.queryByText('效果')).toBeNull()
    expect(screen.getByAltText('原始图片').getAttribute('src')).toBe('blob:current')
    expect(screen.getByText('调整右侧参数后生成，结果会显示在这里')).toBeTruthy()
  })
  it('脚注传 null 时完全隐藏',()=>{
    render(<CanvasArea {...props} imageUrl="blob:current" footnote={null}/>)
    expect(document.querySelector('.workstation-canvas-footnote')).toBeNull()
  })
})
