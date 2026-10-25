import { ShieldCheck } from 'lucide-react'
import { useEtfDeskContext } from '../contexts/EtfDeskContext'
import { fmtMoney } from '../lib/format'
import { useBrokerCommands } from '../hooks/useBrokerCommands'
import { SystemHealthLine } from './SystemHealthLine'
import { TradingSectionHeader } from './trading-ui'

export function TradingPositions() {
  const { data } = useEtfDeskContext()
  if (!data) return null
  const positions = data.broker.positions.filter((p) => p.quantity > 0)
  const account = data.broker.account
  const commands = useBrokerCommands()
  const t0 = new Set(data.universe.map((u) => u.code))
  return (
    <section className="etf-positions trading-shared-positions">
      <TradingSectionHeader icon={<ShieldCheck size={12} />} title="交易账户 · 共用" meta="同一交易接口 · 两个策略范围共用资金与持仓" />
      {data.broker?.warnings?.length ? <div className="shared-broker-warning">{data.broker.warnings.join(' · ')}</div> : null}
      {data.broker ? (
        <div className="shared-broker-line">
          <span className={`shared-broker-dot ${data.broker.ok ? 'is-on' : ''}`} />
          <b>{data.broker.ok ? '交易接口在线' : '交易接口异常'}</b>
          <span>{data.broker.mode}</span>
          <span>客户端 {data.broker.clientRunning ? '运行' : '未运行'}</span>
          <span>登录 {data.broker.clientLoggedIn ? '正常' : '异常'}</span>
          {data.broker.error ? <em>{data.broker.error}</em> : null}
        </div>
      ) : null}
      <SystemHealthLine />
      {account ? (
        <div className="shared-account-line">
          <span>总资产 <b>¥{fmtMoney(account.totalAsset)}</b></span>
          <span>可用 <b>¥{fmtMoney(account.cashAvailable)}</b></span>
          <span>持仓市值 <b>¥{fmtMoney(account.marketValue)}</b></span>
          <span>持仓 <b>{positions.length} 只</b></span>
          <span>交易通道 <b>统一串行</b></span>
          <span>指令队列 <b>{commands ? `${commands.queued}${commands.kind ? ' · 执行中' : ''}` : '—'}</b></span>
        </div>
      ) : null}
      {positions.length ? (
        <table>
          <thead><tr><th>标的</th><th>类型</th><th>管理</th><th>持仓</th><th>可用</th><th>成本</th><th>现价</th><th>市值</th><th>盈亏</th><th>仓位</th></tr></thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.symbol}>
                <td><b>{p.name || p.symbol}</b><small>{p.symbol}</small></td>
                <td className={`position-kind ${t0.has(p.symbol) ? 'is-t0' : 'is-t1'}`}>{t0.has(p.symbol) ? 'T+0 ETF' : /^(0|3|6)\d{5}$/.test(p.symbol) ? 'T+1 股票' : '其他'}</td>
                <td>{t0.has(p.symbol) ? 'T+0 交易' : /^(0|3|6)\d{5}$/.test(p.symbol) ? '量化交易' : '未分配'}</td>
                <td className="mono">{p.quantity} 股</td>
                <td className="mono">{p.available} 股</td>
                <td className="mono">{p.costPrice ? p.costPrice.toFixed(3) : '—'}</td>
                <td className="mono">{p.lastPrice ? p.lastPrice.toFixed(3) : '—'}</td>
                <td className="mono">¥{fmtMoney(p.marketValue)}</td>
                <td className={`mono ${p.pnl >= 0 ? 'up' : 'down'}`}>{p.pnl >= 0 ? '+' : ''}{fmtMoney(p.pnl)}</td>
                <td className="mono">{account?.totalAsset ? `${((p.marketValue / account.totalAsset) * 100).toFixed(1)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="etf-empty">当前空仓</div>}
    </section>
  )
}
