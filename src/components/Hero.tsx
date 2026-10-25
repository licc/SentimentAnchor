import { Crosshair, Sparkles, Target, Zap } from 'lucide-react'
import type { Snapshot } from '../../shared/types'
import { fmtAmount, fmtAmountDelta, fmtSigned, riskTone, stageTone } from '../lib/format'

function volumeChangeText(breadth: { amountDiff: number | null; amountChangePct: number | null }): string {
  if (breadth.amountChangePct == null || breadth.amountDiff == null) return '—'
  return `同时段${breadth.amountDiff >= 0 ? '放量' : '缩量'} ${fmtAmountDelta(breadth.amountDiff)} / ${Math.abs(breadth.amountChangePct).toFixed(2)}%`
}

export function Hero({ snapshot }: { snapshot: Snapshot }) {
  const { headline, sentiment, breadth, phase } = snapshot
  const [primary, secondary] = headline.title.split('｜')
  const tone = stageTone(sentiment.stage)
  return (
    <section className={`hero tone-${tone}`}>
      <div className="hero-grid-bg" aria-hidden />
      <div className="hero-watermark" aria-hidden>
        ANCHOR
      </div>
      <div className="hero-grid">
        <div className="hero-main">
          <div className="hero-kicker">
            <span className="hero-emblem">
              <Crosshair size={13} />
              情绪定调
            </span>
            <span className={`stage-pill tone-${tone}`}>{sentiment.stage}</span>
            <span className="hero-phase">{phase.time} · {phase.short}</span>
            <span className="hero-confidence">规则引擎置信度 {sentiment.confidence}%</span>
          </div>
          <h1>
            {primary}
            {secondary ? <em>｜{secondary}</em> : null}
          </h1>
          <p className="hero-summary">{headline.summary}</p>
          <div className="hero-metrics">
            <div className="hero-metric">
              <span className="hm-label">情绪温度</span>
              <span className="hm-value mono">
                {sentiment.score}
                <small>/100</small>
              </span>
              <span className={`hm-trend tone-text-${sentiment.trend >= 0 ? 'up' : 'down'}`}>
                {sentiment.trend >= 0 ? '↗' : '↘'} {fmtSigned(sentiment.trend, 1)}
              </span>
            </div>
            <div className="hero-metric">
              <span className="hm-label">涨停 / 跌停</span>
              <span className="hm-value mono">
                {breadth.limitUp}
                <small className="slash">/</small>
                <b className="down">{breadth.limitDown}</b>
              </span>
            </div>
            <div className="hero-metric">
              <span className="hm-label">上涨 / 下跌</span>
              <span className="hm-value mono">
                {breadth.rise}
                <small className="slash">/</small>
                <b className="down">{breadth.fall}</b>
              </span>
            </div>
            <div className="hero-metric">
              <span className="hm-label">空间高度</span>
              <span className="hm-value mono">
                {sentiment.height}
                <small>板</small>
              </span>
            </div>
            <div className="hero-metric">
              <span className="hm-label" title="沪深两市成交额，不含北交所">两市成交</span>
              <span className="hm-value mono hm-amount">{fmtAmount(breadth.amount)}</span>
              <span className={`hm-trend tone-text-${(breadth.amountChangePct ?? 0) >= 0 ? 'up' : 'down'}`} title={`较昨日 ${breadth.amountWindow ?? ''} 同时段`}>
                {volumeChangeText(breadth)}
              </span>
            </div>
          </div>
        </div>

        <aside className="hero-aside">
          <div className="aside-head">
            <span>
              <Zap size={14} /> 盘面应对
            </span>
            <span className={`risk-badge tone-${riskTone(sentiment.risk)}`}>风险 {sentiment.risk}</span>
          </div>
          <p className="aside-action">{headline.action}</p>
          <div className="aside-rule" />
          <div className="aside-confirm">
            <span className="aside-label">
              <Target size={12} /> 次日确认
            </span>
            <p>{headline.confirm}</p>
          </div>
          <div className="aside-foot">
            <span>
              <Sparkles size={12} /> 周期位置
            </span>
            <b>{sentiment.label}</b>
            <span className="mono">{phase.state === 'active' ? 'LIVE' : 'SNAPSHOT'}</span>
          </div>
        </aside>
      </div>
    </section>
  )
}
