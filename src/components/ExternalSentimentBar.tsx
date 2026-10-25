import { Globe2 } from 'lucide-react'
import type { ForeignFear } from '../../shared/types'
import { timeOf } from '../lib/format'

export function ExternalSentimentBar({ fear }: { fear?: ForeignFear | null }) {
  if (!fear) {
    return (
      <div className="external-sentiment-bar is-empty">
        <span className="external-sentiment-title"><Globe2 size={12} /> 外围情绪</span>
        <em>VIX / 美股期货 / 黄金 / 离岸人民币同步中</em>
      </div>
    )
  }
  return (
    <div className={`external-sentiment-bar level-${fear.level}`}>
      <span className="external-sentiment-title"><Globe2 size={12} /> 外围情绪</span>
      <span className="external-sentiment-score"><b>{fear.score}</b><em>{fear.level} · /100</em></span>
      <span className="external-sentiment-metric">VIX <b>{fear.vix != null ? fear.vix.toFixed(2) : '—'}</b><em className={fear.vixChangePct != null && fear.vixChangePct > 0 ? 'down' : 'up'}>{fear.vixChangePct != null ? `${fear.vixChangePct > 0 ? '+' : ''}${fear.vixChangePct.toFixed(2)}%` : '—'}</em></span>
      <span className="external-sentiment-metric">美股期货 <b className={fear.usFuturesPct != null && fear.usFuturesPct < 0 ? 'down' : 'up'}>{fear.usFuturesPct != null ? `${fear.usFuturesPct > 0 ? '+' : ''}${fear.usFuturesPct.toFixed(2)}%` : '—'}</b></span>
      <span className="external-sentiment-metric">黄金 <b className={fear.goldPct != null && fear.goldPct > 0 ? 'down' : 'up'}>{fear.goldPct != null ? `${fear.goldPct > 0 ? '+' : ''}${fear.goldPct.toFixed(2)}%` : '—'}</b></span>
      <span className="external-sentiment-metric">离岸人民币 <b>{fear.usdcnhPct != null ? `${fear.usdcnhPct > 0 ? '+' : ''}${fear.usdcnhPct.toFixed(2)}%` : '—'}</b></span>
      <span className="external-sentiment-metric">韩国 KOSPI <b className={fear.kospiPct != null && fear.kospiPct < 0 ? 'down' : 'up'}>{fear.kospiPct != null ? `${fear.kospiPct > 0 ? '+' : ''}${fear.kospiPct.toFixed(2)}%` : '—'}</b></span>
      <span className="external-sentiment-metric">日本 日经 <b className={fear.nikkeiPct != null && fear.nikkeiPct < 0 ? 'down' : 'up'}>{fear.nikkeiPct != null ? `${fear.nikkeiPct > 0 ? '+' : ''}${fear.nikkeiPct.toFixed(2)}%` : '—'}</b></span>
      <span className="external-sentiment-bar-track"><i style={{ width: `${fear.score}%` }} /></span>
      <em className="external-sentiment-detail">{fear.detail} · 更新 {timeOf(fear.updatedAt)}</em>
    </div>
  )
}
