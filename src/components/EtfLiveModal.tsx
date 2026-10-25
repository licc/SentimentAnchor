import { AlertTriangle, CheckCircle2, ShieldAlert, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { EtfBrokerStatus, EtfQuote, EtfSignal } from '../../shared/types'
import { placeEtfLiveOrder } from '../api'
import { fmtMoney } from '../lib/format'
import { Modal } from './Modals'

export function EtfLiveModal({
  broker,
  signal,
  quotes,
  onClose,
  onDone,
  maxManualOrderAmount = 50_000,
}: {
  broker: EtfBrokerStatus
  signal: EtfSignal
  quotes: EtfQuote[]
  onClose: () => void
  onDone: (message: string, tone?: 'up' | 'down') => void
  maxManualOrderAmount?: number
}) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [symbol, setSymbol] = useState(signal.targetCode || quotes[0]?.code || '')
  const [price, setPrice] = useState(signal.targetCode ? quotes.find((q) => q.code === signal.targetCode)?.price ?? 0 : quotes[0]?.price ?? 0)
  const [quantity, setQuantity] = useState(100)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const quote = quotes.find((q) => q.code === symbol)
  const position = broker.positions.find((p) => p.symbol === symbol)
  const amount = useMemo(() => price * quantity, [price, quantity])
  const maxAmount = Math.min(maxManualOrderAmount, (broker.account?.totalAsset ?? 0) * 0.7)
  const live = broker.mode === 'live' && broker.ok
  const cash = broker.account?.cashAvailable ?? 0
  const sellable = position?.available ?? 0

  function chooseSymbol(code: string) {
    setSymbol(code)
    const q = quotes.find((x) => x.code === code)
    if (q?.price) setPrice(q.price)
  }

  async function submit() {
    setError(null)
    if (!live) { setError('接口不是 live，不能实盘下单'); return }
    if (!confirmed) { setError('请先确认这是实盘委托'); return }
    if (!symbol || price <= 0 || quantity <= 0 || quantity % 100 !== 0) { setError('请填写有效代码、价格和 100 的整数倍数量'); return }
    if (amount > maxAmount) { setError(`单笔金额 ¥${fmtMoney(amount)} 超过上限 ¥${fmtMoney(maxAmount)}（总资产的 50%）`); return }
    if (side === 'buy' && amount + Math.max(5, amount * 0.0002) > cash) { setError(`可用资金不足以覆盖委托和佣金：需要 ¥${fmtMoney(amount + Math.max(5, amount * 0.0002))}，可用 ¥${fmtMoney(cash)}`); return }
    if (side === 'sell' && quantity > sellable) { setError(`可卖持仓不足：可卖 ${sellable} 股`); return }
    setBusy(true)
    try {
      const result = await placeEtfLiveOrder({ symbol, side, price, quantity })
      onDone(result.message || '实盘委托已提交', 'up')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '实盘委托失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="实盘委托" subtitle="这一步会向同花顺接口发送真实委托；请先核对代码、方向和金额" onClose={onClose} width={560}>
      <div className={`etf-live-warning ${live ? 'is-ready' : ''}`}>
        {live ? <CheckCircle2 size={15} /> : <ShieldAlert size={15} />}
        <div>
          <b>{live ? `实盘已连接 · ${broker.mode}` : `当前接口：${broker.mode}`}</b>
          <span>{live ? '下单会发送到交易接口，不是本地模拟。' : '接口不是 live，不能发送真实委托；请先在交易客户端切换模式并登录。'}</span>
        </div>
      </div>

      {signal.targetCode ? (
        <div className="etf-live-signal">
          <span>当前策略目标</span>
          <b>{signal.targetName} <small>{signal.targetCode}</small></b>
          <em>{signal.regime === 'risk-on' ? '进攻' : signal.regime === 'risk-off' ? '防守' : '观望'} · {signal.reason}</em>
        </div>
      ) : null}

      <div className="etf-live-form">
        <label><span>方向</span>
          <div className="etf-live-side">
            <button type="button" className={side === 'buy' ? 'is-buy' : ''} onClick={() => setSide('buy')}>买入</button>
            <button type="button" className={side === 'sell' ? 'is-sell' : ''} onClick={() => setSide('sell')}>卖出</button>
          </div>
        </label>
        <label><span>ETF</span>
          <select value={symbol} onChange={(e) => chooseSymbol(e.target.value)}>
            {quotes.map((q) => <option key={q.code} value={q.code}>{q.code} {q.name}</option>)}
          </select>
        </label>
        <label><span>限价</span><input type="number" step="0.001" min="0" value={price} onChange={(e) => setPrice(Number(e.target.value))} /></label>
        <label><span>数量（100 股整数倍）</span><input type="number" step="100" min="100" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></label>
      </div>

      <div className="etf-live-calc">
        <div><span>预计金额</span><b>¥{fmtMoney(amount)}</b></div>
        <div><span>可用资金</span><b>¥{fmtMoney(cash)}</b></div>
        <div><span>可卖持仓</span><b>{sellable} 股</b></div>
        <div><span>单笔上限</span><b>¥{fmtMoney(maxAmount)}</b></div>
      </div>

      <label className="etf-live-confirm">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>我确认这是实盘委托，不是模拟；方向、代码、价格、数量已核对。</span>
      </label>
      {error ? <div className="form-error"><AlertTriangle size={13} /> {error}</div> : null}

      <div className="etf-live-actions">
        <button type="button" className="ai-btn" onClick={onClose}><X size={12} /> 取消</button>
        <button type="button" className="etf-live-submit" disabled={busy || !live || !confirmed} onClick={() => void submit()}>
          {busy ? '提交中…' : '确认实盘下单'}
        </button>
      </div>
      <div className="modal-note">实盘委托由同花顺接口执行；本平台不绕过券商风控。成交与撤单以券商回执为准。</div>
    </Modal>
  )
}
