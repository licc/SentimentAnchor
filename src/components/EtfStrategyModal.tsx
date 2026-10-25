import { Modal } from './Modals'
import type { EtfStrategyRules, EtfUniverseItem, ForeignFear } from '../../shared/types'
import { useEtfAutoConfig } from '../hooks/useEtfAutoConfig'
import { useEtfFees } from '../hooks/useEtfFees'

export function EtfStrategyModal({ rules, universe, foreignFear, onClose }: {
  rules: EtfStrategyRules
  universe: EtfUniverseItem[]
  foreignFear?: ForeignFear | null
  onClose: () => void
}) {
  const auto = useEtfAutoConfig()
  const fees = useEtfFees()
  const fear = foreignFear
  return (
    <Modal title="T+0 交易策略" subtitle="当前自动执行实际使用的规则；不是收益承诺" onClose={onClose} width={760}>
      <article className="strategy-doc">
        <h3>情绪锚 · T+0 ETF 情绪轮动</h3>
        <p>只交易 T+0 ETF 池，用市场情绪阶段决定进攻/防守，账户资金和 T+1 量化共用，但交易规则独立。</p>

        <h4>1. 市场环境</h4>
        <ul>
          <li>情绪分数 ≥ <b>{rules.riskOnScore}</b>：修复/发酵/高潮，进入进攻观察。</li>
          <li>情绪分数 &lt; <b>{rules.riskOffScore}</b> 或退潮/冰点：进入防守，优先黄金/现金。</li>
          <li>海外恐慌分：当前 <b>{fear ? `${fear.score} · ${fear.level}` : '同步中'}</b>，高恐慌时降低风险偏好。</li>
        </ul>

        <h4>2. 选池</h4>
        <p>系统按 20 日波动、成交额、tick 成本、当日相对强弱选出 T+0 ETF：</p>
        <div className="strategy-doc-chips">{universe.map((u) => <span key={u.code}>{u.code} · {u.role}</span>)}</div>
        <p>只做 T+0 可当日买卖的 ETF；不会把 T+1 股票放进这个池。</p>

        <h4>3. 目标与仓位</h4>
        <ul>
          <li>进攻：选池内相对强势风险 ETF。</li>
          <li>退潮/冰点：转向黄金/防守 ETF。</li>
          <li>方向不明：空仓等待，不强行交易。</li>
          <li>仓位：按信号强度最高 <b>{Math.round(rules.maxPositionPct * 100)}%</b>，按 100 股整手。</li>
        </ul>

        <h4>4. 风控与暂停</h4>
        <ul>
          <li>账户级/单持仓止损：<b>-{rules.stopLossPct}%</b>（止损优先使用系统成交买入价）。</li>
          <li>每日最大调仓：<b>{auto.config?.maxSwitchesPerDay ?? rules.maxSwitchesPerDay}</b> 次；冷却 <b>{auto.config?.cooldownSec ?? rules.cooldownSec}s</b>。</li>
          <li>当日最大亏损：<b>-{auto.config?.maxDailyLossPct ?? 2}%</b>。</li>
          <li>日手续费上限：<b>{fees.settings ? `${fees.settings.maxDailyFeePct}%` : '—'}</b>（以自动参数页为准）。</li>
          <li>收盘清仓：<b>{rules.flatTime}</b>，默认清仓后暂停。</li>
        </ul>

        <h4>5. 执行边界</h4>
        <ul>
          <li>所有委托走统一券商通道和串行指令队列。</li>
          <li>超时未知委托：持仓 → 委托 → 持仓差 核对，30/60/120/300 秒梯度重试，不补单。</li>
          <li>非交易时段不新开仓；接口异常等待恢复。</li>
          <li>本策略仅记录个人交易，不构成投资建议。</li>
        </ul>

        <h4>T+1 策略在哪</h4>
        <p>T+1 股票使用独立的「策略库」Tab，文字定义、模型解析、回测和启用，不在 T+0 规则里。</p>
      </article>
    </Modal>
  )
}
