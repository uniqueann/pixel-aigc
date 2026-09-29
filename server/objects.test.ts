import { describe, expect, it, vi } from 'vitest'
import { HttpError } from './errors.js'

const getObject = vi.fn()
const requireActive = vi.fn()

vi.mock('./storage', () => ({ getObject: (...args: unknown[]) => getObject(...args) }))
vi.mock('./model-settings', () => ({ requireActive: (...args: unknown[]) => requireActive(...args) }))
vi.mock('./db', () => ({
  withIdentity: async (_id: string, _email: string, fn: (sql: unknown) => Promise<unknown>) => fn({}),
}))

import { loadOwnedObject, objectContentDisposition } from './objects.js'

const user = { id: 'user-1', email: 'user@example.com' } as Awaited<ReturnType<typeof import('./auth.js').authenticate>>

describe('同域读取私有对象', () => {
  it('只允许当前用户自己的 generated/media/task-inputs 对象', async () => {
    await expect(loadOwnedObject(user, 'generated/other/job/0.png')).rejects.toBeInstanceOf(HttpError)
    await expect(loadOwnedObject(user, '../generated/user-1/job/0.png')).rejects.toBeInstanceOf(HttpError)
    expect(getObject).not.toHaveBeenCalled()
  })

  it('校验成员后读出对象字节', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    getObject.mockResolvedValue({ bytes, contentType: 'image/png' })
    await expect(loadOwnedObject(user, 'generated/user-1/job/0.png')).resolves.toEqual({
      bytes,
      contentType: 'image/png',
    })
    expect(requireActive).toHaveBeenCalled()
  })

  it('下载文件名带 UTF-8 编码，避免中文被丢掉', () => {
    expect(objectContentDisposition('裂变_2048x2048.png')).toContain("filename*=UTF-8''")
    expect(objectContentDisposition('裂变_2048x2048.png')).toContain(encodeURIComponent('裂变_2048x2048.png'))
  })
})
