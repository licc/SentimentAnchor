import { Save, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { EtfAutoConfig } from '../../shared/types'
import { useEtfAutoConfig } from '../hooks/useEtfAutoConfig'
import { useEtfFees } from '../hooks/useEtfFees'
import { Modal } from './Modals'

export function EtfAutoSettingsModal({ totalAsset, onClose, onToast }: {
  totalAsset: number
  onClose: () => void
  onToast: (message: string, tone?: 'up' | 'down') => void
}) {
  const auto = useEtfAutoConfig()
  const fees = useEtfFees()
  const [form, setForm] = useState<EtfAutoConfig | null>(null)
  const [feePct, setFeePct] = useState(0.3)
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (auto.config) setForm(auto.config) }, [auto.config])
  useEffect(() => { if (fees.settings) setFeePct(fees.settings.maxDailyFeePct) }, [fees.settings?.maxDailyFeePct])

  async function save() {
    if (!form) return
    setBusy(true)
    try {
      await auto.save(form)
      await fees.save({ maxDailyFeePct: feePct, maxDailyFeeAmount: fees.settings?.maxDailyFeeAmount ?? 0 })
      onToast('自动执行参数已保存')
      onClose()
    } catch (err) {
      onToast(err instanceof Error ? err.message : '保存失败', 'down')
    } finally { setBusy(false) }
  }

  return (
    <Modal title="自动执行参数" subtitle="这些参数会影响自动暂停、止损和手续费上限" onClose={onClose} width={680}>
      {!form ? <div className="etf-empty">加载参数…</div> : (
        <>
          <div className="auto-settings-grid">
            <label>单次止损 %<input type="number" step="0.1" min="0" max="20" value={form.stopLossPct} onChange={(e) => setForm({ ...form, stopLossPct: Number(e.target.value) })} /></label>
            <label>当日最大亏损 %<input type="number" step="0.1" min="0.1" max="20" value={form.maxDailyLossPct} onChange={(e) => setForm({ ...form, maxDailyLossPct: Number(e.target.value) })} /></label>
            <label>每日最大调仓次数<input type="number" min="0" max="100" value={form.maxSwitchesPerDay} onChange={(e) => setForm({ ...form, maxSwitchesPerDay: Number(e.target.value) })} /></label>
            <label>调仓冷却 秒<input type="number" min="0" max="86400" value={form.cooldownSec} onChange={(e) => setForm({ ...form, cooldownSec: Number(e.target.value) })} /></label>
            <label>收盘清仓时间<input value={form.flatTime} onChange={(e) => setForm({ ...form, flatTime: e.target.value })} placeholder="14:55" /></label>
            <label>单笔最大金额 ¥<input type="number" min="100" value={form.maxOrderAmount} onChange={(e) => setForm({ ...form, maxOrderAmount: Number(e.target.value) })} /></label>
            <label>日手续费上限 %<input type="number" step="0.1" min="0.01" max="5" value={feePct} onChange={(e) => setFeePct(Number(e.target.value))} /></label>
            <label className="auto-check"><input type="checkbox" checked={form.flattenEnabled} onChange={(e) => setForm({ ...form, flattenEnabled: e.target.checked })} /> 到点自动清仓并暂停</label>
          </div>
          <div className="auto-fee-preview">手续费上限约 ¥{((totalAsset * feePct) / 100).toFixed(2)} · 当前账户 ¥{totalAsset.toFixed(2)}</div>
          <div className="auto-settings-note">
            <ShieldAlert size={13} />
            <div>
              <b>会自动暂停的条件</b>
              <span>当日亏损达到上限 · 单次止损 · 日手续费达到/预计超过上限 · 调仓次数达到上限 · 到达收盘清仓时间 · 手工暂停 · 未确认委托/撤单未确认</span>
              <em>0 表示不限制：每日调仓次数 0 = 不限；止损 0 = 关闭自动止损；冷却 0 = 不等待。未确认委托和接口异常会等待/暂停，不会补单。</em>
            </div>
          </div>
          <div className="auto-settings-actions"><button type="button" className="quant-btn-primary" disabled={busy} onClick={() => void save()}><Save size={12} /> 保存参数</button></div>
        </>
      )}
    </Modal>
  )
}
