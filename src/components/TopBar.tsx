import { useEffect, useRef, useState } from 'react'
import { Anchor, Bell, BookOpen, ChevronDown, Clock3, Database, Download, KeyRound, LineChart, Moon, RefreshCw, Settings2, Star, Sun, Type, Upload, Wrench } from 'lucide-react'
import type { FontSize } from '../App'
import type { Snapshot } from '../../shared/types'
import { clockOf, timeOf } from '../lib/format'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function TopBar({
  snapshot,
  countdown,
  connected,
  now,
  refreshing,
  watchCount,
  onRefresh,
  onOpenWatchlist,
  onOpenSources,
  onOpenExport,
  onOpenImport,
  unreadAlerts,
  onOpenAlerts,
  onStealth,
  theme,
  onToggleTheme,
  onOpenAiConfig,
  onOpenEtf,
  autoStealth,
  onToggleAutoStealth,
  fontSize,
  onChangeFontSize,
  onOpenSettings,
}: {
  snapshot: Snapshot
  countdown: number
  connected: boolean
  now: Date
  refreshing: boolean
  watchCount: number
  onRefresh: () => void
  onOpenWatchlist: () => void
  onOpenSources: () => void
  onOpenExport: () => void
  onOpenImport: () => void
  unreadAlerts: number
  onOpenAlerts: () => void
  onStealth: () => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onOpenAiConfig: () => void
  onOpenEtf: () => void
  autoStealth: boolean
  onToggleAutoStealth: () => void
  fontSize: FontSize
  onChangeFontSize: (value: FontSize) => void
  onOpenSettings: () => void
}) {
  const progress = Math.max(0, Math.min(1, 1 - countdown / (snapshot.refreshMs / 1000)))
  const degraded = snapshot.sources.some((s) => s.state !== 'live')
  const liveLabel = snapshot.marketStatus === '盘中' ? '10s LIVE' : snapshot.marketStatus === '已收盘' ? 'SNAPSHOT' : '10s ENGINE'
  const [toolsOpen, setToolsOpen] = useState(false)
  const toolsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!toolsOpen) return
    const close = (event: MouseEvent) => {
      if (!toolsRef.current?.contains(event.target as Node)) setToolsOpen(false)
    }
    const esc = (event: KeyboardEvent) => { if (event.key === 'Escape') setToolsOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [toolsOpen])
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            <Anchor size={22} strokeWidth={1.8} />
          </div>
          <div className="brand-copy">
            <div className="brand-title">
              情绪锚<span>Sentiment Anchor</span>
            </div>
            <div className="brand-sub">A股实时监控台 · 周期与辨识度</div>
          </div>
        </div>

        <div className="topbar-center">
          <div className={`live-pill ${connected ? 'is-live' : 'is-offline'}`}>
            <span className="live-dot" />
            <span>{connected ? liveLabel : 'RECONNECTING'}</span>
          </div>
          <div className="topbar-meta">
            <span className="mono">{snapshot.tradingDate}</span>
            <span className="meta-divider" />
            <Clock3 size={13} />
            <span className="mono">{clockOf(now)}</span>
            <span className={`market-state ${snapshot.marketStatus === '盘中' ? 'is-open' : ''}`}>
              {snapshot.marketStatus}
            </span>
          </div>
          <div className={`data-quality ${degraded ? 'is-degraded' : ''}`} title={degraded ? '部分数据源使用缓存/降级，点“数据源”查看明细' : '所有数据源状态正常'}>
            <span />
            {degraded ? '数据降级' : '数据正常'}
          </div>
          <div className="data-freshness">
            {snapshot.marketStatus === '盘中' ? '盘中数据' : '上一交易日定格'} {snapshot.tradingDate} {timeOf(snapshot.dataAsOf)} · 采集 {snapshot.latencyMs}ms
          </div>
        </div>

        <div className="topbar-actions">
          <div
            className="countdown"
            style={{ '--progress': `${progress * 360}deg` } as React.CSSProperties}
            title={`下次刷新 ${countdown}s`}
          >
            <div className={`countdown-inner ${snapshot.marketStatus !== '盘中' ? 'is-closed' : ''}`}>
              {snapshot.marketStatus === '盘中' ? (
                <>
                  <span className="mono">{countdown}</span>
                  <small>s</small>
                </>
              ) : (
                <span className="countdown-closed">{snapshot.marketStatus === '已收盘' ? '收盘' : snapshot.marketStatus}</span>
              )}
            </div>
          </div>
          <button type="button" className="top-btn" onClick={onOpenEtf} title="打开交易台">
            <LineChart size={15} />
            <span>交易</span>
          </button>
          <button type="button" className={`top-btn top-btn-bell ${unreadAlerts ? 'has-alert' : ''}`} onClick={onOpenAlerts} title="预警中心">
            <Bell size={15} />
            <span>预警</span>
            {unreadAlerts > 0 ? <em>{unreadAlerts > 99 ? '99+' : unreadAlerts}</em> : null}
          </button>
          <button type="button" className="top-btn top-btn-theme" onClick={onToggleTheme} title={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}>
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button type="button" className="top-btn" onClick={onStealth} title={isMac ? '阅读模式（⌥⇧M 或 ⌘⇧M）' : '阅读模式（Alt+Shift+M）'}>
            <BookOpen size={15} />
            <span>阅读</span>
            <kbd className="top-kbd">{isMac ? '⌥⇧M' : 'Alt+Shift+M'}</kbd>
          </button>
          <div className="tool-wrap" ref={toolsRef}>
            <button
              type="button"
              className={`top-btn ${toolsOpen ? 'is-open' : ''}`}
              onClick={() => setToolsOpen((v) => !v)}
              title="工具"
              aria-expanded={toolsOpen}
            >
              <Wrench size={15} />
              <span>工具</span>
              <ChevronDown size={11} className={toolsOpen ? 'is-up' : ''} />
            </button>
            {toolsOpen ? (
              <div className="tool-menu">
                <button type="button" onClick={() => { setToolsOpen(false); onOpenSettings() }}>
                  <Settings2 size={14} /><span><b>系统设置</b><small>接口 / 上限 / 密钥</small></span>
                </button>
                <button type="button" onClick={() => { setToolsOpen(false); onOpenAiConfig() }}>
                  <KeyRound size={14} /><span><b>AI 设置</b><small>Key / 模型</small></span>
                </button>
                <button type="button" role="menuitemcheckbox" aria-checked={autoStealth} onClick={onToggleAutoStealth}>
                  <Clock3 size={14} /><span><b>无操作自动阅读</b><small>40 秒无鼠标/键盘操作</small></span>
                  <em className={`tool-switch ${autoStealth ? 'is-on' : ''}`} aria-hidden="true"><i /></em>
                </button>
                <div className="tool-font-size">
                  <Type size={13} />
                  <span><b>字体大小</b><small>界面整体缩放</small></span>
                  <div className="tool-font-options">
                    {([['small', '小'], ['normal', '标准'], ['large', '大'], ['xlarge', '特大']] as const).map(([value, label]) => (
                      <button type="button" key={value} className={fontSize === value ? 'is-active' : ''} onClick={() => onChangeFontSize(value)}>{label}</button>
                    ))}
                  </div>
                </div>
                <button type="button" onClick={() => { setToolsOpen(false); onOpenImport() }}>
                  <Upload size={14} /><span><b>导入配置</b><small>自选 JSON</small></span>
                </button>
                <button type="button" onClick={() => { setToolsOpen(false); onOpenExport() }}>
                  <Download size={14} /><span><b>导出复盘</b><small>快照 / CSV</small></span>
                </button>
                <button type="button" onClick={() => { setToolsOpen(false); onOpenSources() }}>
                  <Database size={14} /><span><b>数据源状态</b><small>延迟与降级</small></span>
                </button>
              </div>
            ) : null}
          </div>
          <button type="button" className="top-btn" onClick={onOpenWatchlist} title="自定义锚定池">
            <Star size={15} />
            <span>自选池</span>
            {watchCount > 0 ? <em>{watchCount}</em> : null}
          </button>
          <button
            type="button"
            className={`top-btn top-btn-primary ${refreshing ? 'is-busy' : ''}`}
            onClick={onRefresh}
            disabled={refreshing}
            title="立即刷新"
          >
            <RefreshCw size={15} className={refreshing ? 'spin' : ''} />
            <span>{refreshing ? '同步中' : '刷新'}</span>
          </button>
        </div>
      </div>
    </header>
  )
}
