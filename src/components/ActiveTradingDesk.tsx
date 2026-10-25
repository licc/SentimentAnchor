import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ManualOrderPreflight } from '../../shared/types'
import { useEtfDeskContext } from '../contexts/EtfDeskContext'
import { createTradePlan, getManualQuote, placeManualOrder, preflightManualOrder } from '../api'
import { fmtMoney } from '../lib/format'
import { TradingMetric, TradingMetricStrip, TradingSectionHeader } from './trading-ui'
import { TradePlansModal } from './TradePlansModal'
import { IntradayAnalysisModal } from './IntradayAnalysisModal'

export function ActiveTradingDesk({ onToast }: { onToast: (message: string, tone?: 'up' | 'down') => void }) {
  const { data, refresh } = useEtfDeskContext()
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [symbol, setSymbol] = useState('518880')
  const [price, setPrice] = useState(0)
  const [quantity, setQuantity] = useState(100)
  const [stopPrice, setStopPrice] = useState(0)
  const [targetPrice, setTargetPrice] = useState(0)
  const [riskPct, setRiskPct] = useState(0.5)
  const [plansOpen, setPlansOpen] = useState(false)
  const [intradayOpen, setIntradayOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [checked, setChecked] = useState({ notEmotional: false, hasExit: false, withinPlan: false })
  const [preflight, setPreflight] = useState<ManualOrderPreflight | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const account = data?.broker.account
  const position = data?.broker.positions.find((p) => p.symbol === symbol)
  const marketQuote = data?.quotes.find((q) => q.code === symbol)
  useEffect(() => {
    if (price > 0) return
    if (marketQuote?.price) setPrice(marketQuote.price)
  }, [marketQuote, price])
  const amount = price * quantity
  const ready = checked.notEmotional && checked.hasExit && checked.withinPlan && reason.trim().length >= 4

  async function loadQuote() {
    try {
      const q = await getManualQuote(symbol)
      if (q?.price) setPrice(q.price)
      else if (marketQuote?.price) setPrice(marketQuote.price)
      else setMessage('行情暂不可用，请手工填写价格')
      setPreflight(null)
    } catch (err) { setMessage(err instanceof Error ? err.message : '行情读取失败') }
  }

  async function runPreflight() {
    setBusy(true); setMessage(null)
    try {
      const result = await preflightManualOrder({ symbol, side, price, quantity, reason })
      setPreflight(result)
    } catch (err) { setMessage(err instanceof Error ? err.message : '预检失败') } finally { setBusy(false) }
  }

  function sizeByRisk() {
    const equity = account?.totalAsset ?? 0
    if (!equity || price <= 0 || stopPrice <= 0 || stopPrice >= price) { setMessage('请填写高于 0 且低于买入价的止损价'); return }
    const riskAmount = equity * riskPct / 100
    const riskPerShare = price - stopPrice
    const next = Math.floor(riskAmount / riskPerShare / 100) * 100
    if (next < 100) { setMessage(`按风险计算的仓位不足 100 股（可承受亏损 ¥${riskAmount.toFixed(2)}）`); return }
    setQuantity(next)
    setMessage(`按风险 ${riskPct}% 计算：可亏 ¥${riskAmount.toFixed(2)}，数量 ${next} 股`)
  }

  async function submit() {
    if (!preflight?.allowed) { setMessage('请先通过风控预检'); return }
    if (!ready) { setMessage('请填写理由并完成三项确认'); return }
    if (!window.confirm(`${side === 'buy' ? '买入' : '卖出'} ${symbol} ${quantity} 股 @ ${price.toFixed(3)}，确认提交真实委托？`)) return
    setBusy(true); setMessage(null)
    try {
      const result = await placeManualOrder({ symbol, side, price, quantity, reason })
      void createTradePlan({ symbol, side, entryPrice: price, stopPrice: stopPrice > 0 ? stopPrice : null, targetPrice: targetPrice > 0 ? targetPrice : null, quantity, riskAmount: stopPrice > 0 ? Math.max(0, (price - stopPrice) * quantity) : null, reason, orderId: result.orderId }).catch(() => undefined)
      onToast(result.message || '主动交易委托已提交')
      setPreflight(null)
      await refresh(true)
    } catch (err) { setMessage(err instanceof Error ? err.message : '委托失败') } finally { setBusy(false) }
  }

  return (
    <section className="active-trading">
      <div className="active-hero">
        <div>
          <span className="active-kicker">主动交易 · 人工委托</span>
          <h2>人工下单隔离层</h2>
          <p>不自动交易、不绑定策略。每笔委托必须先经过风控预检、写下理由并完成人工确认。</p>
        </div>
        <div className="active-hero-actions"><button type="button" className="quant-btn-quiet" onClick={() => setIntradayOpen(true)}>分时检查</button><button type="button" className="quant-btn-quiet" onClick={() => setPlansOpen(true)}>交易计划 / 复盘</button><span className="active-lock">人工确认</span></div>
      </div>

      <TradingMetricStrip columns={4}>
        <TradingMetric label="可用资金" value={account ? `¥${fmtMoney(account.cashAvailable)}` : '—'} />
        <TradingMetric label="当前标的持仓" value={position ? `${position.quantity} 股` : '0 股'} />
        <TradingMetric label="可卖数量" value={position ? `${position.available} 股` : '0 股'} />
        <TradingMetric label="本次金额" value={`¥${fmtMoney(amount)}`} />
      </TradingMetricStrip>

      <div className="active-grid">
        <div className="active-panel">
          <TradingSectionHeader title="委托单" meta="先预检，再提交" />
          <div className="active-side">
            <button type="button" className={side === 'buy' ? 'is-buy' : ''} onClick={() => { setSide('buy'); setPreflight(null) }}>买入</button>
            <button type="button" className={side === 'sell' ? 'is-sell' : ''} onClick={() => { setSide('sell'); setPreflight(null) }}>卖出</button>
          </div>
          <label className="active-field">代码 / ETF
            <div className="active-code-line">
              <input value={symbol} maxLength={6} onChange={(e) => { setSymbol(e.target.value.replace(/\D/g, '')); setPreflight(null) }} onBlur={() => void loadQuote()} placeholder="6 位代码" />
              <button type="button" onClick={() => void loadQuote()}>取行情</button>
            </div>
          </label>
          <div className="active-row">
            <label className="active-field">限价<input type="number" step="0.001" min="0" value={price || ''} onChange={(e) => { setPrice(Number(e.target.value)); setPreflight(null) }} /></label>
            <label className="active-field">数量<input type="number" step="100" min="100" value={quantity} onChange={(e) => { setQuantity(Number(e.target.value)); setPreflight(null) }} /></label>
          </div>
          <div className="active-row">
            <label className="active-field">止损价<input type="number" step="0.001" min="0" value={stopPrice || ''} onChange={(e) => setStopPrice(Number(e.target.value))} /></label>
            <label className="active-field">目标价<input type="number" step="0.001" min="0" value={targetPrice || ''} onChange={(e) => setTargetPrice(Number(e.target.value))} /></label>
          </div>
          <div className="active-risk-line">
            <label>单笔风险 %<input type="number" step="0.1" min="0.1" max="5" value={riskPct} onChange={(e) => setRiskPct(Number(e.target.value))} /></label>
            <button type="button" className="quant-btn-quiet" disabled={side !== 'buy' || stopPrice <= 0} onClick={sizeByRisk}>按风险定仓</button>
          </div>
          <label className="active-field">交易理由 / 计划
            <textarea value={reason} maxLength={200} onChange={(e) => { setReason(e.target.value); setPreflight(null) }} placeholder="至少 4 个字：为什么现在做、止损/退出条件是什么" />
          </label>
          <div className="active-checks">
            <label><input type="checkbox" checked={checked.notEmotional} onChange={(e) => setChecked({ ...checked, notEmotional: e.target.checked })} /> 不是追涨或恐慌下单</label>
            <label><input type="checkbox" checked={checked.hasExit} onChange={(e) => setChecked({ ...checked, hasExit: e.target.checked })} /> 已设定止损 / 退出条件</label>
            <label><input type="checkbox" checked={checked.withinPlan} onChange={(e) => setChecked({ ...checked, withinPlan: e.target.checked })} /> 金额和仓位在计划内</label>
          </div>
          <div className="active-actions">
            <button type="button" className="quant-btn-quiet" disabled={busy || !symbol || price <= 0 || quantity <= 0} onClick={() => void runPreflight()}><ShieldCheck size={12} /> 风控预检</button>
            <button type="button" className="quant-btn-primary" disabled={busy || !preflight?.allowed || !ready} onClick={() => void submit()}>提交真实委托</button>
          </div>
          {message ? <div className="form-error"><AlertTriangle size={12} /> {message}</div> : null}
        </div>

        <div className="active-panel">
          <TradingSectionHeader title="买入风控 / 卖出检查" meta={busy ? '预检中…' : preflight ? (preflight.allowed ? '通过' : '有拦截项') : '等待预检'} />
          {preflight ? (
            <div className="active-checks-list">
              {preflight.checks.map((c) => <div className={`active-check ${c.passed ? 'ok' : 'bad'}`} key={c.id}>{c.passed ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}<span>{c.label}</span><em>{c.passed ? '通过' : c.detail}</em></div>)}
            </div>
          ) : <div className="etf-empty">填写委托后点击“风控预检”；预检不会发送委托。</div>}
          <div className="active-guard">
            <b>主动交易隔离规则</b>
            <span>必须填写理由</span>
            <span>必须完成三项人工确认</span>
            <span>买入走统一风控，卖出检查可卖持仓</span>
            <span>所有委托进入统一券商通道和审计账本</span>
          </div>
        </div>
      </div>
      {plansOpen ? <TradePlansModal onClose={() => setPlansOpen(false)} /> : null}
      {intradayOpen ? <IntradayAnalysisModal symbol={symbol} onClose={() => setIntradayOpen(false)} /> : null}
    </section>
  )
}
