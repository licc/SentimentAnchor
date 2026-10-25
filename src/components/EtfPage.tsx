import { ArrowLeft, Anchor, BookOpen, Moon, Settings2, Sun, Type } from 'lucide-react'
import type { FontSize } from '../App'
import { useState } from 'react'
import { useMarketData } from '../hooks/useMarketData'
import { clockOf } from '../lib/format'
import { EtfDesk } from './EtfDesk'
import { ActiveTradingDesk } from './ActiveTradingDesk'
import { QuantDesk } from './QuantDesk'
import { EtfDeskProvider } from '../contexts/EtfDeskContext'
import { TradingPositions } from './TradingPositions'
import { TradingEvents } from './TradingEvents'
import { ExternalSentimentBar } from './ExternalSentimentBar'
import { PreopenReviewBar } from './PreopenReviewBar'
import { SystemSettingsModal } from './SystemSettingsModal'
import { RiskCenter } from './RiskCenter'
import { Toast } from './Modals'

export function EtfPage({
  theme,
  onBack,
  onToggleTheme,
  onStealth,
  fontSize,
  onChangeFontSize,
}: {
  theme: 'light' | 'dark'
  onBack: () => void
  onToggleTheme: () => void
  onStealth: () => void
  fontSize: FontSize
  onChangeFontSize: (value: FontSize) => void
}) {
  const market = useMarketData()
  const [toast, setToast] = useState<{ message: string; tone: 'up' | 'down' } | null>(null)
  const [tab, setTab] = useState<'active' | 't0' | 'quant' | 'risk'>('t0')
  const [settingsOpen, setSettingsOpen] = useState(false)

  function showToast(message: string, tone: 'up' | 'down' = 'up') {
    setToast({ message, tone })
    window.setTimeout(() => setToast(null), 2600)
  }

  return (
    <div className="etf-page">
      <header className="etf-page-top">
        <button type="button" className="etf-page-brand" onClick={onBack} title="返回看板">
          <span className="etf-page-logo"><Anchor size={20} strokeWidth={1.8} /></span>
          <span><b>情绪锚</b><small>交易台</small></span>
        </button>
        <div className="etf-page-status">
          <span className={`etf-page-dot ${market.connected ? 'is-on' : ''}`} />
          <span>{market.snapshot?.marketStatus ?? '加载中'}</span>
          <span>{clockOf(market.now)}</span>
          <span className="etf-page-sep" />
          <span>T+0 · 量化</span>
        </div>
        <div className="etf-page-actions">
          <button type="button" onClick={onBack}><ArrowLeft size={14} /> 返回看板</button>
          <button type="button" onClick={() => { const idx = ['small', 'normal', 'large', 'xlarge'].indexOf(fontSize); onChangeFontSize((['small', 'normal', 'large', 'xlarge'] as const)[(idx + 1) % 4]) }} title={`字体大小：${fontSize === 'small' ? '小' : fontSize === 'normal' ? '标准' : fontSize === 'large' ? '大' : '特大'}`}><Type size={14} /><span className="etf-font-label">{fontSize === 'small' ? '小' : fontSize === 'normal' ? '标准' : fontSize === 'large' ? '大' : '特大'}</span></button>
          <button type="button" onClick={() => setSettingsOpen(true)} title="系统设置"><Settings2 size={14} /></button>
          <button type="button" onClick={onToggleTheme} title="切换主题">{theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}</button>
          <button type="button" onClick={onStealth} title="阅读模式"><BookOpen size={14} /></button>
        </div>
      </header>
      <main className="etf-page-main">
        <EtfDeskProvider>
        <TradingPositions />
        <div className="trading-workspace">
        <div className="trading-main">
        <ExternalSentimentBar fear={market.snapshot?.sentiment.foreignFear} />
        <PreopenReviewBar />
        <div className="trade-tabs">
          <button type="button" className={tab === 'active' ? 'is-active' : ''} onClick={() => setTab('active')}>主动交易</button>
          <button type="button" className={tab === 't0' ? 'is-active' : ''} onClick={() => setTab('t0')}>T+0 交易</button>
          <button type="button" className={tab === 'quant' ? 'is-active' : ''} onClick={() => setTab('quant')}>量化交易</button>
          <button type="button" className={tab === 'risk' ? 'is-active' : ''} onClick={() => setTab('risk')}>风控</button>
        </div>
        <div className="etf-page-intro">
          <p>{tab === 'active' ? '主动交易 · 人工下单 · 风控预检 · 隔离情绪冲动' : tab === 't0' ? 'T+0 ETF · 手动确认执行 · 真实持仓与审计' : tab === 'quant' ? 'T+1 股票量化 · 文字策略 · 独立执行引擎' : '风控 · 买入拦截 · 止损监控 · 统一券商通道'}</p>
          <div className="etf-page-intro-right"><span>执行前请确认接口模式</span></div>
        </div>
        {tab === 'active' ? <ActiveTradingDesk onToast={showToast} /> : tab === 't0' ? <EtfDesk onToast={showToast} /> : tab === 'quant' ? <QuantDesk onToast={showToast} /> : <RiskCenter onToast={showToast} />}
        </div>
        <TradingEvents />
        </div>
        </EtfDeskProvider>
      </main>
      {settingsOpen ? <SystemSettingsModal onClose={() => setSettingsOpen(false)} onToast={showToast} /> : null}
      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </div>
  )
}
