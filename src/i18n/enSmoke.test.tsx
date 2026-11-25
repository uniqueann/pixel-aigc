// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/task-center/TaskCenterRuntime', () => ({
  TaskCenterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/features/task-center/TaskCenterSidebar', () => ({
  TaskCenterSidebar: () => <div data-testid="task-center-sidebar" />,
  TaskCenterEntry: () => <button type="button">Tasks</button>,
}))
vi.mock('@/features/task-center/navigation', () => ({
  TaskNavigationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/features/activation/client', () => ({
  syncActivation: vi.fn().mockResolvedValue(undefined),
  saveWelcomeState: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/services/api/credits', () => ({
  listCreditLedger: vi.fn().mockResolvedValue({
    balance: 120,
    nextCursor: null,
    items: [
      {
        id: '1',
        createdAt: '2026-10-14T08:00:00.000Z',
        kind: 'settle',
        label: '精修 2K×1',
        title: '精修 2K×1',
        summary: '实扣 4',
        delta: -4,
        deltaText: '-4',
        balanceAfter: 120,
        charged: 4,
        reason: null,
        presentation: {
          entryType: 'image_job',
          tool: 'retouch',
          capability: 'retouch',
          resolution: '2K',
          count: 1,
          status: 'settled',
        },
      },
      {
        id: '2',
        createdAt: '2026-10-13T08:00:00.000Z',
        kind: 'grant',
        label: '赠送/充值',
        title: '',
        summary: '',
        delta: 30,
        deltaText: '+30',
        balanceAfter: 30,
        charged: null,
        reason: '首次赠送',
        presentation: {
          entryType: 'account',
          reasonCode: 'initial_grant',
        },
      },
      {
        id: '3',
        createdAt: '2026-10-12T08:00:00.000Z',
        kind: 'adjust',
        label: '管理员调整',
        title: '',
        summary: '',
        delta: -50,
        deltaText: '-50',
        balanceAfter: 0,
        charged: null,
        reason: '现金退款或支付争议收回充值积分',
      },
    ],
  }),
}))

import AuthPages from '@/cloud/AuthPages'
import CreditsLedgerDrawer from '@/features/credits/CreditsLedgerDrawer'
import { workstationToolLabel as assetWorkstationToolLabel } from '@/features/assets/labels'
import { suiteCategoryLabel, suitePlatformLabel, suiteSlotLabel } from '@/features/ecommerce-suite/i18n'
import { createEmailBatchTemplate } from '@/features/email-assistant/batch/csv'
import { emailLanguageLabel, emailOperationLabel } from '@/features/email-assistant/options'
import { workstationToolLabel } from '@/features/image-workstation/tools/registry'
import { localizedModelDisplayName, localizedTaskStateLabel, taskToolLabel } from '@/features/task-center/format'
import MainLayout from '@/layouts/MainLayout'
import SettingsDialog from '@/layouts/SettingsDialog'
import { groupAssetsByDay } from '@/pages/Assets/groupByDay'
import { canvasModeLabel } from '@/pages/FreeCanvas/modes'
import { getToolboxToolLabel } from '@/pages/Toolbox/tools'
import { useUserStore } from '@/store/useUserStore'
import { useLocaleStore } from './store'

const CJK_RE = /[\u4e00-\u9fff]/

function assertNoUnexpectedCjk(container: HTMLElement, allowedLiterals: string[] = []) {
  let text = container.textContent ?? ''
  for (const allowed of allowedLiterals) {
    text = text.replaceAll(allowed, '')
  }
  expect(text).not.toMatch(CJK_RE)
}

beforeEach(async () => {
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn()
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
  useUserStore.setState({
    userId: 'u1',
    credits: 120,
    creditsLoaded: true,
    account: {
      userId: 'u1',
      email: 'alice@example.com',
      emailVerified: true,
      displayName: 'Alice',
      credits: 120,
      avatarUrl: null,
      providers: ['email'],
      status: 'active',
      features: { ecommerceSuite: true },
      workspace: { id: 'w1', name: 'Personal', type: 'personal', role: 'admin' },
    },
  })
  await useLocaleStore.getState().setLocale('en-US')
})

afterEach(() => {
  cleanup()
})

afterAll(async () => {
  await useLocaleStore.getState().setLocale('zh-CN')
})

