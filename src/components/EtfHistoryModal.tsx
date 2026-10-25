import { CalendarDays } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { EtfDailyRecord, EtfHistoryPayload } from '../../shared/types'
import { getEtfHistory } from '../api'
import { fmtMoney, fmtSigned, timeOf } from '../lib/format'
import { Modal } from './Modals'

export function EtfHistoryModal({ onClose }: { onClose: () => void }) {
  const [payload, setPayload] = useState<EtfHistoryPayload | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getEtfHistory()
      .then((data) => {
        setPayload(data)
        setSelected(data.days[0]?.date ?? null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : '读取每日记录失败'))
      .finally(() => setLoading(false))
  }, [])

  const day = useMemo(() => payload?.days.find((d) => d.date === selected) ?? payload?.days[0] ?? null, [payload, selected])

  return (
    <Modal title="每日套利记录" subtitle="每天的信号、模拟成交和权益变化，保存在服务端 data/etf-journal.json" onClose={onClose} width={820}>
      {loading ? <div className="etf-empty">读取每日记录…</div> : null}
      {error ? <div className="form-error">{error}</div> : null}
      {!loading && payload && payload.days.length === 0 ? <div className="etf-empty">还没有记录。打开 ETF 台或执行一次模拟调仓后会自动生成今日记录。</div> : null}
      {day ? (
        <div className="etf-history">
          <aside className="etf-history-days">
            {payload?.days.map((d) => (
              <button key={d.date} type="button" className={d.date === day.date ? 'is-active' : ''} onClick={() => setSelected(d.date)}>
                <span><CalendarDays size={11} /> {d.date}</span>
                <b className={d.pnl >= 0 ? 'up' : 'down'}>{fmtSigned(d.pnl)}</b>
                <small>{d.trades.length} 笔 · {d.signals.length} 个信号</small>
              </button>
            ))}
          </aside>
          <div className="etf-history-detail">
            <div className="etf-history-summary">
              <div><span>日期 / 模式</span><b>{day.date} · {day.mode === 'live' ? '实战' : '模拟'}</b></div>
              <div><span>开始权益</span><b>¥{fmtMoney(day.startEquity)}</b></div>
              <div><span>当前权益</span><b>¥{fmtMoney(day.equity)}</b></div>
              <div><span>当日盈亏</span><b className={day.pnl >= 0 ? 'up' : 'down'}>{fmtSigned(day.pnl)} / {fmtSigned(day.pnlPct)}%</b></div>
            </div>
            <div className="etf-history-block">
              <div className="etf-subhead"><span>当日操作</span><span>{day.trades.length} 笔 · 模拟</span></div>
              {day.trades.length ? (
                <div className="etf-history-trades">
                  {day.trades.map((t) => (
                    <div key={t.id}>
                      <span className={`etf-trade-side ${t.side}`}>{t.side === 'buy' ? '买' : '卖'}</span>
                      <b>{t.name}</b>
                      <span>{t.code}</span>
                      <span>{t.quantity}股 @ {t.price.toFixed(3)}</span>
                      <span>¥{fmtMoney(t.amount)}</span>
                      <span>{timeOf(t.time)}</span>
                    </div>
                  ))}
                </div>
              ) : <div className="etf-empty">当日尚无模拟成交。</div>}
            </div>
            <div className="etf-history-block">
              <div className="etf-subhead"><span>信号变化</span><span>{day.signals.length} 条</span></div>
              {day.signals.length ? (
                <div className="etf-history-signals">
                  {day.signals.map((s) => (
                    <div key={s.id}>
                      <span className={`etf-history-regime ${s.regime}`}>{s.regime === 'risk-on' ? '进攻' : s.regime === 'risk-off' ? '防守' : '观望'}</span>
                      <b>{s.targetName ?? '—'}</b>
                      <span>{s.stage} / {s.score} / {fmtSigned(s.trend, 1)}</span>
                      <span>{s.reason}</span>
                      <time>{timeOf(s.time)}</time>
                    </div>
                  ))}
                </div>
              ) : <div className="etf-empty">当日尚无信号记录。</div>}
            </div>
            <div className="etf-history-note">记录口径：本地模拟，非真实成交；权益按最近 ETF 报价重估。</div>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
