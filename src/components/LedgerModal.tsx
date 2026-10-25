import { useEffect, useState } from 'react'
import { getLedger, getPortfolioAnalytics } from '../api'
import { fmtMoney, timeOf } from '../lib/format'
import { Modal } from './Modals'
import { TradingMetric, TradingMetricStrip, TradingTable } from './trading-ui'

type Ledger = Awaited<ReturnType<typeof getLedger>>
export function LedgerModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<Ledger | null>(null)
  const [analytics, setAnalytics] = useState<Awaited<ReturnType<typeof getPortfolioAnalytics>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [symbol, setSymbol] = useState('')
  const [status, setStatus] = useState('')
  function load() { void getLedger({ symbol, status }).then(setData).catch((err) => setError(err instanceof Error ? err.message : '账本读取失败')) }
  useEffect(() => { load(); void getPortfolioAnalytics().then(setAnalytics).catch(() => undefined) }, [])
  function exportCsv() {
    if (!data) return
    const head = 'time,symbol,side,price,quantity,status,order_id,source,error'
    const lines = data.recent.map((r) => [r.created_at, r.symbol, r.side, r.price, r.quantity, r.status, r.broker_order_id ?? '', r.source, (r.error ?? '').replaceAll(',', '，')].join(','))
    const blob = new Blob([`${head}\n${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `ledger-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  return (
    <Modal title="交易账本" subtitle="SQLite 统一账本 · 订单意图 / 成交 / 风控事件" onClose={onClose} width={900}>
      {error ? <div className="form-error">{error}</div> : null}
      {data ? <>
        <div className="ledger-filters"><input value={symbol} onChange={(e) => setSymbol(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="代码筛选" maxLength={6} /><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option><option value="filled">filled</option><option value="submitted">submitted</option><option value="rejected">rejected</option><option value="unknown">unknown</option></select><button type="button" className="quant-btn-quiet" onClick={load}>筛选</button><button type="button" className="quant-btn-quiet" onClick={() => exportCsv()}>导出 CSV</button></div>
        <TradingMetricStrip columns={6}>
          <TradingMetric label="订单" value={data.summary.orders} />
          <TradingMetric label="成交" value={data.summary.fills} />
          <TradingMetric label="成交金额" value={`¥${fmtMoney(data.summary.filledNotional)}`} />
          <TradingMetric label="手续费" value={`¥${fmtMoney(data.summary.fees)}`} />
          <TradingMetric label="风控事件" value={data.summary.riskEvents} />
          <TradingMetric label="拦截" value={data.summary.blocked} />
        </TradingMetricStrip>
        {analytics ? <div className="ledger-analytics"><TradingMetricStrip columns={5}><TradingMetric label="已实现" value={`¥${fmtMoney(analytics.realizedPnl)}`} tone={analytics.realizedPnl >= 0 ? 'up' : 'down'} /><TradingMetric label="平仓胜率" value={`${analytics.winRate.toFixed(1)}%`} /><TradingMetric label="盈亏比" value={analytics.profitFactor.toFixed(2)} /><TradingMetric label="平均盈利" value={`¥${fmtMoney(analytics.avgWin)}`} /><TradingMetric label="平均亏损" value={`¥${fmtMoney(analytics.avgLoss)}`} /></TradingMetricStrip></div> : null}
        <div style={{ height: 8 }} />
        <TradingTable
          rows={data.recent.slice(0, 40)}
          rowKey={(r) => r.client_order_id}
          empty="暂无账本记录"
          columns={[
            { key: 'time', label: '时间', className: 'mono', render: (r) => timeOf(r.created_at) },
            { key: 'symbol', label: '标的', render: (r) => r.symbol },
            { key: 'side', label: '方向', render: (r) => (r.side === 'buy' || r.side === '买入' ? '买' : '卖') },
            { key: 'price', label: '价格', className: 'mono', render: (r) => r.price.toFixed(3) },
            { key: 'quantity', label: '数量', className: 'mono', render: (r) => r.quantity },
            { key: 'status', label: '状态', render: (r) => r.status },
            { key: 'order', label: '合同', className: 'mono', render: (r) => r.broker_order_id ?? '—' },
            { key: 'source', label: '来源', render: (r) => r.source },
          ]}
        />
      </> : <div className="etf-empty">读取账本…</div>}
    </Modal>
  )
}
