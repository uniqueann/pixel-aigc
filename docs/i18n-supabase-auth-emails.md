# Supabase Auth Transactional Email Localization (i18n)

Supabase Auth handles account-verification and password-reset emails outside the application repository. Changing the client UI locale in `pixel:locale` does **not** automatically change Supabase's default built-in emails unless the templates in your Supabase project are updated.

## Affected Emails

- **Confirm signup** (new account email verification)
- **Reset password** (password recovery link)
- **Change email address** (confirm old/new email address)
- **Magic link / Invite user** (if enabled in the future)

## Where Templates Live

1. **Supabase Dashboard**: **Authentication -> Email Templates**
2. **Supabase CLI / Management API**: project auth config (`supabase/config.toml` or Auth config API if using a linked CLI workspace)

---

## Option A: Bilingual Combined Templates (Zero Client Code Required)

Include English first followed by Simplified Chinese (or vice versa) inside a single template body and subject so every recipient receives a clear email regardless of locale.

### Example Subject (`Confirm signup`)

```text
Confirm your AIGC Workbench account / 验证你的 AIGC 工作台账号
```

### Example HTML Body (`Confirm signup`)

```html
<h2>Confirm your email address / 请确认你的邮箱</h2>
<p>Click the link below to finish signing up for AIGC Workbench:</p>
<p><a href="{{ .ConfirmationURL }}">Confirm email address</a></p>
<hr />
<p>请点击下方链接完成 AIGC 工作台账号注册验证：</p>
<p><a href="{{ .ConfirmationURL }}">确认邮箱地址</a></p>
```

---

## Option B: Per-User Locale Branching via Go Templates

Supabase evaluates Auth email templates with Go `html/template` and exposes user metadata under `.Data`.

1. On sign-up (`supabase.auth.signUp({ email, password, options: { data: { locale: activeLocale() } } })`), pass the user's current locale (`zh-CN` or `en-US`) in `options.data.locale`.
2. Note: `resetPasswordForEmail` does not attach custom metadata on its own unless previously saved on the user record (for example at sign-up or profile metadata sync).

### Example Conditional Body (`Confirm signup`)

```html
{{ if eq .Data.locale "en-US" }}
<h2>Confirm your email</h2>
<p>Click the link below to verify your email address for AIGC Workbench:</p>
<p><a href="{{ .ConfirmationURL }}">Confirm email</a></p>
{{ else }}
<h2>请验证你的邮箱</h2>
<p>点击下方链接完成 AIGC 工作台邮箱验证：</p>
<p><a href="{{ .ConfirmationURL }}">立即验证邮箱</a></p>
{{ end }}
```

### Example Conditional Body (`Reset password`)

```html
{{ if eq .Data.locale "en-US" }}
<h2>Reset your password</h2>
<p>Click the link below to choose a new password for AIGC Workbench:</p>
<p><a href="{{ .ConfirmationURL }}">Reset password</a></p>
{{ else }}
<h2>重置登录密码</h2>
<p>点击下方链接为 AIGC 工作台账号设置新密码：</p>
<p><a href="{{ .ConfirmationURL }}">重设密码</a></p>
{{ end }}
```

## Notes

- Keep `{{ .ConfirmationURL }}` unmodified in every branch so PKCE / OTP verification tokens remain intact.
- If a user switches language locally via `localStorage['pixel:locale']` after signing up without server persistence, **Option A** guarantees they still understand password-reset emails in both languages.
