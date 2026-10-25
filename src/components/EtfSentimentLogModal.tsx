import { Activity } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { EtfSentimentLog } from '../../shared/types'
import { getEtfSentimentLog } from '../api'
import { fmtAmount, fmtMoney, fmtPct, fmtSigned, timeOf } from '../lib/format'
import { Modal } from './Modals'

const REGIME: Record<EtfSentimentLog['regime'], string> = {
  'risk-on': '进攻',
  neutral: '观望',
  'risk-off': '防守',
}

export function EtfSentimentLogModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<EtfSentimentLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getEtfSentimentLog(100)
      .then((r) => setRows(r.logs))
      .catch((err) => setError(err instanceof Error ? err.message : '读取交易事件失败'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <Modal title="交易事件" subtitle="按时间倒序保存交易事件：市场情绪、目标、决策、广度、持仓与执行上下文" onClose={onClose} width={880}>
      {loading ? <div className="etf-empty">读取交易事件…</div> : null}
      {error ? <div className="form-error">{error}</div> : null}
      {!loading && rows.length === 0 ? <div className="etf-empty">暂无交易事件。页面刷新后会自动开始记录。</div> : null}
      <div className="etf-sent-list">
        {rows.map((r) => (
          <article className="etf-sent" key={r.id}>
            <div className="etf-sent-head">
              <span className={`etf-sent-regime ${r.regime}`}>{REGIME[r.regime]}</span>
              <b>{r.stage} · {r.score} 分</b>
              <span className="etf-sent-time">{r.tradingDate} {timeOf(r.time)} · {r.marketStatus}</span>
            </div>
            <div className="etf-sent-main">
              <div><span>情绪</span><b>{r.stage}</b><em>温度 {r.score} · 趋势 {fmtSigned(r.trend, 1)} · 风险 {r.risk}</em></div>
              <div><span>目标</span><b>{r.targetName ?? '空仓等待'}</b><em>{r.targetCode ?? 'CASH'} · {r.decision}</em></div>
              <div><span>广度</span><b>{r.breadth.rise} / {r.breadth.fall}</b><em>涨停 {r.breadth.limitUp} · 跌停 {r.breadth.limitDown} · 成交 {fmtAmount(r.breadth.amount)}</em></div>
              <div><span>账户</span><b>{r.account ? `¥${fmtMoney(r.account.totalAsset)}` : '—'}</b><em>{r.positions.length ? r.positions.map((p) => `${p.symbol} ${p.quantity}股`).join(' / ') : '空仓'}</em></div>
            </div>
            <p className="etf-sent-reason"><Activity size={10} /> {r.reason}</p>
            <div className="etf-sent-quotes">
              {r.quotes.map((q) => <span key={q.code}>{q.code} {q.price.toFixed(3)} <em>{fmtPct(q.pct)}</em></span>)}
            </div>
          </article>
        ))}
      </div>
    </Modal>
  )
}
