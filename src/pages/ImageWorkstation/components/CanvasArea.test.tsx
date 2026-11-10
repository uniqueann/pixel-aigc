// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,describe,expect,it,vi} from 'vitest'
import CanvasArea from './CanvasArea'
vi.mock('@/hooks/useCapabilities',()=>({useCapabilities:()=>({capabilities:{}})}))
// 扩图画布依赖 Fabric，jsdom 下用占位组件，只验证控制行与对比状态。
vi.mock('./canvas/OutpaintCanvas',async()=>{
  const React=await import('react')
  return {default:React.forwardRef(()=>React.createElement('div',{'data-testid':'outpaint-canvas'}))}
})
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
  it('保留原图输入时，效果视图显示选中的结果',()=>{
    const view=render(
      <CanvasArea
        {...props}
        interactionMode="params-only"
        imageUrl="blob:original"
        originalImageUrl="blob:original"
        resultImageUrl="blob:result"
        compareAvailable
        compareMode="effect"
      />,
    )
    expect(screen.getByAltText('当前编辑效果').getAttribute('src')).toBe('blob:result')
    view.rerender(
      <CanvasArea
        {...props}
        interactionMode="params-only"
        imageUrl="blob:original"
        originalImageUrl="blob:original"
        resultImageUrl="blob:result"
        compareAvailable
        compareMode="original"
      />,
    )
    expect(screen.getByAltText('原始图片').getAttribute('src')).toBe('blob:original')
  })
  it('上传空状态显示加载反馈而不是继续提示上传',()=>{
    render(<CanvasArea {...props} interactionMode="params-only" uploading/>)
    expect(screen.getByText('正在载入图片…')).toBeTruthy()
    expect(document.querySelector('.is-empty[aria-busy="true"] .ant-spin')).toBeTruthy()
    expect(screen.queryByText('上传需要处理的商品图片')).toBeNull()
  })
  it('脚注传 null 时完全隐藏',()=>{
    render(<CanvasArea {...props} imageUrl="blob:current" footnote={null}/>)
    expect(document.querySelector('.workstation-canvas-footnote')).toBeNull()
  })
})