describe('en-US Phase 1 UI smoke tests', () => {
  it('renders AuthPages login view in English with explicit 简体中文 toggle', () => {
    window.history.pushState({}, '', '/login')
    const { container } = render(<AuthPages />)
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Continue with Google/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: '简体中文' })).toBeTruthy()
    assertNoUnexpectedCjk(container, ['简体中文'])
  })

  it('renders SettingsDialog general section in English', () => {
    const { container } = render(
      <SettingsDialog
        open
        section="general"
        narrow={false}
        onClose={() => undefined}
        onSectionChange={() => undefined}
      />,
    )
    expect(screen.getByText('Settings')).toBeTruthy()
    expect(screen.getByText('Language')).toBeTruthy()
    expect(screen.getByText('Personalization')).toBeTruthy()
    assertNoUnexpectedCjk(container)
  })

  it('renders MainLayout navigation in English without unexpected CJK', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<MainLayout />}>
              <Route index element={<div>Dashboard Body</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getAllByText('Home').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Image Studio').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Toolbox').length).toBeGreaterThan(0)
    expect(screen.getAllByText('E-commerce Suite').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Free Canvas').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Email Assistant').length).toBeGreaterThan(0)
    expect(screen.getAllByText('My Assets').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Credits 120').length).toBeGreaterThan(0)
    assertNoUnexpectedCjk(container)
  })

  it('renders CreditsLedgerDrawer structured and legacy entries in English', async () => {
    render(<CreditsLedgerDrawer open onClose={() => undefined} />)
    expect(await screen.findByText('Retouch 2K×1')).toBeTruthy()
    expect(screen.getByText('Charged 4')).toBeTruthy()
    expect(screen.getByText('Welcome bonus')).toBeTruthy()
    expect(screen.getByText('Credits reclaimed due to cash refund or dispute')).toBeTruthy()
    expect(screen.getByText('Buy Credits · Balance 120')).toBeTruthy()
    expect(document.body.textContent ?? '').not.toMatch(CJK_RE)
  })

  it('localizes Phase 2 helpers across Workstation, Toolbox, TaskCenter, and Assets in English', () => {
    expect(workstationToolLabel('relight')).toBe('Relight')
    expect(workstationToolLabel('retouch')).toBe('Retouch')
    expect(getToolboxToolLabel('bg-remove')).toBe('Background Removal')
    expect(getToolboxToolLabel('aspect-ratio')).toBe('Aspect Ratio')
    expect(taskToolLabel('email-assist')).toBe('Email Assistant')
    expect(localizedTaskStateLabel({ state: 'succeeded', partial: false })).not.toMatch(CJK_RE)
    expect(localizedModelDisplayName('__unknown_model_sentinel__')).not.toMatch(CJK_RE)
    expect(assetWorkstationToolLabel('smart-edit')).toBe('Smart Edit')

    const now = new Date('2026-10-15T12:00:00.000Z')
    const grouped = groupAssetsByDay([
      { createdAt: '2026-10-15T08:00:00.000Z' },
      { createdAt: '2026-10-14T08:00:00.000Z' },
      { createdAt: 'not-a-date' },
    ], now)
    expect(grouped.map(g => g.label)).toEqual(['Today', 'Yesterday', 'Unknown time'])
    for (const label of [
      workstationToolLabel('relight'),
      getToolboxToolLabel('bg-remove'),
      taskToolLabel('email-assist'),
      assetWorkstationToolLabel('smart-edit'),
      ...grouped.map(g => g.label),
    ]) {
      expect(label).not.toMatch(CJK_RE)
    }
  })

  it('localizes Phase 3 helpers across Ecommerce, Canvas, and Email in English', () => {
    const phase3Strings = [
      suitePlatformLabel('amazon'),
      suiteCategoryLabel('furniture'),
      suiteSlotLabel({ key: 'main', kind: 'main', name: 'main' }),
      canvasModeLabel('text-to-image'),
      canvasModeLabel('text-to-video'),
      canvasModeLabel('video-replication'),
      emailOperationLabel('grammar'),
      emailLanguageLabel('en-US'),
      createEmailBatchTemplate(),
    ]
    expect(phase3Strings[0]).not.toMatch(CJK_RE)
    expect(phase3Strings[8]).toContain('Source Email')
    for (const value of phase3Strings) {
      expect(value.trim().length).toBeGreaterThan(0)
      expect(value).not.toMatch(CJK_RE)
    }
  })
})
