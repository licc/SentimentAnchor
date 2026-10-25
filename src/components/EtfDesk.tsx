import { Activity, ClipboardList, History, Pause, Play, RefreshCw, Settings2, ShieldAlert, ShieldCheck, Trash2, Zap } from 'lucide-react'
import { useState } from 'react'
import type { EtfDeskPayload, EtfSignal } from '../../shared/types'
import { fmtAmount, fmtMoney, fmtPct, fmtSigned, timeOf } from '../lib/format'
import { enrichTradePnl } from '../lib/trade-pnl'
import { useEtfDeskContext } from '../contexts/EtfDeskContext'
import { refreshEtfSelection } from '../api'
import { EtfConfigModal } from './EtfConfigModal'
import { EtfHistoryModal } from './EtfHistoryModal'
import { EtfLiveModal } from './EtfLiveModal'
import { EtfExecutionModal } from './EtfExecutionModal'
import { useEtfAuto } from '../hooks/useEtfAuto'
import { useEtfExecutions } from '../hooks/useEtfExecutions'
import { EtfAutoSettingsModal } from './EtfAutoSettingsModal'
import { EtfStrategyModal } from './EtfStrategyModal'
import { T0StrategyLibraryModal } from './T0StrategyLibraryModal'
import { SectionHeader, Tag } from './ui'
import { TradingSectionHeader, TradingTable } from './trading-ui'

function regimeMeta(regime: EtfSignal['regime']) {
  if (regime === 'risk-on') return { label: '进攻', tone: 'up' as const, detail: '风险偏好回升' }
  if (regime === 'risk-off') return { label: '防守', tone: 'down' as const, detail: '风险偏好收缩' }
  return { label: '观望', tone: 'flat' as const, detail: '等待情绪确认' }
}

