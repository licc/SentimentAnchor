import { ClipboardList } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { EtfExecutionRecord } from '../../shared/types'
import { dismissEtfExecution, getEtfExecutions, reconcileEtfExecutions } from '../api'
import { fmtMoney, timeOf } from '../lib/format'
import { Modal } from './Modals'

const STATUS_LABEL: Record<EtfExecutionRecord['status'], string> = {
  submitting: '提交中',
  accepted: '已受理',
  filled: '已成交',
  partial: '部分成交',
  cancelled: '已撤单',
  rejected: '已拒绝',
  timeout: '超时',
  unknown: '结果未知',
  blocked: '被拦截',
}

export function EtfExecutionModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<EtfExecutionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function reload() {
    return getEtfExecutions().then((r) => setRows(r.executions))
  }

  useEffect(() => {
    getEtfExecutions()
      .then((r) => setRows(r.executions))
      .catch((err) => setError(err instanceof Error ? err.message : '读取执行记录失败'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <Modal title="执行记录" subtitle="每次下单尝试、执行因子、接口回执和未成交处理都记录在服务端 data/etf-executions.json" onClose={onClose} width={880}>
      {loading ? <div className="etf-empty">读取执行记录…</div> : null}
      {error ? <div className="form-error">{error}</div> : null}
      <div className="etf-exec-actions">
        <button type="button" className="etf-pool-btn" disabled={busy} onClick={() => {
          setBusy(true); setError(null)
          void reconcileEtfExecutions().then(() => reload()).catch((err) => setError(err instanceof Error ? err.message : '核对失败')).finally(() => setBusy(false))
        }}>核对委托 / 持仓 / 资金</button>
      </div>
      {!loading && rows.length === 0 ? <div className="etf-empty">暂无执行记录。实盘下单或自动执行尝试后会出现在这里。</div> : null}
      <div className="etf-exec-list">
        {rows.map((r) => (
          <article className={`etf-exec ${r.status}`} key={r.id}>
            <div className="etf-exec-head">
              <span className={`etf-exec-status ${r.status}`}>{STATUS_LABEL[r.status]}</span>
              <span className="etf-exec-source">{r.mode === 'auto' ? '自动' : '手动'}</span>
              <b>{r.side === 'buy' ? '买入' : '卖出'} {r.name} <small>{r.symbol}</small></b>
              <span className="etf-exec-time">{timeOf(r.createdAt)}</span>
            </div>
            <div className="etf-exec-grid">
              <div><span>委托</span><b>{r.quantity} 股 @ {r.price.toFixed(3)}</b></div>
              <div><span>金额</span><b>¥{fmtMoney(r.amount)}</b></div>
              <div><span>合同编号</span><b>{r.orderId ?? '—'}</b></div>
              <div><span>成交</span><b>{r.filled} 股 · {r.brokerStatus || '—'}</b></div>
              <div><span>手续费</span><b>¥{fmtMoney(r.fee)}</b></div>
              <div><span>剩余可用</span><b>{r.cashAfter == null ? '—' : `¥${fmtMoney(r.cashAfter)}`}</b></div>
              <div><span>原因</span><b>{r.factors.note || r.factors.reason || '—'}</b></div>
              <div><span>已实现盈亏</span><b className={r.realizedPnl != null ? (r.realizedPnl >= 0 ? 'up' : 'down') : ''}>{r.realizedPnl == null ? '—' : `${r.realizedPnl >= 0 ? '+' : ''}¥${fmtMoney(r.realizedPnl)} / ${r.realizedPnlPct?.toFixed(2)}%`}</b></div>
              <div><span>核对持仓</span><b>{r.positionAfter == null ? '—' : `${r.positionAfter} 股`}</b></div>
            </div>
            {r.evidence ? (
              <div className="etf-exec-evidence">
                <span>确认来源</span>
                <b>{r.evidence.sources.join(' + ') || '无'}</b>
                <em>订单 {r.evidence.orderStatus || '—'} · 成交 {r.evidence.tradeQty} 股 · 持仓 {r.evidence.positionAfter} 股 · {r.evidence.consistent ? '一致' : '不一致'}</em>
              </div>
            ) : null}
            <div className="etf-exec-factors">
              <span>因子</span>
              <b>{r.factors.regime ?? '—'} · {r.factors.stage ?? '—'} · 温度 {r.factors.score ?? '—'} · 趋势 {r.factors.trend ?? '—'}</b>
              {r.factors.reason ? <em>{r.factors.reason}</em> : null}
            </div>
            <div className="etf-exec-resolution"><ClipboardList size={11} /><span>{r.resolution}</span>{r.message ? <small>{r.message}</small> : null}
              {r.status === 'unknown' ? <button type="button" className="etf-exec-dismiss" disabled={busy} onClick={() => {
                if (!window.confirm('只有在券商客户端确认没有这笔委托时才标记未成交。确认继续？')) return
                setBusy(true); setError(null)
                void dismissEtfExecution(r.id).then(() => reload()).catch((err) => setError(err instanceof Error ? err.message : '标记失败')).finally(() => setBusy(false))
              }}>确认券商无此单</button> : null}
            </div>
          </article>
        ))}
      </div>
    </Modal>
  )
}
