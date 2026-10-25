import { Activity } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { EtfExecutionRecord, EtfSentimentLog } from '../../shared/types'
import { useEtfDeskContext } from '../contexts/EtfDeskContext'
import { useEtfExecutions } from '../hooks/useEtfExecutions'
import { useEtfSentimentLog } from '../hooks/useEtfSentimentLog'
import { fmtMoney, fmtPct, fmtSigned, timeOf } from '../lib/format'
import { EtfSentimentLogModal } from './EtfSentimentLogModal'
import { TradingTable } from './trading-ui'

type Event =
  | { kind: 'signal'; time: string; id: string; log: EtfSentimentLog }
  | { kind: 'execution'; time: string; id: string; exec: EtfExecutionRecord }

function executionSource(ex: EtfExecutionRecord, t0: Set<string>): string {
  const scope = t0.has(ex.symbol) ? 'T+0 ETF' : /^(0|3|6)\d{5}$/.test(ex.symbol) ? 'T+1 股票' : '其他'
  return `${scope} · ${ex.mode === 'auto' ? '自动' : '手动'}`
}

export function TradingEvents() {
  const { logs } = useEtfSentimentLog(50)
  const executions = useEtfExecutions(50)
  const { data } = useEtfDeskContext()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<'all' | 'exec' | 'signal'>('all')
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const t0 = new Set((data?.universe ?? []).map((u) => u.code))

  const events = useMemo<Event[]>(() => {
    const rows: Event[] = [
      ...logs.map((log) => ({ kind: 'signal' as const, id: log.id, time: log.time, log })),
      ...executions.map((exec) => ({ kind: 'execution' as const, id: exec.id, time: exec.createdAt, exec })),
    ]
    return rows.filter((e) => filter === 'all' || (filter === 'exec' ? e.kind === 'execution' : e.kind === 'signal')).sort((a, b) => b.time.localeCompare(a.time)).slice(0, 80)
  }, [logs, executions, data?.universe, filter])

  return (
    <>
      <aside className="trading-events">
        <div className="etf-chat">
          <div className="etf-chat-head">
            <span><Activity size={12} /> 交易事件</span>
            <em>倒序 · {executions.length} 笔成交</em>
            <button type="button" className="etf-pool-btn" onClick={() => setView(view === 'cards' ? 'table' : 'cards')}>{view === 'cards' ? '表格' : '卡片'}</button>
            <button type="button" className="etf-pool-btn" onClick={() => setOpen(true)}>记录</button>
          </div>
          <div className="etf-event-filters">
            <button type="button" className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>全部</button>
            <button type="button" className={filter === 'exec' ? 'is-active' : ''} onClick={() => setFilter('exec')}>成交</button>
            <button type="button" className={filter === 'signal' ? 'is-active' : ''} onClick={() => setFilter('signal')}>信号</button>
          </div>
          {view === 'table' ? (
            <TradingTable
              rows={events}
              rowKey={(e) => `${e.kind}-${e.id}`}
              empty="暂无交易事件"
              className="event-table"
              columns={[
                { key: 'time', label: '时间', className: 'mono', render: (e) => timeOf(e.time) },
                { key: 'kind', label: '类型', render: (e) => e.kind === 'signal' ? '信号' : executionSource(e.exec, t0) },
                { key: 'cause', label: '因', render: (e) => e.kind === 'signal' ? `${e.log.stage} · ${e.log.score}分` : (e.exec.factors.note || '—') },
                { key: 'action', label: '操作', render: (e) => e.kind === 'signal' ? (e.log.decision || '—') : `${e.exec.side === 'buy' ? '买' : '卖'} ${e.exec.quantity} @ ${e.exec.price.toFixed(3)}` },
                { key: 'result', label: '果', render: (e) => e.kind === 'signal' ? (e.log.positions.length ? `${e.log.positions.length} 个持仓` : '空仓') : `${e.exec.status}${e.exec.realizedPnl != null ? ` · ${e.exec.realizedPnl >= 0 ? '+' : ''}¥${e.exec.realizedPnl.toFixed(2)}` : ''}` },
              ]}
            />
          ) : (
          <div className="etf-chat-list">
            {events.length === 0 ? (
              <div className="etf-chat-empty">暂无交易事件，盘中自动记录。</div>
            ) : events.map((e) => e.kind === 'signal' ? (
              <div className="etf-chat-row" key={`s-${e.id}`}>
                <span className={`etf-chat-avatar ${e.log.regime}`}>{e.log.regime === 'risk-on' ? '攻' : e.log.regime === 'risk-off' ? '守' : '观'}</span>
                <div className="etf-chat-body">
                  <div className="etf-chat-meta"><b className="etf-event-source signal">T+0 ETF · 情绪信号</b><span>{timeOf(e.time)}</span></div>
                  <p><b>{e.log.stage} · {e.log.score} 分</b> · 目标 {e.log.targetName ?? '空仓等待'}</p>
                  <div className="etf-causal">
                    <div><span>因</span><p>{e.log.stage} · {e.log.score} 分 · 涨/跌 {e.log.breadth.rise}/{e.log.breadth.fall} · 涨停/跌停 {e.log.breadth.limitUp}/{e.log.breadth.limitDown}</p></div>
                    <div><span>应对</span><p>{e.log.decision} · 目标 {e.log.targetName ?? '空仓等待'}</p></div>
                    <div><span>果</span><p>{e.log.positions.length ? e.log.positions.map((p) => `${p.symbol} ${p.quantity}股`).join(' / ') : '空仓'} · 仅信号记录，未产生委托</p></div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="etf-chat-row" key={`e-${e.id}`}>
                <span className={`etf-chat-avatar ${e.exec.side === 'buy' ? 'risk-on' : 'risk-off'}`}>{e.exec.side === 'buy' ? '买' : '卖'}</span>
                <div className="etf-chat-body">
                  <div className="etf-chat-meta"><b className="etf-event-source execution">{executionSource(e.exec, t0)}</b><span>{timeOf(e.time)}</span></div>
                  <p><b>{e.exec.side === 'buy' ? '买入' : '卖出'} {e.exec.name || e.exec.symbol} {e.exec.quantity} 股</b> · {e.exec.price.toFixed(3)}</p>
                  <div className="etf-causal">
                    <div><span>因</span><p>{e.exec.factors.note || '未记录触发原因'}{e.exec.factors.reason ? ` · ${e.exec.factors.reason}` : ''}</p></div>
                    <div><span>操作</span><p>{e.exec.side === 'buy' ? '买入' : '卖出'} {e.exec.name || e.exec.symbol} {e.exec.quantity} 股 @ {e.exec.price.toFixed(3)}</p></div>
                    <div><span>果</span><p>{e.exec.status} · {e.exec.orderId ? `合同 ${e.exec.orderId}` : '无合同'} · 持仓 {e.exec.positionAfter ?? '—'} 股 · 现金 {e.exec.cashAfter == null ? '—' : `¥${fmtMoney(e.exec.cashAfter)}`}{e.exec.realizedPnl != null ? ` · 已实现 ${e.exec.realizedPnl >= 0 ? '+' : ''}¥${e.exec.realizedPnl.toFixed(2)} / ${e.exec.realizedPnlPct?.toFixed(2)}%` : ''}</p></div>
                  </div>
                  <em>{e.exec.resolution || e.exec.message}</em>
                </div>
              </div>
            ))}
          </div>
          )}
        </div>
      </aside>
      {open ? <EtfSentimentLogModal onClose={() => setOpen(false)} /> : null}
    </>
  )
}
