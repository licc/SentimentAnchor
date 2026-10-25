import { Anchor, RefreshCw } from 'lucide-react'
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Snapshot, Stock } from '../shared/types'
import { getAuth, logout, saveWatchCodes, saveWatchlist } from './api'
import { AiPanel } from './components/AiPanel'
// ETF 交易台是独立大页面（含 EtfDesk 等约 50KB 组件），只有点「交易」才需要，
// 改为动态引入，避免打进首屏主包。
const EtfPage = lazy(() => import('./components/EtfPage').then((m) => ({ default: m.EtfPage })))
import { CalendarPanel } from './components/CalendarPanel'
import { AnchorGrid } from './components/AnchorGrid'
import { Hero } from './components/Hero'
import { IndexStrip, DateBar, PhaseRail } from './components/MarketRibbon'
import { Notebook } from './components/Notebook'
import { Recognition } from './components/Recognition'
import { Rules } from './components/Rules'
import { SentimentLab } from './components/SentimentLab'
import { GlobalFearCard } from './components/GlobalFearCard'
import { StockDrawer } from './components/StockDrawer'
import { TopBar } from './components/TopBar'
import { WatchlistModal, SourcesModal, Toast } from './components/Modals'
import { ExportModal, ImportModal } from './components/ExportModals'
import { AlertsModal, notifyBrowser } from './components/AlertsModal'
import { AiConfigModal } from './components/AiConfigModal'
import { SystemSettingsModal } from './components/SystemSettingsModal'
import { useMarketData } from './hooks/useMarketData'
import { useAiInsight } from './hooks/useAiInsight'
import { useCalendar } from './hooks/useCalendar'
import { useAlerts } from './hooks/useAlerts'
import { fmtCount, timeOf } from './lib/format'
import { LoginScreen } from './components/LoginScreen'
import { StealthView } from './components/StealthView'
import { installFontScale } from './lib/font-scale'

// 对「纯数据 props」的区块做浅比较缓存：打开弹窗/抽屉、切换自选等交互时
// 不必重渲染这些大区块（它们只在快照变化时才需要更新）。
const MemoHero = memo(Hero)
const MemoRules = memo(Rules)
const MemoIndexStrip = memo(IndexStrip)
const MemoPhaseRail = memo(PhaseRail)
const MemoNotebook = memo(Notebook)
// 纯数据 + 稳定回调的区块：只在快照/自选变化时更新。
const MemoAnchorGrid = memo(AnchorGrid)
const MemoRecognition = memo(Recognition)
const MemoCalendarPanel = memo(CalendarPanel)
export type FontSize = 'small' | 'normal' | 'large' | 'xlarge'
const FONT_SIZE_KEY = 'anchor-font-size'
const FONT_SIZES: FontSize[] = ['small', 'normal', 'large', 'xlarge']

type ModalKind = 'watchlist' | 'sources' | 'export' | 'import' | 'alerts' | 'ai-config' | 'settings' | null

