import { RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { generatePreopen, getPreopen } from '../api'
import { timeOf } from '../lib/format'

type Review = Awaited<ReturnType<typeof getPreopen>>
export function PreopenReviewBar() {
  const [review, setReview] = useState<Review | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function load() { try { setReview(await getPreopen()); setError(null) } catch (err) { setError(err instanceof Error ? err.message : '盘前候选未生成') } }
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { void load() }, 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  const generated = review ? new Date(review.generatedAt) : null
  const minutes = generated ? Number(generated.toLocaleTimeString('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }).replace(':', '')) : 0
  const inWindow = minutes >= 920 && minutes <= 940
  const label = review && review.date !== today ? `历史候选 · ${review.date}` : inWindow ? '盘前候选 · 9:27' : '盘前候选 · 非窗口生成'
  async function generate() { setBusy(true); try { setReview(await generatePreopen()); setError(null) } catch (err) { setError(err instanceof Error ? err.message : '生成失败') } finally { setBusy(false) } }
  return (
    <div className="preopen-bar">
      <div className="preopen-head"><span><Sparkles size={12} /> {label}</span>{review ? <em>{review.stage} · {review.sentimentScore} 分 · 外围 {review.foreignFear ?? '—'} · {timeOf(review.generatedAt)}</em> : <em>{error ?? '尚未生成'}</em>}<button type="button" className="quant-btn-quiet" disabled={busy} onClick={() => void generate()}><RefreshCw size={11} /> 生成</button></div>
      {review?.items.length ? <div className="preopen-items">{review.items.map((x) => <div className="preopen-item" key={x.code}><b>{x.name}</b><small>{x.code} · {x.pct > 0 ? '+' : ''}{x.pct.toFixed(2)}%</small><em>{x.reason || x.theme || x.source}</em><span>{x.score}</span><small className={x.affordable ? 'ok' : 'no'}>100股 ¥{x.estimatedCost}{x.affordable ? '' : ' · 额度不足'}</small></div>)}</div> : <div className="preopen-empty">{review?.note ?? '点击生成盘前候选；只提供人工观察，不自动下单。'}</div>}
    </div>
  )
}
