import { AlertCircle, Plus, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { EtfRole, EtfStrategyConfig } from '../../shared/types'
import { getEtfConfig, resetEtfConfig, saveEtfConfig } from '../api'
import { Modal } from './Modals'

const ROLE_LABEL: Record<EtfRole, string> = {
  risk: '风险 / 进攻',
  hedge: '对冲 / 黄金',
  defensive: '防守 / 国债',
  cash: '现金类',
}

interface Row { code: string; role: EtfRole }

export function EtfConfigModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function apply(cfg: EtfStrategyConfig) {
    setRows(cfg.universe.map((x) => ({ code: x.code, role: x.role })))
  }

  useEffect(() => {
    getEtfConfig()
      .then(apply)
      .catch((err) => setError(err instanceof Error ? err.message : '读取 ETF 池失败'))
      .finally(() => setLoading(false))
  }, [])

  function update(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function addRow() {
    if (rows.length >= 12) {
      setError('ETF 池最多 12 只')
      return
    }
    setRows((prev) => [...prev, { code: '', role: 'risk' }])
  }

  async function save() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const cfg = await saveEtfConfig(rows)
      apply(cfg)
      setNotice('ETF 池已保存，下一次刷新生效')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    setBusy(true)
    setError(null)
    try {
      const cfg = await resetEtfConfig()
      apply(cfg)
      setNotice('已恢复默认 T+0 ETF 池')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="ETF 池设置"
      subtitle="只允许 6 位代码；请自行确认标的 T+0 资格和流动性"
      onClose={onClose}
      width={680}
    >
      <div className="etf-config-note">
        <ShieldCheck size={13} />
        <span>角色决定情绪信号的目标：风险角色用于进攻，对冲/防守用于风险收缩，现金角色用于观望。最多 12 只。</span>
      </div>

      {loading ? <div className="etf-empty">读取 ETF 池…</div> : (
        <div className="etf-config-rows">
          <div className="etf-config-head"><span>代码</span><span>角色</span><span /></div>
          {rows.map((row, i) => (
            <div className="etf-config-row" key={i}>
              <input
                value={row.code}
                inputMode="numeric"
                maxLength={6}
                placeholder="例如 513100"
                onChange={(e) => update(i, { code: e.target.value.replace(/\D/g, '').slice(0, 6) })}
              />
              <select value={row.role} onChange={(e) => update(i, { role: e.target.value as EtfRole })}>
                {(Object.keys(ROLE_LABEL) as EtfRole[]).map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
              </select>
              <button type="button" className="etf-config-remove" onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))} disabled={rows.length <= 1} title="删除">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button type="button" className="etf-config-add" onClick={addRow} disabled={rows.length >= 12}>
            <Plus size={12} /> 添加一只
          </button>
        </div>
      )}

      {error ? <div className="form-error"><AlertCircle size={13} /> {error}</div> : null}
      {notice ? <div className="import-status"><ShieldCheck size={13} /> {notice}</div> : null}

      <div className="etf-config-actions">
        <button type="button" className="ai-btn ai-btn-deep" onClick={() => void save()} disabled={busy || loading}>保存 ETF 池</button>
        <button type="button" className="ai-btn" onClick={() => void reset()} disabled={busy || loading}><RotateCcw size={12} /> 恢复默认</button>
      </div>
      <div className="modal-note">
        修改只影响行情、信号和模拟，不会下真实委托。代码错误或非 T+0 标的由使用者自行承担。
      </div>
    </Modal>
  )
}