export default function App() {
  const [auth, setAuth] = useState<{ required: boolean; authed: boolean } | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [stealth, setStealth] = useState(() => window.location.pathname === '/docs' || window.location.pathname === '/docs/')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('anchor-theme')
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [autoStealth, setAutoStealth] = useState(() => localStorage.getItem('anchor-auto-stealth') !== 'off')
  const [fontSize, setFontSize] = useState<FontSize>(() => {
    const saved = localStorage.getItem(FONT_SIZE_KEY) as FontSize | null
    return saved && FONT_SIZES.includes(saved) ? saved : 'normal'
  })
  const [etfPage, setEtfPage] = useState(() => window.location.pathname === '/jyt' || window.location.pathname === '/jyt/' || window.location.pathname === '/etf' || window.location.pathname === '/etf/')
  const [stealthTheme, setStealthTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('stealth-theme')
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  // 页面不可见（切标签页 / 最小化）时暂停所有 CSS 动画：
  // livePulse（box-shadow）、bars、aiScan 等都是无限动画，后台仍会持续重绘。
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.anim = document.visibilityState === 'hidden' ? 'off' : 'on'
    }
    apply()
    document.addEventListener('visibilitychange', apply)
    return () => document.removeEventListener('visibilitychange', apply)
  }, [])

  useEffect(() => {
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
    const onKey = (event: KeyboardEvent) => {
      const modifier = event.altKey || (isMac && event.metaKey)
      if (modifier && event.shiftKey && event.code === 'KeyM') {
        event.preventDefault()
        setStealth((value) => !value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    localStorage.setItem(FONT_SIZE_KEY, fontSize)
    const frame = requestAnimationFrame(() => installFontScale(fontSize))
    return () => cancelAnimationFrame(frame)
  }, [fontSize, etfPage, auth])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('anchor-theme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('stealth-theme', stealthTheme)
  }, [stealthTheme])

  useEffect(() => {
    localStorage.setItem('anchor-auto-stealth', autoStealth ? 'on' : 'off')
  }, [autoStealth])

  useEffect(() => {
    const title = stealth ? 'Q4 增长项目 · 周报' : etfPage ? '情绪锚 · 交易台' : '情绪锚 · A股实时监控台'
    document.title = title
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (icon) {
      icon.href = stealth
        ? 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 64 64%27%3E%3Crect width=%2764%27 height=%2764%27 rx=%2712%27 fill=%27%232f6fed%27/%3E%3Cpath d=%27M20 16h17l7 7v25H20z%27 fill=%27none%27 stroke=%27white%27 stroke-width=%273%27 stroke-linejoin=%27round%27/%3E%3Cpath d=%27M37 16v8h8M26 31h12M26 38h12%27 stroke=%27white%27 stroke-width=%273%27 stroke-linecap=%27round%27/%3E%3C/svg%3E'
        : 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 64 64%27%3E%3Crect width=%2764%27 height=%2764%27 rx=%2713%27 fill=%27%2311171b%27/%3E%3Cpath d=%27M32 13v24M24 20h16M20 42c2-8 6-11 12-11s10 3 12 11M26 37l6 8 6-8%27 fill=%27none%27 stroke=%27%23e8d8b7%27 stroke-width=%273%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E'
    }
    const target = stealth ? '/docs' : etfPage ? '/jyt' : '/'
    if (etfPage && (window.location.pathname === '/etf' || window.location.pathname === '/etf/')) window.history.replaceState({}, '', '/jyt')
    if (window.location.pathname !== target) window.history.replaceState({}, '', target)
  }, [stealth, etfPage])

  useEffect(() => {
    const onPop = () => {
      setStealth(window.location.pathname === '/docs' || window.location.pathname === '/docs/')
      setEtfPage(window.location.pathname === '/jyt' || window.location.pathname === '/jyt/' || window.location.pathname === '/etf' || window.location.pathname === '/etf/')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    getAuth()
      .then(setAuth)
      .catch((err) => setAuthError(err instanceof Error ? err.message : '鉴权检查失败'))
  }, [])

  if (stealth) return <StealthView onExit={() => setStealth(false)} theme={stealthTheme} onToggleTheme={() => setStealthTheme((t) => (t === 'dark' ? 'light' : 'dark'))} />
  if (authError) return <ErrorScreen message={authError} onRetry={() => window.location.reload()} />
  if (!auth) return <LoadingScreen />
  if (auth.required && !auth.authed) {
    return <LoginScreen onSuccess={() => setAuth({ required: true, authed: true })} />
  }
  if (etfPage) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <EtfPage
          theme={theme}
          onBack={() => { window.history.pushState({}, '', '/'); setEtfPage(false) }}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          onStealth={() => setStealth(true)}
          fontSize={fontSize}
          onChangeFontSize={setFontSize}
        />
      </Suspense>
    )
  }
  return (
    <Dashboard
      authRequired={auth.required}
      onLogout={() => {
        void logout().finally(() => window.location.reload())
      }}
      onStealth={() => setStealth(true)}
      theme={theme}
      onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      autoStealth={autoStealth}
      onToggleAutoStealth={() => setAutoStealth((v) => !v)}
      onOpenEtf={() => { window.history.pushState({}, '', '/jyt'); setEtfPage(true) }}
      fontSize={fontSize}
      onChangeFontSize={setFontSize}
    />
  )
}

