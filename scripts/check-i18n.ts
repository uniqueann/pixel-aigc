import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const LOCALES_DIR = path.join(ROOT, 'src', 'i18n', 'locales')
const ZH_DIR = path.join(LOCALES_DIR, 'zh-CN')
const EN_DIR = path.join(LOCALES_DIR, 'en-US')

/** 随迁移进度逐步加入此处；每加入一个目录/文件，就会检查其中不得残留非注释硬编码中文。 */
export const MIGRATED_PATHS: readonly string[] = [
  'src/i18n',
  'src/router',
  'src/layouts',
  'src/cloud',
  'src/components',
  'src/utils',
  'src/hooks',
  'src/features/preferences',
  'src/features/model-settings',
  'src/pages/Dashboard',
  'src/features/dashboard',
  'src/features/activation',
  'src/features/credits',
  'src/services/api',
  'src/pages/ImageWorkstation',
  'src/features/image-workstation',
  'src/pages/Toolbox',
  'src/features/toolbox-pipeline',
  'src/features/task-center',
  'src/pages/Assets',
  'src/features/assets',
  'src/pages/EcommerceSuite',
  'src/features/ecommerce-suite',
  'src/pages/FreeCanvas',
  'src/features/free-canvas',
  'src/editor',
  'src/pages/EmailAssistant',
  'src/features/email-assistant',
  'src/pages/Help',
  'src/App.tsx',
  'src/main.tsx',
  'src/constants',
  'src/features/generation',
  'src/services/providers',
  'src/store',
  'src/types',
]

/** 仅用于语言本身名称、历史数据库映射表或兼容旧 CSV 导出的精确白名单。 */
const CJK_ALLOWLIST: Record<string, RegExp[]> = {
  'src/i18n/apiErrors.ts': [
    /'首次赠送'/,
    /'积分充值'/,
    /'现金退款或支付争议收回充值积分'/,
    /'任务处理超时，请重试'/,
    /'任务处理超时，积分已返还'/,
    /'当前排队人数较多，请稍后重试（积分已退回）'/,
  ],
  'src/cloud/AuthPages.tsx': [/'简体中文'/],
  'src/layouts/SettingsDialog.tsx': [/'简体中文'/],
}

const CJK_RE = /[\u4e00-\u9fff]/
const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g

function flattenJson(obj: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (typeof obj === 'string') {
    out.set(prefix, obj)
    return out
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error(`Invalid i18n value at "${prefix}": expected string or plain object`)
  }
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${k}` : k
    flattenJson(v, next, out)
  }
  return out
}

function placeholdersOf(text: string): string[] {
  const vars = new Set<string>()
  for (const match of text.matchAll(PLACEHOLDER_RE)) {
    vars.add(match[1])
  }
  return [...vars].sort()
}

function listJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort()
}

function walkTsFiles(target: string, out: string[] = []): string[] {
  const abs = path.join(ROOT, target)
  if (!fs.existsSync(abs)) return out
  const stat = fs.statSync(abs)
  if (stat.isFile()) {
    if (/\.(ts|tsx)$/.test(abs) && !/\.(test|spec)\.(ts|tsx)$/.test(abs)) out.push(target)
    return out
  }
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(target, entry.name)
    if (entry.isDirectory()) walkTsFiles(rel, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) out.push(rel)
  }
  return out
}

function stripLineCommentOutsideStrings(line: string): string {
  let quote: "'" | '"' | '`' | null = null
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quote) {
      if (ch === '\\') {
        i += 1
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '/' && line[i + 1] === '/') return line.slice(0, i)
  }
  return line
}

function stripCommentsAndCheckCjk(relPath: string): Array<{ line: number; text: string }> {
  const abs = path.join(ROOT, relPath)
  const lines = fs.readFileSync(abs, 'utf8').split('\n')
  const allowPatterns = CJK_ALLOWLIST[relPath.replace(/\\/g, '/')] ?? []
  const violations: Array<{ line: number; text: string }> = []
  let inBlockComment = false

  lines.forEach((raw, idx) => {
    let line = raw
    if (inBlockComment) {
      const end = line.indexOf('*/')
      if (end === -1) return
      line = line.slice(end + 2)
      inBlockComment = false
    }
    line = line.replace(/\/\*[\s\S]*?\*\//g, '')
    const blockStart = line.indexOf('/*')
    if (blockStart !== -1) {
      line = line.slice(0, blockStart)
      inBlockComment = true
    }
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return
    line = stripLineCommentOutsideStrings(line)

    if (!CJK_RE.test(line)) return
    let masked = line
    for (const pattern of allowPatterns) {
      masked = masked.replace(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`), '')
    }
    if (CJK_RE.test(masked)) {
      violations.push({ line: idx + 1, text: raw.trim() })
    }
  })

  return violations
}

function main() {
  const errors: string[] = []
  const zhFiles = listJsonFiles(ZH_DIR)
  const enFiles = listJsonFiles(EN_DIR)

  if (zhFiles.length === 0) errors.push('No zh-CN locale JSON files found')
  for (const file of zhFiles) {
    if (!enFiles.includes(file)) errors.push(`Missing en-US namespace file: ${file}`)
  }
  for (const file of enFiles) {
    if (!zhFiles.includes(file)) errors.push(`Extra en-US namespace file without zh-CN counterpart: ${file}`)
  }

  for (const file of zhFiles) {
    if (!enFiles.includes(file)) continue
    const zhJson = JSON.parse(fs.readFileSync(path.join(ZH_DIR, file), 'utf8'))
    const enJson = JSON.parse(fs.readFileSync(path.join(EN_DIR, file), 'utf8'))
    const zhMap = flattenJson(zhJson)
    const enMap = flattenJson(enJson)

    for (const [key, zhVal] of zhMap) {
      if (!zhVal.trim()) errors.push(`Empty value in zh-CN/${file}: "${key}"`)
      if (!enMap.has(key)) {
        errors.push(`Missing key in en-US/${file}: "${key}"`)
        continue
      }
      const enVal = enMap.get(key)!
      if (!enVal.trim()) errors.push(`Empty value in en-US/${file}: "${key}"`)
      const zhVars = placeholdersOf(zhVal)
      const enVars = placeholdersOf(enVal)
      if (zhVars.join(',') !== enVars.join(',')) {
        errors.push(`Placeholder mismatch in ${file} "${key}": zh=[${zhVars.join(', ')}] vs en=[${enVars.join(', ')}]`)
      }
    }
    for (const key of enMap.keys()) {
      if (!zhMap.has(key)) errors.push(`Extra key in en-US/${file}: "${key}"`)
    }
  }

  const migratedFiles = [...new Set(MIGRATED_PATHS.flatMap(target => walkTsFiles(target)))].sort()
  for (const file of migratedFiles) {
    const hits = stripCommentsAndCheckCjk(file)
    for (const hit of hits) {
      errors.push(`Unlocalized CJK in migrated file ${file}:${hit.line}: ${hit.text}`)
    }
  }

  if (errors.length) {
    console.error(`i18n check failed (${errors.length} issue(s)):`)
    for (const err of errors) console.error(`  - ${err}`)
    process.exit(1)
  }

  console.log(`i18n check passed (${zhFiles.length} namespaces, ${migratedFiles.length} migrated files checked).`)
}

main()
