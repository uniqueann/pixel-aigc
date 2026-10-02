import { z } from 'zod'
import { PLATFORM_SIZE_PRESETS } from './platform-sizes.js'
import { RELIGHT_DIRECTIONS, RELIGHT_QUALITIES, RELIGHT_TEMPERATURES } from './relight.js'
import { RETOUCH_DIRECTION_IDS } from './retouch.js'

export const COUNT_TOOLS = ['smart-edit', 'relight', 'variation', 'fusion', 'retouch'] as const
export type CountTool = typeof COUNT_TOOLS[number]
export const WORKSTATION_SLUGS = [...COUNT_TOOLS, 'remove', 'repaint', 'outpaint'] as const
export const TOOLBOX_SLUGS = ['bg-remove', 'watermark', 'aspect-ratio'] as const
export const START_PAGES = ['/', '/email', '/image-workstation', '/toolbox', '/canvas', '/assets', 'last'] as const
export type AssetViewMode = 'grid' | 'list'

export function isPreferencePage(path: string): boolean {
  return START_PAGES.some(page => page !== 'last' && page === path)
    || WORKSTATION_SLUGS.some(slug => path === `/image-workstation/${slug}`)
    || TOOLBOX_SLUGS.some(slug => path === `/toolbox/${slug}`)
    || ['/canvas/text-to-image', '/canvas/text-to-video'].includes(path)
}

const count = z.number().int().min(1).max(4)
const resolution = z.enum(['1k', '2k', '4k'])
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const background = z.union([color, z.literal('transparent')])
const presetId = z.string().refine(value => PLATFORM_SIZE_PRESETS.some(preset => preset.id === value))
const imageParameters = z.object({ count: count.optional(), resolution: resolution.optional() }).strict()
const relight = z.object({ direction: z.enum(RELIGHT_DIRECTIONS), quality: z.enum(RELIGHT_QUALITIES), temperature: z.enum(RELIGHT_TEMPERATURES) }).strict()
const watermark = z.object({
  text: z.string().max(80).optional(), color: color.optional(), opacity: z.number().min(10).max(100).optional(),
  textSizePercent: z.number().min(1).max(15).optional(), logoSizePercent: z.number().min(5).max(50).optional(),
  marginPercent: z.number().min(0).max(10).optional(), layout: z.enum(['single', 'tile']).optional(),
  anchor: z.enum(['top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right']).optional(),
  tileGapPercent: z.number().min(0).max(30).optional(), tileRotation: z.number().min(-60).max(60).optional(),
}).strict()
export const imageMemorySchema = z.object({
  'smart-edit': imageParameters.optional(), variation: imageParameters.optional(), fusion: imageParameters.optional(),
  retouch: imageParameters.extend({ retouchDirections: z.array(z.enum(RETOUCH_DIRECTION_IDS)).max(4).optional() }).optional(),
  relight: imageParameters.extend({ relight: relight.optional() }).optional(),
  outpaint: z.object({
    outpaintMode: z.enum(['free', 'preset']).optional(), outpaintOutputMode: z.enum(['original', 'platform']).optional(),
    presetPlatform: z.string().refine(value => PLATFORM_SIZE_PRESETS.some(preset => preset.platform === value)).optional(),
  }).strict().optional(),
  'bg-remove': z.object({ background }).strict().optional(),
  'aspect-ratio': z.object({
    strategy: z.enum(['letterbox', 'crop', 'outpaint']).optional(), selectedPresetId: presetId.optional(),
    background: background.optional(), outpaintOutputMode: z.enum(['original', 'platform']).optional(),
  }).strict().optional(),
  watermark: watermark.optional(),
}).strict()
export type ImageMemory = z.infer<typeof imageMemorySchema>
export type ImageMemoryTool = keyof ImageMemory

const counts = z.object({ 'smart-edit': count, relight: count, variation: count, fusion: count, retouch: count }).strict()
const workbench = z.object({ startPage: z.enum(START_PAGES), rememberSidebar: z.boolean(), assetsView: z.enum(['grid', 'list', 'remember']) }).strict()
const email = z.object({
  language: z.enum(['zh', 'en', 'ja']), operation: z.enum(['reply', 'summarize', 'polish', 'grammar']),
  polishStyles: z.array(z.enum(['clear', 'shorten', 'lengthen', 'simplify'])).max(4),
}).strict()
const recent = z.object({ page: z.string().refine(isPreferencePage), assetsView: z.enum(['grid', 'list']) }).strict()
export const preferencesSchema = z.object({
  version: z.literal(1), workbench,
  image: z.object({ counts, resolution, rememberParameters: z.boolean(), lastUsed: imageMemorySchema }).strict(),
  email, recent,
}).strict()
export type PersonalizationPreferences = z.infer<typeof preferencesSchema>

export const preferencesPatchSchema = z.object({
  workbench: workbench.partial().optional(), email: email.partial().optional(), recent: recent.partial().optional(),
  image: z.object({
    counts: counts.partial().optional(), resolution: resolution.optional(), rememberParameters: z.boolean().optional(),
    lastUsed: imageMemorySchema.nullable().optional(),
  }).strict().optional(),
}).strict()
export type PreferencesPatch = z.infer<typeof preferencesPatchSchema>
export interface PreferencesResponse {
  preferences: PersonalizationPreferences
  hasStoredPreferences: boolean
  updatedAt: string | null
}
export const preferencesRequestSchema = z.object({
  patches: z.array(preferencesPatchSchema).min(1).max(100), initializeOnly: z.boolean().optional(),
}).strict()

export function defaultPreferences(): PersonalizationPreferences {
  return {
    version: 1,
    workbench: { startPage: '/', rememberSidebar: true, assetsView: 'remember' },
    image: { counts: { 'smart-edit': 1, relight: 2, variation: 2, fusion: 1, retouch: 1 }, resolution: '2k', rememberParameters: true, lastUsed: {} },
    email: { language: 'zh', operation: 'reply', polishStyles: ['clear'] },
    recent: { page: '/', assetsView: 'grid' },
  }
}

function mergeObjects(base: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch
  const result: Record<string, unknown> = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || value === undefined) continue
    result[key] = mergeObjects(result[key], value)
  }
  return result
}

/** 补丁按顺序合并；清除记忆的空值不能被后续新增参数吞掉。 */
export function applyPreferencesPatch(base: PersonalizationPreferences, patch: PreferencesPatch): PersonalizationPreferences {
  const merged = mergeObjects(base, patch) as PersonalizationPreferences
  if (patch.image?.lastUsed === null) merged.image.lastUsed = {}
  return preferencesSchema.parse(merged)
}

export function normalizePreferences(value: unknown): PersonalizationPreferences {
  const parsed = preferencesSchema.safeParse(value)
  return parsed.success ? parsed.data : defaultPreferences()
}

export function resolveStartPage(preferences: PersonalizationPreferences): string {
  const target = preferences.workbench.startPage === 'last' ? preferences.recent.page : preferences.workbench.startPage
  return isPreferencePage(target) ? target : '/'
}
