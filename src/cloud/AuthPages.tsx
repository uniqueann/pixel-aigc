import { useEffect, useState, type FormEvent } from 'react'
import { Alert, Button, Input, Space } from 'antd'
import { authEnabled, cloudConfigurationError, supabase } from './client'
import { safeNext } from './authPaths'

const callbackUrl = () => `${window.location.origin}/auth/callback`
const validPassword = (value: string) => value.length >= 8 && value.length <= 128

let exchange: Promise<unknown> | undefined
export default function AuthPages() {
  const path = window.location.pathname
  const params = new URLSearchParams(window.location.search)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState(cloudConfigurationError ?? (path === '/auth/callback' ? params.get('error_description') ?? params.get('error') ?? (!params.has('code') ? '登录链接无效或已过期，请重新申请' : '') : ''))
  const next = safeNext(params.get('next'))

  useEffect(() => {
    const client = supabase
    if (path !== '/auth/callback' || !client) return
    const callbackParams = new URLSearchParams(window.location.search)
    const code = callbackParams.get('code')
    if (callbackParams.has('error') || !code) return
    if (!exchange) exchange = client.auth.exchangeCodeForSession(code)
    void exchange.then(result => {
      const response = result as Awaited<ReturnType<typeof client.auth.exchangeCodeForSession>>
      if (response.error) throw response.error
      if (callbackParams.get('next') === '/reset-password') {
        sessionStorage.setItem('pixel-aigc-recovery', response.data.user?.id ?? '')
        window.location.replace('/reset-password')
      } else window.location.replace(safeNext(sessionStorage.getItem('pixel-aigc-next')))
    }).catch(err => setError(err instanceof Error ? err.message : '登录链接无效，请重试'))
  }, [path])

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('')
    try { await action() } catch (err) { setError(err instanceof Error ? err.message : '请求失败，请重试') }
    finally { setBusy(false) }
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const client = supabase
    if (!client) return
    void run(async () => {
      if (path === '/login') {
        const { error: resultError } = await client.auth.signInWithPassword({ email: email.trim(), password })
        if (resultError) throw resultError
        window.location.replace(next)
      } else if (path === '/register') {
        if (!validPassword(password) || password !== confirm) throw new Error('密码须为 8–128 位，且两次输入一致')
        sessionStorage.setItem('pixel-aigc-next', next)
        const { error: resultError } = await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: callbackUrl() } })
        if (resultError) throw resultError
        window.location.replace('/verify-email')
      } else if (path === '/forgot-password' || path === '/verify-email') {
        const { error: resultError } = path === '/verify-email'
          ? await client.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: callbackUrl() } })
          : await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${callbackUrl()}?next=/reset-password` })
        if (resultError) throw resultError
        setNotice(path === '/verify-email'
          ? '如果该邮箱可用于此操作，请查收验证邮件。验证链接会打开 ContentUp；完成后返回 Pixel AIGC 登录。'
          : '如果该邮箱可用于此操作，请查收邮件。请在发起请求的浏览器中打开链接。')
      } else if (path === '/reset-password') {
        if (!validPassword(password) || password !== confirm) throw new Error('密码须为 8–128 位，且两次输入一致')
        const { data } = await client.auth.getUser()
        if (!data.user || sessionStorage.getItem('pixel-aigc-recovery') !== data.user.id) throw new Error('恢复会话已失效，请重新申请密码重置邮件')
        const { error: resultError } = await client.auth.updateUser({ password })
        if (resultError) throw resultError
        sessionStorage.removeItem('pixel-aigc-recovery')
        window.location.replace('/')
      }
    })
  }

  if (!authEnabled || cloudConfigurationError) return <div className="project-recovery-screen"><Alert type="error" message={cloudConfigurationError ?? '账号系统尚未启用'} /></div>
  if (path === '/account-disabled') return <div className="project-recovery-screen"><h2>账号已停用</h2>
    <p>当前账号暂时无法使用 Pixel AIGC，请联系管理员。</p>
    <Button onClick={() => { void supabase?.auth.signOut({ scope: 'local' }).then(() => window.location.replace('/login')) }}>退出并切换账号</Button></div>
  const labels: Record<string,string> = { '/login': '登录', '/register': '注册', '/verify-email': '验证邮箱', '/forgot-password': '找回密码', '/reset-password': '设置新密码', '/auth/callback': '正在完成验证' }
  return <div className="project-recovery-screen" style={{ maxWidth: 420, margin: '10vh auto', gap: 16 }}>
    <h2>Pixel AIGC · {labels[path] ?? '账号'}</h2>
    {path === '/verify-email' && <p>注册邮件已发送。共享账号的验证链接会打开 ContentUp；验证成功后返回 Pixel AIGC 登录。需要重发时输入邮箱。</p>}
    {path === '/reset-password' && <p>新密码会用于此共享账号，也会影响 ContentUp、EDM 的密码登录。</p>}
    {error && <Alert type="error" showIcon message={error} />}
    {notice && <Alert type="info" showIcon message={notice} />}
    {path !== '/auth/callback' && <form onSubmit={submit} style={{ display: 'grid', gap: 12, width: '100%' }}>
      {path !== '/reset-password' && <Input type="email" autoComplete="email" aria-label="邮箱" required placeholder="邮箱" value={email} onChange={event => setEmail(event.target.value)} />}
      {['/login','/register','/reset-password'].includes(path) && <Input.Password required minLength={path === '/login' ? undefined : 8} maxLength={128} aria-label={path === '/reset-password' ? '新密码' : '密码'} autoComplete={path === '/login' ? 'current-password' : 'new-password'} placeholder={path === '/reset-password' ? '新密码' : '密码'} value={password} onChange={event => setPassword(event.target.value)} />}
      {['/register','/reset-password'].includes(path) && <Input.Password required minLength={8} maxLength={128} aria-label="确认密码" autoComplete="new-password" placeholder="确认密码" value={confirm} onChange={event => setConfirm(event.target.value)} />}
      <Button htmlType="submit" type="primary" loading={busy}>{path === '/verify-email' ? '重发验证邮件' : path === '/forgot-password' ? '发送恢复邮件' : labels[path]}</Button>
    </form>}
    {path === '/login' && <Button onClick={() => { void run(async () => {
      sessionStorage.setItem('pixel-aigc-next', next)
      const { error: resultError } = await supabase!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callbackUrl(), queryParams: { prompt: 'select_account' } } })
      if (resultError) throw resultError
    }) }} loading={busy}>使用 Google 登录</Button>}
    <Space wrap>
      {path !== '/login' && <a href="/login">返回登录</a>}
      {path === '/login' && <><a href={`/register?next=${encodeURIComponent(next)}`}>注册账号</a><a href="/forgot-password">忘记密码</a></>}
      {path === '/auth/callback' || path === '/reset-password' ? <a href="/forgot-password">重新申请恢复邮件</a> : null}
    </Space>
  </div>
}