function Dashboard({ authRequired, onLogout, onStealth, theme, onToggleTheme, autoStealth, onToggleAutoStealth, onOpenEtf, fontSize, onChangeFontSize }: { authRequired: boolean; onLogout: () => void; onStealth: () => void; theme: 'light' | 'dark'; onToggleTheme: () => void; autoStealth: boolean; onToggleAutoStealth: () => void; onOpenEtf: () => void; fontSize: FontSize; onChangeFontSize: (value: FontSize) => void }) {
  const { snapshot, connected, loading, error, refreshing, appliedAt, refresh, alertEvents } = useMarketData()
  const ai = useAiInsight(snapshot)
  const calendar = useCalendar()
  const alerts = useAlerts()
  const lastAlert = useRef('')
  const [watchCodes, setWatchCodes] = useState<string[]>([])
  const [modal, setModal] = useState<ModalKind>(null)
  const [drawer, setDrawer] = useState<{ stock: Stock; role?: string } | null>(null)
  const [toast, setToast] = useState<{ message: string; tone: 'up' | 'down' } | null>(null)
  const [view, setView] = useState<'decision' | 'pro'>(() => (localStorage.getItem('anchor-view') === 'pro' ? 'pro' : 'decision'))

  useEffect(() => {
    if (!autoStealth) return
    let timer = window.setTimeout(onStealth, 40_000)
    const reset = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(onStealth, 40_000)
    }
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart']
    events.forEach((name) => window.addEventListener(name, reset, { passive: true }))
    return () => {
      window.clearTimeout(timer)
      events.forEach((name) => window.removeEventListener(name, reset))
    }
  }, [autoStealth, onStealth])

  useEffect(() => {
    localStorage.setItem('anchor-view', view)
  }, [view])

  useEffect(() => {
    if (!snapshot) return
    setWatchCodes(snapshot.watchlist.map((s) => s.code))
  }, [snapshot?.version, snapshot?.watchlist])

  const showToast = useCallback((message: string, tone: 'up' | 'down' = 'up') => {
    setToast({ message, tone })
    window.setTimeout(() => setToast(null), 2800)
  }, [])

  useEffect(() => {
    const latest = alertEvents[alertEvents.length - 1]
    if (!latest || lastAlert.current === latest.id) return
    lastAlert.current = latest.id
    alerts.ingest(latest)
    notifyBrowser(latest)
    showToast(`${latest.title} · ${latest.detail}`, latest.level === 'risk' ? 'down' : 'up')
  }, [alertEvents, alerts, showToast])

  const toggleWatch = useCallback(
    async (stock: Stock) => {
      if (!snapshot) return
      const exists = watchCodes.includes(stock.code)
      const next = exists ? watchCodes.filter((c) => c !== stock.code) : [...watchCodes, stock.code]
      setWatchCodes(next)
      try {
        const cfg = await saveWatchlist(stock.code, exists ? 'remove' : 'add')
        setWatchCodes(cfg.codes)
        showToast(exists ? `已移出自选：${stock.name}` : `已加入自选：${stock.name}`)
      } catch (err) {
        setWatchCodes(watchCodes)
        showToast(err instanceof Error ? err.message : '自选更新失败', 'down')
      }
    },
    [snapshot, watchCodes, showToast],
  )

  // 稳定引用：AnchorGrid / Recognition 用 memo 缓存；内联箭头函数每次渲染都是新函数，
  // 会让缓存失效（打开抽屉、切弹窗时本来不需要重渲染这两个大区块）。
  const handleToggleWatch = useCallback((stock: Stock) => void toggleWatch(stock), [toggleWatch])
  const handleOpenStock = useCallback((stock: Stock, role?: string) => setDrawer({ stock, role }), [])
  const handleOpenWatchlist = useCallback(() => setModal('watchlist'), [])

  const addCode = useCallback(
    async (code: string) => {
      const cfg = await saveWatchlist(code, 'add')
      setWatchCodes(cfg.codes)
      showToast(`已加入自选：${code}，10s 内同步行情`)
    },
    [showToast],
  )

  const importCodes = useCallback(
    async (codes: string[]) => {
      const cfg = await saveWatchCodes(codes)
      setWatchCodes(cfg.codes)
      showToast(`已导入 ${cfg.codes.length} 只自选`)
    },
    [showToast],
  )

  const removeStock = useCallback(
    async (stock: Stock) => {
      try {
        const cfg = await saveWatchlist(stock.code, 'remove')
        setWatchCodes(cfg.codes)
        showToast(`已移出自选：${stock.name}`)
      } catch (err) {
        showToast(err instanceof Error ? err.message : '移除失败', 'down')
      }
    },
    [showToast],
  )

  const currentDrawerStock = useMemo(() => {
    if (!snapshot || !drawer) return null
    const all = [
      ...snapshot.anchors.map((a) => a.stock),
      ...snapshot.leaders,
      ...snapshot.laggards,
      ...snapshot.limitUps,
      ...snapshot.limitDowns,
      ...snapshot.watchlist,
    ]
    return all.find((s) => s.code === drawer.stock.code) ?? drawer.stock
  }, [snapshot, drawer])

  if (loading && !snapshot) return <LoadingScreen />
  if (!snapshot) return <ErrorScreen message={error} onRetry={refresh} />

  return (
    <div className="app-shell">
      <TopBar
        snapshot={snapshot}

        connected={connected}
        appliedAt={appliedAt}
        refreshing={refreshing}
        watchCount={watchCodes.length}
        onRefresh={refresh}
        onOpenWatchlist={handleOpenWatchlist}
        onOpenSources={() => setModal('sources')}
        onOpenExport={() => setModal('export')}
        onOpenImport={() => setModal('import')}
        unreadAlerts={alerts.payload?.unread ?? 0}
        onOpenAlerts={() => setModal('alerts')}
        onStealth={onStealth}
        theme={theme}
        onToggleTheme={onToggleTheme}
        autoStealth={autoStealth}
        onToggleAutoStealth={onToggleAutoStealth}
        onOpenAiConfig={() => setModal('ai-config')}
        onOpenEtf={onOpenEtf}
        onOpenSettings={() => setModal('settings')}
        fontSize={fontSize}
        onChangeFontSize={onChangeFontSize}
      />
      <main className="page">
        <DateBar snapshot={snapshot} view={view} onViewChange={setView} />
        {snapshot.notice ? (
          <div className="notice-bar">
            <span className="notice-dot" />
            <span>{snapshot.notice}</span>
            <button type="button" onClick={() => setModal('sources')}>查看数据源</button>
          </div>
        ) : null}
        <MemoPhaseRail phases={snapshot.phases} active={snapshot.phase} />
        <MemoIndexStrip indices={snapshot.indices} />
        <GlobalFearCard snapshot={snapshot} />
        <MemoHero snapshot={snapshot} />
        <AiPanel
          insight={ai.insight}
          loading={ai.loading}
          generating={ai.generating}
          llmConfigured={ai.llmConfigured}
          error={ai.error}
          onRefresh={() => {
            void ai.generate('local').then((res) => {
              if (res?.llmError) showToast(res.llmError, 'down')
              else showToast('AI 研判已刷新')
            })
          }}
          onDeep={() => {
            void ai.generate('llm').then((res) => {
              if (res?.llmError) showToast(res.llmError, 'down')
              else showToast('LLM 深度研判已更新')
            })
          }}
        />
        <MemoAnchorGrid
          anchors={snapshot.anchors}
          watchlist={snapshot.watchlist}
          watchCodes={watchCodes}
          onToggleWatch={handleToggleWatch}
          onOpenStock={handleOpenStock}
          onOpenWatchlist={handleOpenWatchlist}
        />
        {view === 'pro' ? <SentimentLab snapshot={snapshot} /> : null}
        <MemoNotebook logs={snapshot.logs} themes={snapshot.themes} sectors={snapshot.sectors} />
        <MemoRecognition
          snapshot={snapshot}
          watchCodes={watchCodes}
          onToggleWatch={handleToggleWatch}
          onOpenStock={handleOpenStock}
        />
        <MemoRules snapshot={snapshot} />
        {view === 'pro' ? <MemoCalendarPanel data={calendar.data} loading={calendar.loading} error={calendar.error} /> : null}
        <Footer snapshot={snapshot} />
      </main>

      {currentDrawerStock ? (
        <StockDrawer
          stock={currentDrawerStock}
          role={drawer?.role}
          watched={watchCodes.includes(currentDrawerStock.code)}
          onClose={() => setDrawer(null)}
          onToggle={() => void toggleWatch(currentDrawerStock)}
        />
      ) : null}
      {modal === 'watchlist' ? (
        <WatchlistModal
          snapshot={snapshot}
          watchlist={snapshot.watchlist}
          onAdd={addCode}
          onRemove={removeStock}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal === 'sources' ? (
        <SourcesModal snapshot={snapshot} onClose={() => setModal(null)} authRequired={authRequired} onLogout={onLogout} />
      ) : null}
      {modal === 'export' ? <ExportModal snapshot={snapshot} calendar={calendar.data} onClose={() => setModal(null)} /> : null}
      {modal === 'import' ? <ImportModal onImport={importCodes} onClose={() => setModal(null)} /> : null}
      {modal === 'settings' ? <SystemSettingsModal onClose={() => setModal(null)} onToast={showToast} /> : null}
      {modal === 'ai-config' ? (
        <AiConfigModal
          onClose={() => setModal(null)}
          onSaved={() => {
            void ai.refresh()
            showToast('AI 配置已更新')
          }}
        />
      ) : null}
      {modal === 'alerts' ? (
        <AlertsModal
          payload={alerts.payload}
          onClose={() => setModal(null)}
          onSave={alerts.saveConfig}
          onRead={alerts.markRead}
          onRefresh={alerts.refresh}
        />
      ) : null}
      <div className="toast-layer">{toast ? <Toast message={toast.message} tone={toast.tone} /> : null}</div>
    </div>
  )
}