export function EtfDesk({ onToast }: { onToast: (message: string, tone?: 'up' | 'down') => void }) {
  const { data, loading, error, refresh } = useEtfDeskContext()
  const [configOpen, setConfigOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [liveOpen, setLiveOpen] = useState(false)
  const [executionsOpen, setExecutionsOpen] = useState(false)
  const [autoSettingsOpen, setAutoSettingsOpen] = useState(false)
  const [strategyOpen, setStrategyOpen] = useState(false)
  const [t0LibraryOpen, setT0LibraryOpen] = useState(false)
  const [selecting, setSelecting] = useState(false)

  const auto = useEtfAuto()
  const executions = useEtfExecutions(200)

  if (loading && !data) {
    return (
      <section id="etf" className="etf-section">
        <SectionHeader index="ETF" title="T+0 ETF 情绪套利台" subtitle="只读连接；dry_run 不发送委托，也不提供模拟账户" />
        <div className="etf-loading">正在连接交易接口并读取 T+0 ETF 行情…</div>
      </section>
    )
  }

  if (!data) {
    return (
      <section id="etf" className="etf-section">
        <SectionHeader index="ETF" title="T+0 ETF 情绪套利台" subtitle="只读连接；dry_run 不发送委托，也不提供模拟账户" />
        <div className="etf-error">
          <span>{error ?? '策略台暂不可用'}</span>
          <button type="button" onClick={() => void refresh(true)}>重试</button>
        </div>
      </section>
    )
  }

  const { broker, signal, quotes, universe } = data
  const meta = regimeMeta(signal.regime)
  const target = quotes.find((q) => q.code === signal.targetCode)
  const account = broker.account
  const live = broker.mode === 'live' && broker.ok
  const realPositions = broker.positions
  const todayTrades = data.today.trades
  const tradePnl = enrichTradePnl(todayTrades)
  const executionByOrder = new Map<string, (typeof executions)[number]>()
  for (const ex of executions) {
    if (ex.orderId) executionByOrder.set(ex.orderId, ex)
  }
  const tradeRows = tradePnl.rows.map((t) => {
    const order = /\b(\d{4,})\b/.exec(t.id)?.[1] ?? /·\s*(\d{4,})(?:\s*·|$)/.exec(t.note)?.[1]
    const ex = order ? executionByOrder.get(order) : undefined
    return {
      ...t,
      entryPrice: t.side === 'sell' ? (ex?.entryPrice ?? t.entryPrice) : t.entryPrice,
      realizedPnl: ex?.realizedPnl ?? t.realizedPnl,
      realizedPnlPct: ex?.realizedPnlPct ?? t.realizedPnlPct,
      reason: ex?.factors.note ?? t.note,
    }
  })
  const tradeStats = {
    realizedPnl: Math.round(tradeRows.reduce((sum, t) => sum + (t.realizedPnl ?? 0), 0) * 100) / 100,
    fees: Math.round(tradeRows.reduce((sum, t) => sum + (t.fee ?? 0), 0) * 100) / 100,
    count: tradeRows.length,
    wins: tradeRows.filter((t) => (t.realizedPnl ?? 0) > 0).length,
    losses: tradeRows.filter((t) => (t.realizedPnl ?? 0) < 0).length,
    winRate: (() => { const sells = tradeRows.filter((t) => t.realizedPnl != null); return sells.length ? (sells.filter((t) => (t.realizedPnl ?? 0) > 0).length / sells.length) * 100 : 0 })(),
  }
  const feeNotional = Math.min(5000, (account?.totalAsset ?? 10_000) * 0.5)
  const feePrice = quotes[0]?.price || 3.87
  const feeCommission = Math.max(data.fees.minCommission, feeNotional * data.fees.commissionRate)
  const roundTripFee = feeCommission * 2 + (0.001 / feePrice) * feeNotional * 2 + (data.fees.slippageBps / 10_000) * feeNotional * 2
  const roundTripPct = feeNotional ? (roundTripFee / feeNotional) * 100 : 0
  const todayBuy = todayTrades.filter((t) => t.side === 'buy').reduce((sum, t) => sum + t.amount, 0)
  const todaySell = todayTrades.filter((t) => t.side === 'sell').reduce((sum, t) => sum + t.amount, 0)

  return (
    <section id="etf" className="etf-section">
      <SectionHeader
        index="ETF"
        title="T+0 ETF 情绪套利台"
        subtitle={live ? '情绪状态 → T+0 ETF 轮动 · 手动确认 · 实盘受控' : '情绪状态 → T+0 ETF 轮动 · 只读接口 · 不产生模拟账户'}
        right={
          <div className="etf-head-actions">
            <span className={`etf-link-state ${broker.ok ? 'is-on' : 'is-off'}`}>
              <i /> {broker.ok ? '交易接口在线' : '交易接口离线'}
            </span>
            <Tag tone={broker.mode === 'live' ? 'up' : 'warn'}>{broker.mode === 'live' ? 'LIVE' : 'DRY RUN'}</Tag>
            <button type="button" className="etf-pool-btn" onClick={() => setExecutionsOpen(true)} title="执行记录"><ClipboardList size={13} /> 执行记录</button>
            <button type="button" className="etf-pool-btn" onClick={() => setHistoryOpen(true)} title="每日记录"><History size={13} /> 记录</button>
            <button type="button" className="etf-pool-btn" disabled={['running','waiting','recovering'].includes(auto.state?.status ?? '')} onClick={() => setConfigOpen(true)} title="设置 ETF 池"><Settings2 size={13} /> ETF 池</button>
            <button type="button" className="etf-icon-btn" onClick={() => void refresh(true)} title="刷新"><RefreshCw size={13} /></button>
          </div>
        }
      />

      <div className="etf-selection-bar">
        <div className="etf-selection-copy">
          <span>系统选池 · {data.selection.date}</span>
          <b>{data.selection.source}</b>
        </div>
        <div className="etf-selection-items">
          {data.selection.items.map((item) => (
            <span key={item.code} title={item.reason}>
              <b>{item.code}</b> {item.name} <em>{item.score.toFixed(1)}</em>
            </span>
          ))}
        </div>
        <button type="button" className="etf-pool-btn" disabled={selecting || ['running','waiting','recovering'].includes(auto.state?.status ?? '')} onClick={() => {
          setSelecting(true)
          void refreshEtfSelection()
            .then(() => { onToast('系统已重新选池'); return refresh() })
            .catch((err) => onToast(err instanceof Error ? err.message : '选池失败', 'down'))
            .finally(() => setSelecting(false))
        }}><RefreshCw size={12} className={selecting ? 'spin' : ''} /> 重新选池</button>
      </div>

      <div className={`etf-live-banner ${live ? 'is-live' : 'is-dry'}`}>
        <div className="etf-live-guide">
          <span className="etf-live-kicker">今日实战</span>
          <b>{live ? '接口 LIVE，可手动下单' : `接口 ${broker.mode}，当前无法下单`}</b>
          <p>{live ? '信号确认后进入实战下单；每一步都需要你手动确认，不会自动交易。' : '先在交易客户端切到 live 并登录，再回来刷新；dry_run 下不会发送真实委托。'}</p>
          <div className="etf-steps"><span>① 接口就绪</span><span>② 看信号</span><span>③ 手动下单</span><span>④ 收盘记录</span></div>
        </div>
        <div className="etf-live-cta">
          <button type="button" disabled={!live} onClick={() => setLiveOpen(true)}>{live ? '进入实战下单' : '实盘未开启'}</button>
          <small>{live ? `单笔上限 ¥${fmtMoney(Math.min(data.maxManualOrderAmount ?? 50_000, (account?.totalAsset ?? 0) * 0.7))}（70% 硬顶）· 可用 ¥${fmtMoney(account?.cashAvailable ?? 0)}` : '接口当前不是 live'}</small>
        </div>
      </div>

      <div className={`etf-auto-panel ${auto.state?.status ?? 'idle'}`}>
        <div className="etf-auto-head">
          <span className="etf-auto-kicker"><ShieldCheck size={11} /> 自动执行</span>
          <b>{auto.state?.status === 'running' ? '运行中' : auto.state?.status === 'waiting' ? '等待接口' : auto.state?.status === 'recovering' ? '核对委托' : auto.state?.status === 'error' ? '异常暂停' : auto.state?.status === 'paused' ? '已暂停' : '未启动'}</b>
          <p>{auto.state?.lastAction ?? '尚未启动自动执行'}{auto.state?.lastError ? ` · ${auto.state.lastError}` : ''}</p>
        </div>
        <div className="etf-auto-actions">
          {['running','waiting','recovering'].includes(auto.state?.status ?? '') ? (
            <button type="button" className="etf-auto-pause" disabled={auto.busy} onClick={() => void auto.run('pause').then(() => onToast('自动执行已暂停'))}><Pause size={12} /> 暂停</button>
          ) : (
            <button type="button" className="etf-auto-start" disabled={!live || auto.busy} onClick={() => {
              if (!window.confirm('启动后将按情绪策略自动发送实盘委托，接口必须是 LIVE。确认启动？')) return
              void auto.run('start').then(() => onToast('自动执行已启动')).catch((err) => onToast(err instanceof Error ? err.message : '启动失败', 'down'))
            }}><Play size={12} /> 开始自动</button>
          )}
          <button type="button" className="etf-auto-flatten" onClick={() => setT0LibraryOpen(true)}>T+0 策略库</button>
          <button type="button" className="etf-auto-flatten" onClick={() => setStrategyOpen(true)}>交易策略</button>
          <button type="button" className="etf-auto-flatten" onClick={() => setAutoSettingsOpen(true)}>自动参数</button>
          <button type="button" className="etf-auto-flatten" disabled={!live || auto.busy} onClick={() => {
            if (!window.confirm('全部清仓会先撤销所有可撤委托，再卖出当前 ETF 持仓。确认？')) return
            void auto.run('flatten').then(() => onToast('清仓指令已提交')).catch((err) => onToast(err instanceof Error ? err.message : '清仓失败', 'down'))
          }}><Trash2 size={12} /> 全部清仓</button>
        </div>
        <div className="etf-auto-meta">
          <span>目标 {auto.state?.target ?? '—'}</span>
          <span>信号确认 {auto.state?.confirmCount ?? 0}/2</span>
          <span>委托核对重试 {auto.state?.retryCount ?? 0}</span>
          <span>上次 {auto.state?.lastTick ? timeOf(auto.state.lastTick) : '—'}</span>
          <span>下次核对 {auto.state?.nextRetryAt ? timeOf(auto.state.nextRetryAt) : '—'}</span>
          {auto.state?.lastError || auto.state?.pendingOrderId ? <span className="etf-auto-warn"><ShieldAlert size={10} /> {auto.state?.lastError ?? `待核对委托 ${auto.state.pendingOrderId}；只监控不补单`}</span> : <span className="etf-auto-ok">接口正常 · 无待核对委托</span>}
          <span>重试 {auto.state?.retryCount ?? 0} 次</span>
          <span>重启自动恢复</span>
          {auto.state?.pendingOrderId ? <button type="button" className="etf-auto-link" onClick={() => setExecutionsOpen(true)}>待核对 {auto.state.pendingOrderId} · 查看执行记录</button> : null}
        </div>
      </div>

      <div className="etf-today-strip">
        <div><span>今日已实现</span><b className={tradeStats.realizedPnl >= 0 ? 'up' : 'down'}>{fmtSigned(tradeStats.realizedPnl)}</b></div>
        <div><span>今日手续费</span><b>¥{fmtMoney(tradeStats.fees)}</b></div>
        <div><span>成交笔数</span><b>{tradeStats.count}</b></div>
        <div><span>卖出胜率</span><b>{tradeStats.winRate.toFixed(1)}%</b></div>
        <div><span>盈利 / 亏损</span><b><i className="up">{tradeStats.wins}</i> / <i className="down">{tradeStats.losses}</i></b></div>
        <div><span>真实持仓</span><b>{realPositions.length ? realPositions.map((p) => `${p.name} ${p.quantity}股`).join(' / ') : '空仓'}</b></div>
      </div>

      <div className="etf-grid">
        <div className="etf-main">
          <div className="etf-scope">
            <div className="etf-scope-head">
              <span>T+0 交易范围</span>
              <b>T+0 ETF · {universe.length} 只</b>
              <em>共用账户资金和持仓；本页只操作 T+0 ETF</em>
            </div>
            <div className="etf-scope-chips">
              {universe.map((u) => <span key={u.code}>{u.code} {u.name}</span>)}
            </div>
          </div>

          <div className="etf-quotes">
            <TradingSectionHeader icon={<Activity size={12} />} title="T+0 ETF 报价" meta="新浪行情 · 15s 刷新" />
            <TradingTable
              rows={quotes}
              rowKey={(q) => q.code}
              rowClassName={(q) => (q.code === signal.targetCode ? 'is-target' : '')}
              columns={[
                { key: 'etf', label: 'ETF', render: (q) => { const def = universe.find((u) => u.code === q.code); return <><b>{q.name || def?.name || q.code}</b><small>{q.code}</small></> } },
                { key: 'price', label: '价格', className: 'mono', render: (q) => (q.price ? q.price.toFixed(3) : '—') },
                { key: 'pct', label: '涨跌', className: 'mono', render: (q) => <span className={q.pct >= 0 ? 'up' : 'down'}>{fmtSigned(q.pct)}%</span> },
                { key: 'amount', label: '成交额', className: 'mono', render: (q) => fmtAmount(q.amount) },
                { key: 'role', label: '角色', render: (q) => { const def = universe.find((u) => u.code === q.code); return <span className={`etf-role role-${def?.role ?? 'risk'}`}>{def?.role === 'risk' ? '风险' : def?.role === 'hedge' ? '对冲' : def?.role === 'defensive' ? '防守' : '现金'}</span> } },
              ]}
            />
          </div>
        </div>

        <aside className="etf-side">
          <div className={`etf-signal tone-${meta.tone}`}>
            <TradingSectionHeader icon={<Zap size={12} />} title="情绪信号" meta={<Tag tone={meta.tone}>{meta.label}</Tag>} />
            <div className="etf-signal-main">
              <span className="etf-signal-label">目标 ETF</span>
              <b>{signal.targetName ?? '—'}</b>
              <small>{signal.targetCode ?? ''} · {meta.detail}</small>
            </div>
            <p>{signal.reason}</p>
            {signal.foreignFear ? <div className="etf-fear-line"><span>海外恐慌</span><b>{signal.foreignFear.score} · {signal.foreignFear.level}</b><em>{signal.foreignFear.detail}</em></div> : null}
            <div className="etf-signal-metrics">
              <div><span>情绪温度</span><b>{signal.score}</b></div>
              <div><span>阶段</span><b>{signal.stage}</b></div>
              <div><span>趋势</span><b className={signal.trend >= 0 ? 'up' : 'down'}>{fmtSigned(signal.trend, 1)}</b></div>
            </div>
          </div>

          <div className="etf-rules-card">
            <TradingSectionHeader icon={<ShieldCheck size={12} />} title="执行规则" meta="手动确认" />
            <div className="etf-rule-grid">
              <div><span>风险开关</span><b>≥{data.rules.riskOnScore} / &lt;{data.rules.riskOffScore}</b></div>
              <div><span>仓位上限</span><b>{Math.round(data.rules.maxPositionPct * 100)}%</b></div>
              <div><span>当前建议</span><b>{Math.round(signal.positionPct * 100)}%</b></div>
              <div><span>止损</span><b>-{data.rules.stopLossPct}%</b></div>
              <div><span>调仓冷却</span><b>{data.rules.cooldownSec}s</b></div>
              <div><span>日调仓上限</span><b>{data.rules.maxSwitchesPerDay} 次</b></div>
              <div><span>最小单位</span><b>{data.rules.lotSize} 股</b></div>
              <div><span>收盘清仓</span><b>{data.rules.flatTime}</b></div>
              <div><span>佣金 / 最低</span><b>万{(data.fees.commissionRate * 10000).toFixed(1)} / ¥{data.fees.minCommission}</b></div>
              <div><span>估算往返</span><b>¥{roundTripFee.toFixed(2)} / {roundTripPct.toFixed(2)}%</b></div>
            </div>
            <p>情绪转强 → 高波动风险 ETF；情绪转弱 → 黄金/现金；单笔只持有一只，止损优先于切换。</p>
          </div>

        </aside>
      </div>

      <div className="etf-bottom">
        <div className="etf-trades">
          <TradingSectionHeader title="今日记录" meta={`${todayTrades.length} 笔 · ${live ? (data.today.mode === 'live' ? '实战' : '只读') : '离线快照'}${live ? ` · 收益 ${fmtSigned(data.today.pnl)}` : ' · 账户不可用'}`} />
          <div className="etf-trade-summary">
            <div><span>今日买入</span><b>¥{fmtMoney(todayBuy)}</b></div>
            <div><span>今日卖出</span><b>¥{fmtMoney(todaySell)}</b></div>
            <div><span>已实现盈亏</span><b className={tradeStats.realizedPnl >= 0 ? 'up' : 'down'}>{fmtSigned(tradeStats.realizedPnl)}</b></div>
            <div><span>手续费</span><b>¥{fmtMoney(tradeStats.fees)}</b></div>
          </div>
          {todayTrades.length ? (
            <div className="etf-trade-table">
              <div className="etf-trade-head"><span>时间</span><span>方向</span><span>标的</span><span>成交价</span><span>数量</span><span>金额</span><span>费用</span><span>买入成本</span><span>已实现</span><span>收益率</span><span>原因</span></div>
              {[...tradeRows].reverse().slice(0, 30).map((t) => (
                <div className="etf-trade" key={t.id}>
                  <span className="mono">{timeOf(t.time)}</span>
                  <span className={`etf-trade-side ${t.side}`}>{t.side === 'buy' ? '买' : '卖'}</span>
                  <span><b>{t.name}</b><small>{t.code}</small></span>
                  <span className="mono">{t.price.toFixed(3)}</span>
                  <span className="mono">{t.quantity}</span>
                  <span className="mono">¥{fmtMoney(t.amount)}</span>
                  <span className="mono">¥{fmtMoney(t.fee ?? 0)}</span>
                  <span className="mono">{t.entryPrice != null ? t.entryPrice.toFixed(3) : '—'}</span>
                  <span className={`mono ${t.realizedPnl != null ? (t.realizedPnl >= 0 ? 'up' : 'down') : ''}`}>{t.realizedPnl != null ? fmtSigned(t.realizedPnl) : '—'}</span>
                  <span className={`mono ${t.realizedPnlPct != null ? (t.realizedPnlPct >= 0 ? 'up' : 'down') : ''}`}>{t.realizedPnlPct != null ? fmtPct(t.realizedPnlPct) : '—'}</span>
                  <span className="etf-trade-note">{t.reason ?? t.note}</span>
                </div>
              ))}
            </div>
          ) : <div className="etf-empty">今日尚未产生操作。dry_run 不会发送委托；非交易时段不会执行调仓。</div>}
        </div>
        <div className="etf-note">
          <ShieldCheck size={13} />
          <div>
            <b>只读接口</b>
            <span>{data.note}</span>
            <span>情绪策略是状态轮动，不是无风险套利；不构成投资建议。</span>
          </div>
        </div>
      </div>
      {historyOpen ? <EtfHistoryModal onClose={() => setHistoryOpen(false)} /> : null}
      {executionsOpen ? <EtfExecutionModal onClose={() => setExecutionsOpen(false)} /> : null}
      {t0LibraryOpen ? <T0StrategyLibraryModal onClose={() => setT0LibraryOpen(false)} onChanged={() => void refresh(true)} /> : null}
      {strategyOpen ? <EtfStrategyModal rules={data.rules} universe={data.universe} foreignFear={data.signal.foreignFear} onClose={() => setStrategyOpen(false)} /> : null}
      {autoSettingsOpen ? <EtfAutoSettingsModal totalAsset={account?.totalAsset ?? 0} onClose={() => setAutoSettingsOpen(false)} onToast={onToast} /> : null}
      {liveOpen ? (
        <EtfLiveModal
          broker={broker}
          signal={signal}
          quotes={quotes}
          onClose={() => setLiveOpen(false)}
          onDone={(message, tone) => { onToast(message, tone); void refresh(true) }}
        />
      ) : null}
      {configOpen ? (
        <EtfConfigModal
          onClose={() => setConfigOpen(false)}
          onSaved={() => { void refresh(); onToast('ETF 池已更新') }}
        />
      ) : null}
    </section>
  )
}
