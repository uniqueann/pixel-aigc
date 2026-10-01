import { describe, expect, it, vi } from 'vitest'
import { HttpError } from './errors.js'

const getObject = vi.fn()
const signRead = vi.fn()
const requireActive = vi.fn()

vi.mock('./storage', () => ({ getObject: (...args: unknown[]) => getObject(...args), signRead: (...args: unknown[]) => signRead(...args) }))
vi.mock('./model-settings', () => ({ requireActive: (...args: unknown[]) => requireActive(...args) }))
vi.mock('./db', () => ({
  withIdentity: async (_id: string, _email: string, fn: (sql: unknown) => Promise<unknown>) => fn({}),
}))

import { loadOwnedObject, objectContentDisposition, signOwnedObjectRead } from './objects.js'

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

  it('仅为本人对象签发短期读取地址', async () => {
    signRead.mockResolvedValue({ url: 'https://r2.test/result', expiresAt: 123 })
    await expect(signOwnedObjectRead(user, 'temporary/erase-results/user-1/1.jpg')).resolves.toEqual({
      url: 'https://r2.test/result', expiresAt: 123,
    })
    expect(signRead).toHaveBeenCalledWith('temporary/erase-results/user-1/1.jpg', 900)
    await expect(signOwnedObjectRead(user, 'temporary/erase-results/other/1.jpg')).rejects.toBeInstanceOf(HttpError)
    for (const route of ['repaint', 'outpaint']) {
      const key = `temporary/${route}-results/user-1/1.jpg`
      await expect(signOwnedObjectRead(user, key)).resolves.toMatchObject({ url: 'https://r2.test/result' })
      await expect(signOwnedObjectRead(user, `temporary/${route}-results/other/1.jpg`)).rejects.toBeInstanceOf(HttpError)
    }
  })
})
