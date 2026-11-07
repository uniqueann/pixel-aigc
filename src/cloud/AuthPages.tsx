import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Alert, Button, Input, Space, type InputRef } from 'antd'
import { EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons'
import { authEnabled, cloudConfigurationError, supabase } from './client'
import { callbackHasLink, exchangeCodeOnce, verifyEmailLink } from './authCallback'
import { safeNext } from './authPaths'
import { authErrorMessage } from './authErrors'
import { PixelWordmark } from '@/components/brand/PixelLogo'

const callbackUrl = () => `${window.location.origin}/auth/callback`
const validPassword = (value: string) => value.length >= 8 && value.length <= 128

// antd 的 Input.Password 把图标包成不可聚焦的 span；这里用普通 Input + 真正的按钮，
// 让键盘与读屏都能操作密码可见性，同时保持切换后焦点不丢失。
function PasswordField({ label, placeholder, autoComplete, minLength, value, onChange }: {
  label: string
  placeholder: string
  autoComplete: string
  minLength?: number
  value: string
  onChange: (value: string) => void
}) {
  const [visible, setVisible] = useState(false)
  const inputRef = useRef<InputRef>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  return <Input
    ref={inputRef}
    type={visible ? 'text' : 'password'}
    required
    minLength={minLength}
    maxLength={128}
    aria-label={label}
    autoComplete={autoComplete}
    placeholder={placeholder}
    value={value}
    onChange={event => onChange(event.target.value)}
    suffix={<button
      ref={toggleRef}
      type="button"
      className="auth-password-toggle"
      aria-label={visible ? '隐藏密码' : '显示密码'}
      aria-pressed={visible}
      onMouseDown={event => event.preventDefault()}
      onClick={event => {
        // 阻止冒泡到 affix 外层，否则 antd 会把焦点抢回输入框。
        event.stopPropagation()
        setVisible(current => !current)
        // 键盘触发时把焦点留在按钮上，读屏才能听到切换后的状态；鼠标点击则回到输入框继续输入。
        if (event.detail === 0) requestAnimationFrame(() => toggleRef.current?.focus())
        else inputRef.current?.focus()
      }}
    >{visible ? <EyeOutlined /> : <EyeInvisibleOutlined />}</button>}
  />
}

export default function AuthPages() {
  const path = window.location.pathname
  const params = new URLSearchParams(window.location.search)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState(cloudConfigurationError ?? (path === '/auth/callback' ? params.get('error_description') ?? params.get('error') ?? (callbackHasLink(params) ? '' : '登录链接无效或已过期，请重新申请') : ''))
  const next = safeNext(params.get('next'))

  useEffect(() => {
    const client = supabase
    if (path !== '/auth/callback' || !client) return
    const callbackParams = new URLSearchParams(window.location.search)
    if (callbackParams.has('error')) return
    const code = callbackParams.get('code')
    if (code) {
      void exchangeCodeOnce(() => client.auth.exchangeCodeForSession(code)).then(result => {
        const response = result as Awaited<ReturnType<typeof client.auth.exchangeCodeForSession>>
        if (response.error) throw response.error
        if (callbackParams.get('next') === '/reset-password') {
          sessionStorage.setItem('pixel-aigc-recovery', response.data.user?.id ?? '')
          window.location.replace('/reset-password')
        } else window.location.replace(safeNext(sessionStorage.getItem('pixel-aigc-next')))
      }).catch(err => setError(authErrorMessage(err, '登录链接无效，请重试')))
      return
    }
    if (!callbackParams.has('token_hash')) return
    void verifyEmailLink(client, callbackParams).then(outcome => {
      if (outcome.kind === 'error') {
        setError(outcome.message)
        return
      }
      if (outcome.kind === 'recovery') {
        sessionStorage.setItem('pixel-aigc-recovery', outcome.userId)
        window.location.replace('/reset-password')
        return
      }
      window.location.replace(safeNext(sessionStorage.getItem('pixel-aigc-next')))
    })
  }, [path])

  const run = async (action: () => Promise<void>, fallback = '请求失败，请重试') => {
    setBusy(true); setError(''); setNotice('')
    try { await action() } catch (err) { setError(authErrorMessage(err, fallback)) }
    finally { setBusy(false) }
  }
  const submitFallback = path === '/login' ? '登录失败，请稍后重试。'
    : path === '/register' ? '注册失败，请稍后重试。'
    : path === '/verify-email' ? '验证邮件发送失败，请稍后重试。'
    : path === '/forgot-password' ? '重置邮件发送失败，请稍后重试。'
    : path === '/reset-password' ? '密码更新失败，请稍后重试。'
    : '请求失败，请重试'
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
          ? '验证邮件已发送，请查收邮件完成验证。'
          : '重置密码链接已发送至您的邮箱，请查收。')
      } else if (path === '/reset-password') {
        if (!validPassword(password) || password !== confirm) throw new Error('密码须为 8–128 位，且两次输入一致')
        const { data } = await client.auth.getUser()
        if (!data.user || sessionStorage.getItem('pixel-aigc-recovery') !== data.user.id) throw new Error('恢复会话已失效，请重新申请密码重置邮件')
        const { error: resultError } = await client.auth.updateUser({ password })
        if (resultError) throw resultError
        sessionStorage.removeItem('pixel-aigc-recovery')
        window.location.replace('/')
      }
    }, submitFallback)
  }

  if (!authEnabled || cloudConfigurationError) return <div className="project-recovery-screen"><Alert type="error" message={cloudConfigurationError ?? '账号系统尚未启用'} /></div>
  if (path === '/account-disabled') return <div className="project-recovery-screen"><h2>账号已停用</h2>
    <p>当前账号暂时无法使用 Pixel AIGC，请联系管理员。</p>
    <Button onClick={() => { void supabase?.auth.signOut({ scope: 'local' }).then(() => window.location.replace('/login')) }}>退出并切换账号</Button></div>
  const labels: Record<string,string> = { '/login': '登录', '/register': '注册', '/verify-email': '验证邮箱', '/forgot-password': '找回密码', '/reset-password': '设置新密码', '/auth/callback': '正在完成验证' }
  return <div className="project-recovery-screen auth-screen" style={{ maxWidth: 420, margin: '10vh auto', gap: 16 }}>
    <PixelWordmark className="auth-wordmark" />
    <h2>{labels[path] ?? '账号'}</h2>
    {path === '/verify-email' && <p>注册邮件已发送，如需重发请输入邮箱。</p>}
    {path === '/reset-password' && <p>设置新密码后，请使用新密码重新登录。</p>}
    {error && <Alert type="error" showIcon message={error} />}
    {notice && <Alert type="info" showIcon message={notice} />}
    {path !== '/auth/callback' && <form onSubmit={submit} style={{ display: 'grid', gap: 12, width: '100%' }}>
      {path !== '/reset-password' && <Input type="email" autoComplete="email" aria-label="邮箱" required placeholder="邮箱" value={email} onChange={event => setEmail(event.target.value)} />}
      {['/login','/register','/reset-password'].includes(path) && <PasswordField
        label={path === '/reset-password' ? '新密码' : '密码'}
        placeholder={path === '/reset-password' ? '新密码' : '密码'}
        autoComplete={path === '/login' ? 'current-password' : 'new-password'}
        minLength={path === '/login' ? undefined : 8}
        value={password}
        onChange={setPassword}
      />}
      {['/register','/reset-password'].includes(path) && <PasswordField
        label="确认密码"
        placeholder="确认密码"
        autoComplete="new-password"
        minLength={8}
        value={confirm}
        onChange={setConfirm}
      />}
      <Button htmlType="submit" type="primary" loading={busy}>{path === '/verify-email' ? '重发验证邮件' : path === '/forgot-password' ? '发送重置邮件' : labels[path]}</Button>
    </form>}
    {path === '/login' && <Button onClick={() => { void run(async () => {
      sessionStorage.setItem('pixel-aigc-next', next)
      const { error: resultError } = await supabase!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callbackUrl(), queryParams: { prompt: 'select_account' } } })
      if (resultError) throw resultError
    }, 'Google 登录发起失败，请稍后重试。') }} loading={busy}>使用 Google 登录</Button>}
    <Space wrap>
      {path !== '/login' && <a href="/login">返回登录</a>}
      {path === '/login' && <><a href={`/register?next=${encodeURIComponent(next)}`}>注册账号</a><a href="/forgot-password">忘记密码</a></>}
      {path === '/auth/callback' || path === '/reset-password' ? <a href="/forgot-password">重新申请重置邮件</a> : null}
    </Space>
    <Space wrap>
      <a href="/about" target="_blank" rel="noopener noreferrer">产品介绍</a>
      <a href="/privacy" target="_blank" rel="noopener noreferrer">隐私政策</a>
      <a href="https://contentup.cc/terms" target="_blank" rel="noopener noreferrer">服务条款</a>
    </Space>
  </div>
}
