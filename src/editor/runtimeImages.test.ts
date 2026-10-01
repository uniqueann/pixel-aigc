// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { useEditorStore } from './store'
import { createImageAsset } from './services/assetService'
import { bindRuntimeImage, releaseRuntimeImageUser, setRuntimeImageUsers, withRuntimeImage } from './runtimeImages'
describe('工作站运行时图片引用', () => {
  it('刚读取完成的结果等待视图认领，不被中间渲染释放；卸载后释放', () => {
    URL.createObjectURL = vi.fn(() => 'blob:new-result')
    URL.revokeObjectURL = vi.fn()
    useEditorStore.getState().createProject('测试')
    const asset = createImageAsset({ id: 'new', url: 'https://r2.test/new.jpg', name: '结果', width: 100, height: 100 })
    useEditorStore.getState().registerAsset(asset)
    const user = {}
    setRuntimeImageUsers(user, [])
    bindRuntimeImage('anonymous', asset, new Blob(['图片']), user)
    setRuntimeImageUsers(user, [])
    expect(withRuntimeImage(asset).url).toBe('blob:new-result')
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    setRuntimeImageUsers(user, [asset.id])
    releaseRuntimeImageUser(user)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:new-result')
  })
})
