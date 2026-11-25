import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Alert, Button, Input, Space, type InputRef } from 'antd'
import { EyeInvisibleOutlined, EyeOutlined, GoogleOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useLocaleStore } from '@/i18n/store'
import { authEnabled, cloudConfigurationError, supabase } from './client'
import { callbackHasLink, exchangeCodeOnce, verifyEmailLink } from './authCallback'
import { safeNext } from './authPaths'
import { authErrorFields, authErrorMessage, LocalAuthError, type AuthField } from './authErrors'
import { PixelWordmark } from '@/components/brand/PixelLogo'

const callbackUrl = () => `${window.location.origin}/auth/callback`
const validPassword = (value: string) => value.length >= 8 && value.length <= 128
type FieldErrors = Partial<Record<AuthField, string>>

// antd 的 Input.Password 把图标包成不可聚焦的 span；这里用普通 Input + 真正的按钮，
// 让键盘与读屏都能操作密码可见性，同时保持切换后焦点不丢失。
function PasswordField({ id, label, placeholder, autoComplete, minLength, invalid, describedBy, value, onChange }: {
  id: string
  label: string
  placeholder: string
  autoComplete: string
  minLength?: number
  invalid?: boolean
  describedBy?: string
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation('auth')
  const [visible, setVisible] = useState(false)
  const inputRef = useRef<InputRef>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  return <>
    <label className="auth-field-label" htmlFor={id}>{label}</label>
    <Input
      ref={inputRef}
      id={id}
      status={invalid ? 'error' : undefined}
      type={visible ? 'text' : 'password'}
      required
      minLength={minLength}
      maxLength={128}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      autoComplete={autoComplete}
      placeholder={placeholder}
      value={value}
      onChange={event => onChange(event.target.value)}
      suffix={<button
        ref={toggleRef}
        type="button"
        className="auth-password-toggle"
        aria-label={visible ? t('pages.fields.hidePassword') : t('pages.fields.showPassword')}
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
  </>
}

function AuthLocaleHeader() {
  const locale = useLocaleStore(state => state.locale)
  const setLocale = useLocaleStore(state => state.setLocale)
  const nextLocale = locale === 'zh-CN' ? 'en-US' : 'zh-CN'
  return (
    <div className="auth-screen-top">
      <PixelWordmark className="auth-wordmark" />
      <Button
        size="small"
        type="text"
        className="auth-locale-toggle"
        onClick={() => void setLocale(nextLocale)}
      >
        {nextLocale === 'en-US' ? 'English' : '简体中文'}
      </Button>
    </div>
  )
}

// 认证页共用的法务入口，避免停用页与配置错误页各写一份。
function LegalLinks() {
  const { t } = useTranslation('auth')
  const locale = useLocaleStore(state => state.locale)
  const langSuffix = locale === 'en-US' ? '?lang=en-US' : ''
  return <Space wrap className="auth-legal">
    <a href={`/about${langSuffix}`} target="_blank" rel="noopener noreferrer">{t('pages.legal.about')}</a>
    <a href={`/privacy${langSuffix}`} target="_blank" rel="noopener noreferrer">{t('pages.legal.privacy')}</a>
    <a href="https://contentup.cc/terms" target="_blank" rel="noopener noreferrer">{t('pages.legal.terms')}</a>
  </Space>
}

export default function AuthPages() {
  const { t } = useTranslation('auth')
  const path = window.location.pathname
  const params = new URLSearchParams(window.location.search)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState(
    cloudConfigurationError ?? (
      path === '/auth/callback'
        ? params.get('error_description') ?? params.get('error') ?? (callbackHasLink(params) ? '' : t('errors.invalid_auth_link'))
        : ''
    ),
  )
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [errorFields, setErrorFields] = useState<AuthField[]>([])
  const next = safeNext(params.get('next'))

  const fieldId = (field: AuthField) => `auth-${field}`
  const fieldErrorId = (field: AuthField) => `auth-${field}-error`
  const isInvalid = (field: AuthField) => Boolean(fieldErrors[field]) || errorFields.includes(field)
  const describedBy = (field: AuthField) => {
    const ids: string[] = []
    if (fieldErrors[field]) ids.push(fieldErrorId(field))
    if (errorFields.includes(field)) ids.push('auth-form-error')
    return ids.length ? ids.join(' ') : undefined
  }
  const focusField = (field: AuthField) => requestAnimationFrame(() => document.getElementById(fieldId(field))?.focus())
  const clearFieldError = (field: AuthField) => {
    setFieldErrors(current => current[field] ? { ...current, [field]: undefined } : current)
    if (errorFields.includes(field)) {
      setErrorFields([])
      setError('')
    }
  }
  const validate = (): FieldErrors => {
    const errors: FieldErrors = {}
    const trimmedEmail = email.trim()
    if (path !== '/reset-password') {
      if (!trimmedEmail) errors.email = t('pages.validation.emailRequired')
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) errors.email = t('pages.validation.emailInvalid')
    }
    if (['/login', '/register', '/reset-password'].includes(path)) {
      if (!password) errors.password = t('pages.validation.passwordRequired')
      else if (path !== '/login' && !validPassword(password)) errors.password = t('pages.validation.passwordLength')
    }
    if (['/register', '/reset-password'].includes(path) && password !== confirm) errors.confirm = t('pages.validation.passwordMismatch')
    return errors
  }
  const applyAuthError = (err: unknown, fallback: string) => {
    const message = authErrorMessage(err, fallback)
    const fields = authErrorFields(err)
    if (fields.length === 1) {
      setFieldErrors({ [fields[0]]: message })
      setErrorFields([])
      setError('')
      focusField(fields[0])
      return
    }
    setFieldErrors({})
    setErrorFields(fields)
    setError(message)
    if (fields.length) focusField(fields[0])
  }

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
      }).catch(err => setError(authErrorMessage(err, t('pages.fallbacks.linkInvalid'))))
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
  }, [path, t])

  const run = async (action: () => Promise<void>, fallback = t('pages.fallbacks.requestFailed')) => {
    setBusy(true); setError(''); setNotice('')
    try { await action() } catch (err) { applyAuthError(err, fallback) }
    finally { setBusy(false) }
  }
  const submitFallback = path === '/login' ? t('pages.fallbacks.loginFailed')
    : path === '/register' ? t('pages.fallbacks.registerFailed')
    : path === '/verify-email' ? t('pages.fallbacks.verifyEmailFailed')
    : path === '/forgot-password' ? t('pages.fallbacks.forgotPasswordFailed')
    : path === '/reset-password' ? t('pages.fallbacks.resetPasswordFailed')
    : t('pages.fallbacks.requestFailed')
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const client = supabase
    if (!client) return
    const errors = validate()
    if (Object.keys(errors).length) {
      setFieldErrors(errors)
      setErrorFields([])
      setError('')
      setNotice('')
      const first = (['email', 'password', 'confirm'] as AuthField[]).find(field => errors[field])
      if (first) focusField(first)
      return
    }
    setFieldErrors({})
    setErrorFields([])
    void run(async () => {
      if (path === '/login') {
        const { error: resultError } = await client.auth.signInWithPassword({ email: email.trim(), password })
        if (resultError) throw resultError
        window.location.replace(next)
      } else if (path === '/register') {
        sessionStorage.setItem('pixel-aigc-next', next)
        const { error: resultError } = await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: callbackUrl() } })
        if (resultError) throw resultError
        window.location.replace('/verify-email')
      } else if (path === '/forgot-password' || path === '/verify-email') {
        const { error: resultError } = path === '/verify-email'
          ? await client.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: callbackUrl() } })
          : await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${callbackUrl()}?next=/reset-password` })
        if (resultError) throw resultError
        setNotice(path === '/verify-email' ? t('pages.notices.verificationSent') : t('pages.notices.resetSent'))
      } else if (path === '/reset-password') {
        const { data } = await client.auth.getUser()
        if (!data.user || sessionStorage.getItem('pixel-aigc-recovery') !== data.user.id) {
          throw new LocalAuthError('recovery_session_expired', t('errors.recovery_session_expired'))
        }
        const { error: resultError } = await client.auth.updateUser({ password })
        if (resultError) throw resultError
        sessionStorage.removeItem('pixel-aigc-recovery')
        window.location.replace('/')
      }
    }, submitFallback)
  }

  if (!authEnabled || cloudConfigurationError) return <div className="project-recovery-screen auth-screen">
    <AuthLocaleHeader />
    <h2>{t('pages.unavailableTitle')}</h2>
    <Alert type="error" showIcon message={cloudConfigurationError ?? t('pages.unavailableMessage')} />
    <LegalLinks />
  </div>
  if (path === '/account-disabled') return <div className="project-recovery-screen auth-screen">
    <AuthLocaleHeader />
    <h2>{t('pages.disabledTitle')}</h2>
    <p>{t('pages.disabledDescription')}</p>
    <Button type="primary" block onClick={() => { void supabase?.auth.signOut({ scope: 'local' }).then(() => window.location.replace('/login')) }}>{t('pages.signOutAndSwitch')}</Button>
    <LegalLinks />
  </div>
  const labels: Record<string, string> = {
    '/login': t('pages.titles.login'),
    '/register': t('pages.titles.register'),
    '/verify-email': t('pages.titles.verifyEmail'),
    '/forgot-password': t('pages.titles.forgotPassword'),
    '/reset-password': t('pages.titles.resetPassword'),
    '/auth/callback': t('pages.titles.callback'),
  }
  return <div className="project-recovery-screen auth-screen">
    <AuthLocaleHeader />
    <h2>{labels[path] ?? t('pages.titles.default')}</h2>
    {path === '/verify-email' && <p>{t('pages.verifyEmailHint')}</p>}
    {path === '/reset-password' && <p>{t('pages.resetPasswordHint')}</p>}
    {error && <Alert id="auth-form-error" type="error" showIcon message={error} />}
    {notice && <Alert type="info" showIcon message={notice} />}
    {path !== '/auth/callback' && <form noValidate onSubmit={submit} className="auth-form">
      {path !== '/reset-password' && <div className="auth-field">
        <label className="auth-field-label" htmlFor="auth-email">{t('pages.fields.email')}</label>
        <Input
          id="auth-email"
          status={isInvalid('email') ? 'error' : undefined}
          type="email"
          autoComplete="email"
          aria-invalid={isInvalid('email') || undefined}
          aria-describedby={describedBy('email')}
          required
          placeholder={t('pages.fields.email')}
          value={email}
          onChange={event => { setEmail(event.target.value); clearFieldError('email') }}
        />
        {fieldErrors.email && <p id="auth-email-error" className="auth-field-error">{fieldErrors.email}</p>}
      </div>}
      {['/login', '/register', '/reset-password'].includes(path) && <div className="auth-field">
        <PasswordField
          id="auth-password"
          label={path === '/reset-password' ? t('pages.fields.newPassword') : t('pages.fields.password')}
          placeholder={path === '/reset-password' ? t('pages.fields.newPassword') : t('pages.fields.password')}
          autoComplete={path === '/login' ? 'current-password' : 'new-password'}
          minLength={path === '/login' ? undefined : 8}
          invalid={isInvalid('password')}
          describedBy={describedBy('password')}
          value={password}
          onChange={value => { setPassword(value); clearFieldError('password') }}
        />
        {fieldErrors.password && <p id="auth-password-error" className="auth-field-error">{fieldErrors.password}</p>}
      </div>}
      {['/register', '/reset-password'].includes(path) && <div className="auth-field">
        <PasswordField
          id="auth-confirm"
          label={t('pages.fields.confirmPassword')}
          placeholder={t('pages.fields.confirmPassword')}
          autoComplete="new-password"
          minLength={8}
          invalid={isInvalid('confirm')}
          describedBy={describedBy('confirm')}
          value={confirm}
          onChange={value => { setConfirm(value); clearFieldError('confirm') }}
        />
        {fieldErrors.confirm && <p id="auth-confirm-error" className="auth-field-error">{fieldErrors.confirm}</p>}
      </div>}
      <Button htmlType="submit" type="primary" loading={busy}>{path === '/verify-email' ? t('pages.submit.resendVerify') : path === '/forgot-password' ? t('pages.submit.sendReset') : labels[path]}</Button>
    </form>}
    {path === '/login' && <>
      <div className="auth-divider" aria-hidden="true"><span>{t('pages.divider')}</span></div>
      <Button block icon={<GoogleOutlined />} onClick={() => { void run(async () => {
        sessionStorage.setItem('pixel-aigc-next', next)
        const { error: resultError } = await supabase!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callbackUrl(), queryParams: { prompt: 'select_account' } } })
        if (resultError) throw resultError
      }, t('pages.fallbacks.googleFailed')) }} loading={busy}>{t('pages.googleSignIn')}</Button>
    </>}
    <Space wrap>
      {path !== '/login' && <a href="/login">{t('pages.links.backToLogin')}</a>}
      {path === '/login' && <><a href={`/register?next=${encodeURIComponent(next)}`}>{t('pages.links.register')}</a><a href="/forgot-password">{t('pages.links.forgotPassword')}</a></>}
      {path === '/auth/callback' || path === '/reset-password' ? <a href="/forgot-password">{t('pages.links.reapplyReset')}</a> : null}
    </Space>
    <LegalLinks />
  </div>
}