describe('融合输入与效果切换',()=>{
  const props={interactionMode:'multi-source' as const,imageUrl:'blob:product',referenceImageUrl:'blob:reference',imageNaturalSize:{width:0,height:0},compareMode:'effect' as const,onCompareModeChange:vi.fn(),onImageUpload:vi.fn(),onReady:vi.fn()}
  it('有结果时主舞台显示效果，切到输入后恢复两个槽位',()=>{
    const onCompareModeChange=vi.fn()
    const view=render(<CanvasArea {...props} resultImageUrl="blob:result" compareAvailable onCompareModeChange={onCompareModeChange}/>)
    expect(screen.getByAltText('融合结果').getAttribute('src')).toBe('blob:result')
    expect(screen.queryByAltText('商品')).toBeNull()
    fireEvent.click(screen.getByText('输入'))
    expect(onCompareModeChange).toHaveBeenCalledWith('original')
    view.rerender(<CanvasArea {...props} resultImageUrl="blob:result" compareAvailable compareMode="original" onCompareModeChange={onCompareModeChange}/>)
    expect(screen.getByAltText('商品').getAttribute('src')).toBe('blob:product')
    expect(screen.getByAltText('场景图').getAttribute('src')).toBe('blob:reference')
    expect(screen.queryByAltText('融合结果')).toBeNull()
  })
  it('没有结果时只显示输入槽位，不出现效果切换',()=>{
    render(<CanvasArea {...props} compareAvailable={false}/>)
    expect(screen.getByAltText('商品')).toBeTruthy()
    expect(screen.getByAltText('场景图')).toBeTruthy()
    expect(screen.queryByText('效果')).toBeNull()
  })
  it('融合结果可以点击或键盘打开大图',()=>{
    const onPreview=vi.fn()
    render(<CanvasArea {...props} resultImageUrl="blob:result" compareAvailable onPreview={onPreview}/>)
    const image=screen.getByRole('button',{name:'打开融合结果大图'})
    fireEvent.click(image)
    fireEvent.keyDown(image,{key:'Enter'})
    expect(onPreview).toHaveBeenCalledTimes(2)
    expect(onPreview).toHaveBeenCalledWith('effect')
  })
  it('空槽位载入时给出加载反馈',()=>{
    render(<CanvasArea {...props} imageUrl={undefined} referenceImageUrl={undefined} compareAvailable={false} fusionUploading={{product:true,reference:false}}/>)
    expect(screen.getByText('正在载入商品…')).toBeTruthy()
    expect(document.querySelector('.workstation-fusion-slot[aria-busy="true"] .ant-spin')).toBeTruthy()
    expect(screen.queryByText('上传商品')).toBeNull()
  })
  it('点击商品或场景图槽位可打开对应大图',()=>{
    const onPreviewImage=vi.fn()
    render(<CanvasArea {...props} compareAvailable={false} onPreviewImage={onPreviewImage}/>)
    fireEvent.click(screen.getByRole('button',{name:'查看商品大图'}))
    expect(onPreviewImage).toHaveBeenCalledWith('product')
    fireEvent.click(screen.getByRole('button',{name:'查看场景图大图'}))
    expect(onPreviewImage).toHaveBeenCalledWith('reference')
  })
  it('单张载入失败时只在对应槽位内联提示',()=>{
    render(<CanvasArea {...props} compareAvailable={false} fusionErrors={{reference:'仅支持 PNG、JPEG 和 WebP 图片'}}/>)
    const alert=screen.getByRole('alert')
    expect(alert.textContent).toBe('仅支持 PNG、JPEG 和 WebP 图片')
    expect(alert.closest('.workstation-fusion-slot')?.textContent).toContain('场景图')
    expect(alert.closest('.workstation-fusion-slot')?.textContent).not.toContain('商品')
  })
  it('替换已有图片失败时仍在该槽位显示提示',()=>{
    render(<CanvasArea {...props} compareAvailable={false} fusionErrors={{product:'图片大小不能超过 20 MB'}}/>)
    expect(screen.getByAltText('商品')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('图片大小不能超过 20 MB')
  })
  it('两个替换按钮按角色命名',()=>{
    render(<CanvasArea {...props} compareAvailable={false}/>)
    expect(screen.getByRole('button',{name:'替换商品'})).toBeTruthy()
    expect(screen.getByRole('button',{name:'替换场景图'})).toBeTruthy()
  })
  it('交换与移除按角色触发',()=>{
    const onSwapImages=vi.fn()
    const onRemoveImage=vi.fn()
    render(<CanvasArea {...props} compareAvailable={false} onSwapImages={onSwapImages} onRemoveImage={onRemoveImage}/>)
    fireEvent.click(screen.getByRole('button',{name:'交换商品图与场景图'}))
    expect(onSwapImages).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button',{name:'移除商品'}))
    expect(onRemoveImage).toHaveBeenCalledWith('product')
    fireEvent.click(screen.getByRole('button',{name:'移除场景图'}))
    expect(onRemoveImage).toHaveBeenCalledWith('reference')
  })
  it('空场景槽位显示上次场景入口，点击后复用',()=>{
    const onReuseLastScene=vi.fn()
    render(<CanvasArea {...props} referenceImageUrl={undefined} compareAvailable={false} lastScene={{name:'客厅.png',width:1200,height:800}} onReuseLastScene={onReuseLastScene}/>)
    const button=screen.getByRole('button',{name:'使用上次场景 1200×800'})
    expect(button.getAttribute('title')).toBe('使用上次场景：客厅.png')
    fireEvent.click(button)
    expect(onReuseLastScene).toHaveBeenCalledOnce()
  })
  it('场景槽位已有图片时不显示上次场景入口',()=>{
    render(<CanvasArea {...props} compareAvailable={false} lastScene={{name:'客厅.png',width:1200,height:800}} onReuseLastScene={vi.fn()}/>)
    expect(screen.queryByRole('button',{name:/使用上次场景/})).toBeNull()
  })
  it('只有一张图时不显示交换',()=>{
    render(<CanvasArea {...props} referenceImageUrl={undefined} compareAvailable={false} onSwapImages={vi.fn()} onRemoveImage={vi.fn()}/>)
    expect(screen.queryByRole('button',{name:'交换商品图与场景图'})).toBeNull()
  })
})

describe('扩图结果态的原图对比',()=>{
  const props={
    interactionMode:'drag-resize' as const,
    imageUrl:'blob:result',
    originalImageUrl:'blob:original',
    imageNaturalSize:{width:480,height:480},
    compareMode:'effect' as const,
    onCompareModeChange:vi.fn(),
    onImageUpload:vi.fn(),
    onReady:vi.fn(),
  }
  it('生成结果后提示可继续扩图，并提供原图/结果切换',()=>{
    render(<CanvasArea {...props} compareAvailable outpaintIdle/>)
    expect(screen.getByText('已生成结果 · 拖拽边框或输入更大尺寸继续扩图')).toBeTruthy()
    expect(screen.getByRole('radio',{name:'原图'})).toBeTruthy()
    expect(screen.getByRole('radio',{name:'结果'})).toBeTruthy()
  })
  it('尚未扩图时不显示对比切换',()=>{
    render(<CanvasArea {...props} compareAvailable={false} outpaintIdle/>)
    expect(screen.getByText('尚未扩图 · 拖拽边框或输入更大的目标尺寸')).toBeTruthy()
    expect(screen.queryByText('原图')).toBeNull()
  })
  it('切到原图时显示对比说明，隐藏重置，并能切回结果',()=>{
    const onCompareModeChange=vi.fn()
    render(
      <CanvasArea
        {...props}
        compareAvailable
        compareMode="original"
        onCompareModeChange={onCompareModeChange}
      />,
    )
    expect(screen.getByText('正在查看扩图前原图')).toBeTruthy()
    expect(screen.queryByRole('button',{name:'重置'})).toBeNull()
    expect(screen.getByText('正在查看扩图前原图；切回「结果」可继续扩图。')).toBeTruthy()
    fireEvent.click(screen.getByText('结果'))
    expect(onCompareModeChange).toHaveBeenCalledWith('effect')
  })
  it('目标到单边 2 倍时在提示旁标出上限',()=>{
    render(
      <CanvasArea
        {...props}
        compareAvailable={false}
        outpaintTargetSize={{width:960,height:960}}
      />,
    )
    expect(screen.getByText('已达单边 2 倍上限')).toBeTruthy()
  })
})