function Footer({ snapshot }: { snapshot: Snapshot }) {
  return (
    <footer className="site-footer">
      <div className="footer-brand">
        <span className="footer-mark"><Anchor size={14} /></span>
        <div>
          <b>情绪锚 · Sentiment Anchor</b>
          <p>A股实时监控台 · 数据到展示全链路 · 10s 刷新</p>
        </div>
      </div>
      <div className="footer-mid">
        <span>数据源：选股宝 / 新浪财经 / 东方财富 / 同花顺</span>
        <span>·</span>
        <span>快照 {timeOf(snapshot.generatedAt)}</span>
        <span>·</span>
        <span>全市场 {fmtCount(snapshot.breadth.total)} 只</span>
      </div>
      <p className="footer-disclaimer">
        本平台为行情研究工具，不构成投资建议。数据可能延迟或存在口径差异，请以交易所及券商终端为准。
      </p>
    </footer>
  )
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-mark"><Anchor size={26} /></div>
      <h1>情绪锚</h1>
      <p>正在接通全市场行情与涨停池…</p>
      <div className="loading-bars">
        <span /><span /><span /><span /><span />
      </div>
      <div className="loading-note">10s 刷新 · 全链路数据校准</div>
    </div>
  )
}

function ErrorScreen({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div className="loading-screen">
      <div className="loading-mark is-error"><Anchor size={26} /></div>
      <h1>行情接通失败</h1>
      <p>{message ?? '服务端尚未准备好，请稍后重试。'}</p>
      <button type="button" className="btn-primary" onClick={onRetry}>
        <RefreshCw size={14} /> 重新接通
      </button>
      <div className="loading-note">若持续失败，请运行 pnpm dev:server 检查数据源状态</div>
    </div>
  )
}
