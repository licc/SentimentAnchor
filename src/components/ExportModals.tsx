import { AlertCircle, Download, FileJson, FileSpreadsheet, Upload, Star } from 'lucide-react'
import { useRef, useState } from 'react'
import type { CalendarPayload, Snapshot } from '../../shared/types'
import { downloadText, toCsv } from '../lib/download'
import { Modal } from './Modals'

export function ExportModal({
  snapshot,
  calendar,
  onClose,
}: {
  snapshot: Snapshot
  calendar: CalendarPayload | null
  onClose: () => void
}) {
  const date = snapshot.tradingDate
  function exportSnapshot() {
    downloadText(`sentiment-anchor-${date}.json`, JSON.stringify(snapshot, null, 2))
  }
  function exportAnchors() {
    const rows: Array<Array<string | number>> = [
      ['角色', '代码', '名称', '涨跌幅', '价格', '标签', '理由'],
      ...snapshot.anchors.map((a) => [a.role, a.stock.code, a.stock.name, `${a.stock.pct}%`, a.stock.price, a.stock.tags.join(' / '), a.reason]),
    ]
    downloadText(`sentiment-anchors-${date}.csv`, toCsv(rows), 'text/csv;charset=utf-8')
  }
  function exportCalendar() {
    const rows: Array<Array<string | number>> = [
      ['日期', '阶段', '近似分', '涨停', '跌停', '空间高度', '主线', '上证涨跌', '成交额'],
      ...(calendar?.days ?? []).map((d) => [d.date, d.stage, d.score, d.limitUp, d.limitDown, d.maxBoard, d.topTheme, `${d.indexPct}%`, d.amount]),
    ]
    downloadText(`sentiment-calendar-${date}.csv`, toCsv(rows), 'text/csv;charset=utf-8')
  }
  const items = [
    { icon: <FileJson size={16} />, title: '完整快照 JSON', desc: '包含指数、广度、锚点、规则、AI 研判等全部字段', action: exportSnapshot, label: '下载 JSON' },
    { icon: <FileSpreadsheet size={16} />, title: '情绪锚 CSV', desc: '9 个锚点 + 盘口理由，适合导入表格复盘', action: exportAnchors, label: '下载 CSV' },
    { icon: <FileSpreadsheet size={16} />, title: '周期日历 CSV', desc: '最近 14 个交易日的涨停池、阶段与主线', action: exportCalendar, label: '下载 CSV' },
  ]
  return (
    <Modal title="导出与保存" subtitle="当前快照可直接保存为离线复盘文件" onClose={onClose} width={620}>
      <div className="export-list">
        {items.map((it) => (
          <div className="export-row" key={it.title}>
            <span className="export-icon">{it.icon}</span>
            <div className="export-main">
              <b>{it.title}</b>
              <p>{it.desc}</p>
            </div>
            <button type="button" className="ai-btn" onClick={it.action}>
              <Download size={12} /> {it.label}
            </button>
          </div>
        ))}
      </div>
      <div className="modal-note"><Download size={12} /> 导出文件只包含当前运行时快照，不包含任何 API Key。</div>
    </Modal>
  )
}

export function ImportModal({
  onImport,
  onClose,
}: {
  onImport: (codes: string[]) => Promise<void>
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<string[]>([])

  async function readFile(file: File) {
    setError(null)
    setStatus(null)
    try {
      const text = await file.text()
      let parsed: any
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error('文件不是合法 JSON')
      }
      const candidates: unknown[] = Array.isArray(parsed)
        ? parsed
        : parsed.watchlist ?? parsed.codes ?? parsed.stocks ?? []
      const codes = [...new Set((Array.isArray(candidates) ? candidates : [])
        .map((x) => typeof x === 'string' ? x : (x as any)?.code)
        .map(String)
        .filter((c) => /^\d{6}$/.test(c)))]
      if (!codes.length) throw new Error('文件中没有找到 6 位股票代码（支持 codes / watchlist 数组）')
      setPending(codes)
      setStatus(`已解析 ${codes.length} 只：${codes.join(', ')}`)
    } catch (err) {
      setPending([])
      setError(err instanceof Error ? err.message : '解析失败')
    }
  }

  async function apply() {
    if (!pending.length) return
    setBusy(true)
    try {
      await onImport(pending)
      setStatus(`已导入 ${pending.length} 只自选`)
      setTimeout(onClose, 700)
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="导入自选 / 复盘配置" subtitle="支持导出的自选 JSON，也支持 { codes: [...] } 格式" onClose={onClose} width={600}>
      <div
        className="import-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const f = e.dataTransfer.files?.[0]
          if (f) void readFile(f)
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.click() }}
      >
        <Upload size={24} />
        <b>点击选择或拖入 JSON 文件</b>
        <span>支持 {`{ "codes": ["600519"] }`} 或 {`{ "watchlist": [...] }`}</span>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void readFile(f)
          }}
        />
      </div>
      {status ? <div className="import-status"><Star size={13} /> {status}</div> : null}
      {error ? <div className="form-error"><AlertCircle size={13} /> {error}</div> : null}
      {pending.length ? (
        <div className="import-actions">
          <span>导入后会替换当前自选池</span>
          <button type="button" className="ai-btn ai-btn-deep" onClick={() => void apply()} disabled={busy}>
            {busy ? '导入中…' : `确认导入 ${pending.length} 只`}
          </button>
        </div>
      ) : null}
      <div className="modal-foot-note">导入只影响自选池，不会修改行情数据，也不会执行交易。</div>
    </Modal>
  )
}
