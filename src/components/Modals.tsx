import { AlertCircle, Check, Database, Plus, Star, Trash2, Wifi, X } from 'lucide-react'
import { useState } from 'react'
import type { Snapshot, Stock, WatchlistConfig } from '../../shared/types'
import { timeOf } from '../lib/format'
import { StatusDot } from './ui'

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  width = 560,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
  width?: number
}) {
  return (
    <div className="modal-layer" onMouseDown={onClose}>
      <div className="modal" style={{ maxWidth: width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function WatchlistModal({
  snapshot,
  watchlist,
  onAdd,
  onRemove,
  onClose,
}: {
  snapshot: Snapshot
  watchlist: Stock[]
  onAdd: (code: string) => Promise<void>
  onRemove: (stock: Stock) => Promise<void>
  onClose: () => void
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const quickPicks = [...snapshot.anchors.map((a) => a.stock), ...snapshot.leaders]
    .filter((s, i, arr) => arr.findIndex((x) => x.code === s.code) === i)
    .slice(0, 4)
  async function submit(input: string) {
    if (!/^\d{6}$/.test(input)) {
      setError('请输入 6 位 A 股代码')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onAdd(input)
      setCode('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="自定义锚定池" subtitle="加入你真正盯的票，随 10s 行情一起刷新；最多 20 只" onClose={onClose} width={600}>
      <div className="watch-add">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit(code)
          }}
          placeholder="输入 6 位股票代码"
          inputMode="numeric"
          aria-label="股票代码"
        />
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit(code)}>
          <Plus size={14} /> {busy ? '添加中' : '加入'}
        </button>
      </div>
      {error ? <div className="form-error"><AlertCircle size={13} /> {error}</div> : null}
      <div className="popular-row">
        <span>当前锚点：</span>
        {quickPicks.map((p) => (
          <button type="button" key={p.code} onClick={() => void submit(p.code)}>
            {p.name} <i className="mono">{p.code}</i>
          </button>
        ))}
      </div>
      <div className="watch-list">
        {watchlist.length ? (
          watchlist.map((s) => (
            <div className="watch-row" key={s.code}>
              <div className="watch-row-main">
                <b>{s.name}</b>
                <span className="mono">{s.code}</span>
              </div>
              <span className={`mono tone-text-${s.pct >= 0 ? 'up' : 'down'}`}>{s.pct >= 0 ? '+' : ''}{s.pct.toFixed(2)}%</span>
              <button type="button" className="icon-btn danger" onClick={() => void onRemove(s)} aria-label={`移除 ${s.name}`}>
                <Trash2 size={14} />
              </button>
            </div>
          ))
        ) : (
          <div className="watch-list-empty">
            <Star size={20} />
            <p>还没有自定义锚定。添加后会在锚点区下方生成一条观察带。</p>
          </div>
        )}
      </div>
      <div className="modal-note">
        <Check size={12} /> 自选股与自动锚点互不冲突；自动锚点每 10s 重新计算，自选池长期保留。
      </div>
      <div className="modal-foot-note">
        当前数据时点 {timeOf(snapshot.dataAsOf)} · 行情源：选股宝 / 新浪财经 / 东方财富 / 同花顺
      </div>
    </Modal>
  )
}

export function SourcesModal({
  snapshot,
  onClose,
  authRequired,
  onLogout,
}: {
  snapshot: Snapshot
  onClose: () => void
  authRequired?: boolean
  onLogout?: () => void
}) {
  const live = snapshot.sources.filter((s) => s.state === 'live').length
  return (
    <Modal title="数据源与刷新" subtitle={`${live} / ${snapshot.sources.length} 个数据源在线 · 目标刷新 10s`} onClose={onClose} width={680}>
      <div className="source-summary">
        <div>
          <span>快照生成</span>
          <b className="mono">{timeOf(snapshot.generatedAt)}</b>
        </div>
        <div>
          <span>本轮耗时</span>
          <b className="mono">{snapshot.latencyMs} ms</b>
        </div>
        <div>
          <span>下次刷新</span>
          <b className="mono">{timeOf(snapshot.nextRefreshAt)}</b>
        </div>
        <div>
          <span>市场状态</span>
          <b>{snapshot.marketStatus}</b>
        </div>
      </div>
      <div className="source-list">
        {snapshot.sources.map((s) => (
          <div className="source-row" key={s.id}>
            <StatusDot state={s.state} />
            <div className="source-main">
              <div className="source-name">
                <b>{s.name}</b>
                <span className={`source-state is-${s.state}`}>{stateLabel(s.state)}</span>
              </div>
              <p>{s.message}</p>
            </div>
            <div className="source-meta">
              <span className="mono">{s.latencyMs == null ? '—' : `${s.latencyMs}ms`}</span>
              <span className="mono">{timeOf(s.updatedAt)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="source-explain">
        <p>
          <Database size={13} /> 数据口径：全市场涨跌家数与涨跌停池来自选股宝分钟快照；指数、行业/概念、涨跌幅榜来自新浪财经；量能基线优先取东方财富日线，失败时回退同花顺。
        </p>
        <p>
          <Wifi size={13} /> 服务端每 {snapshot.refreshMs / 1000}s 拉取一轮并在基准上做增量合并；任一上游限流时自动回退到最近缓存，前端通过 SSE 接收推送。
        </p>
        <p className="source-disclaimer">
          本平台仅用于行情研究与复盘，不构成任何投资建议。数据可能存在延迟或口径差异，请以交易所与券商行情为准。
        </p>
        {authRequired && onLogout ? (
          <button type="button" className="ai-btn source-logout" onClick={onLogout}>退出登录</button>
        ) : null}
      </div>
    </Modal>
  )
}

function stateLabel(state: string) {
  if (state === 'live') return '在线'
  if (state === 'fallback') return '缓存'
  if (state === 'stale') return '延迟'
  return '异常'
}

export function Toast({ message, tone = 'up' }: { message: string; tone?: 'up' | 'down' }) {
  return (
    <div className={`toast tone-${tone}`}>
      {tone === 'up' ? <Check size={14} /> : <AlertCircle size={14} />}
      {message}
    </div>
  )
}
