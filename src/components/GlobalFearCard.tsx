import { Globe2 } from 'lucide-react'
import type { Snapshot } from '../../shared/types'

export function GlobalFearCard({ snapshot }: { snapshot: Snapshot }) {
  const fear = snapshot.sentiment.foreignFear
  return (
    <section className={`global-fear-card ${fear ? `level-${fear.level}` : 'is-empty'}`}>
      <div className="global-fear-head">
        <span><Globe2 size={13} /> 海外恐慌</span>
        <em>{fear ? `${fear.level} · ${fear.score}/100` : '数据同步中'}</em>
      </div>
      {fear ? (
        <>
          <div className="global-fear-bar"><i style={{ width: `${fear.score}%` }} /></div>
          <div className="global-fear-grid">
            <div><span>VIX</span><b>{fear.vix != null ? fear.vix.toFixed(2) : '—'}</b><em className={fear.vixChangePct != null && fear.vixChangePct > 0 ? 'down' : 'up'}>{fear.vixChangePct != null ? `${fear.vixChangePct > 0 ? '+' : ''}${fear.vixChangePct.toFixed(1)}%` : '—'}</em></div>
            <div><span>美股期货</span><b className={fear.usFuturesPct != null && fear.usFuturesPct < 0 ? 'down' : 'up'}>{fear.usFuturesPct != null ? `${fear.usFuturesPct > 0 ? '+' : ''}${fear.usFuturesPct.toFixed(2)}%` : '—'}</b></div>
            <div><span>黄金</span><b className={fear.goldPct != null && fear.goldPct > 0 ? 'down' : 'up'}>{fear.goldPct != null ? `${fear.goldPct > 0 ? '+' : ''}${fear.goldPct.toFixed(2)}%` : '—'}</b></div>
            <div><span>离岸人民币</span><b>{fear.usdcnhPct != null ? `${fear.usdcnhPct > 0 ? '+' : ''}${fear.usdcnhPct.toFixed(2)}%` : '—'}</b></div>
            <div><span>韩国 KOSPI</span><b className={fear.kospiPct != null && fear.kospiPct < 0 ? 'down' : 'up'}>{fear.kospiPct != null ? `${fear.kospiPct > 0 ? '+' : ''}${fear.kospiPct.toFixed(2)}%` : '—'}</b></div>
            <div><span>日本 日经</span><b className={fear.nikkeiPct != null && fear.nikkeiPct < 0 ? 'down' : 'up'}>{fear.nikkeiPct != null ? `${fear.nikkeiPct > 0 ? '+' : ''}${fear.nikkeiPct.toFixed(2)}%` : '—'}</b></div>
          </div>
          <p>{fear.detail}</p>
        </>
      ) : <p>VIX、美股期货、黄金和离岸人民币数据同步后显示。</p>}
    </section>
  )
}
