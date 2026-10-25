import { useState } from 'react'
import type { TradePlan } from '../../shared/types'
import { useTradePlans } from '../hooks/useTradePlans'
import { fmtMoney, timeOf } from '../lib/format'
import { Modal } from './Modals'

export function TradePlansModal({ onClose }: { onClose: () => void }) {
  const lib = useTradePlans()
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [text, setText] = useState('')
  async function submit(id: string) {
    if (!text.trim()) return
    await lib.review(id, text.trim())
    setReviewing(null); setText('')
  }
  return (
    <Modal title="交易计划与复盘" subtitle="计划先行，交易后复盘；复盘记录保存在 data/trade-plans.json" onClose={onClose} width={860}>
      <div className="plans-list">
        {lib.plans.length === 0 ? <div className="etf-empty">主动交易提交后会自动生成计划。</div> : lib.plans.slice(0, 40).map((p: TradePlan) => (
          <div className={`plan-row ${p.status}`} key={p.id}>
            <div className="plan-line"><b>{p.side === 'buy' ? '买' : '卖'} {p.symbol}</b><span>{p.quantity} 股 @ {p.entryPrice.toFixed(3)}</span><em>{timeOf(p.createdAt)}</em><span className={`plan-state ${p.status}`}>{p.status === 'open' ? '待复盘' : '已复盘'}</span></div>
            <div className="plan-detail"><span>止损 {p.stopPrice?.toFixed(3) ?? '—'}</span><span>目标 {p.targetPrice?.toFixed(3) ?? '—'}</span><span>风险金额 ¥{fmtMoney(p.riskAmount ?? 0)}</span><span>理由 {p.reason}</span>{p.orderId ? <span>合同 {p.orderId}</span> : null}</div>
            {p.review ? <div className="plan-review">复盘：{p.review}</div> : null}
            {p.status === 'open' ? (reviewing === p.id ? <div className="plan-review-form"><textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="是否按计划执行？盈亏原因？下次怎么改？" /><button type="button" className="quant-btn-primary" onClick={() => void submit(p.id)}>保存复盘</button><button type="button" className="quant-btn-quiet" onClick={() => setReviewing(null)}>取消</button></div> : <button type="button" className="quant-btn-quiet" onClick={() => { setReviewing(p.id); setText('') }}>写复盘</button>) : null}
          </div>
        ))}
      </div>
    </Modal>
  )
}
