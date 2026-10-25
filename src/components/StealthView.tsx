import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  Folder,
  MoreHorizontal,
  Moon,
  Search,
  Sun,
  Users,
} from 'lucide-react'

export function StealthView({
  onExit,
  theme,
  onToggleTheme,
}: {
  onExit: () => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}) {
  return (
    <div className={`stealth-page ${theme === 'dark' ? 'is-dark' : ''}`}>
      <header className="stealth-top">
        <div className="stealth-brand" onDoubleClick={onExit} title="">
          <span className="stealth-logo">档</span>
          <div>
            <b>研究档案</b>
            <small>RESEARCH ARCHIVE</small>
          </div>
        </div>
        <div className="stealth-top-center">
          <span>产品与增长</span>
          <i />
          <span>Q4 增长项目</span>
          <i />
          <span className="stealth-sync"><i className="stealth-live-dot" /> 最近同步 22:50</span>
        </div>
        <div className="stealth-top-actions">
          <button type="button" className="stealth-back" onClick={onExit} title="返回工作台">
            <ArrowLeft size={15} />
          </button>
          <button type="button" title="搜索"><Search size={15} /></button>
          <button type="button" title="通知"><Bell size={15} /></button>
          <button type="button" onClick={onToggleTheme} title="切换界面主题">
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <span className="stealth-avatar">LH</span>
        </div>
      </header>

      <div className="stealth-wrap">
        <div className="stealth-toolbar">
          <div className="stealth-crumb">
            <span>项目</span><i>/</i><span>产品与增长</span><i>/</i><b>Q4 增长项目</b>
          </div>
          <div className="stealth-toolbar-right">
            <span className="stealth-status">进行中</span>
            <span>仅团队可见</span>
            <span className="stealth-toolbar-sep" />
            <span>最近更新 22:50</span>
          </div>
        </div>

        <div className="stealth-grid">
          <main className="stealth-content">
            <section className="stealth-hero-card">
              <div className="stealth-doc-head">
                <div>
                  <div className="stealth-doc-kicker"><FileText size={12} /> 项目周报 · 第 8 周</div>
                  <h1>Q4 增长项目 · 第 8 周周报</h1>
                  <div className="stealth-meta">
                    <span className="stealth-doc-icon">周</span>
                    <span>负责人 李欢</span>
                    <i />
                    <span>2026-10-20 22:50</span>
                    <i />
                    <span>阅读约 6 分钟</span>
                    <i />
                    <span>6 人已读</span>
                  </div>
                </div>
                <div className="stealth-doc-actions">
                  <span className="stealth-status">进行中</span>
                  <button type="button" title="更多"><MoreHorizontal size={16} /></button>
                </div>
              </div>
              <div className="stealth-callout">
                本周重点：完成新用户转化链路的第二轮优化，激活率环比提升，实验组进入稳定观察期。
              </div>
            </section>

            <section className="stealth-panel">
              <div className="stealth-panel-head">
                <span className="stealth-panel-index">01</span>
                <h2 id="summary">本周摘要</h2>
                <small>SUMMARY</small>
              </div>
              <div className="stealth-panel-body">
                <p>
                  本周围绕“降低新用户首次关键行为门槛”推进三项工作：注册后引导流程重构、首日任务激励调整、
                  以及企业微信触达链路灰度。整体进度符合预期，核心指标较上周改善，但实验样本仍需继续累积。
                </p>
                <p>
                  与设计、数据团队完成两次评审；当前主要依赖埋点补充与客服侧反馈回收，预计下周中完成第一轮结论沉淀。
                </p>
                <div className="stealth-kpis">
                  <div><span>周新增激活</span><b>12,480</b><em>+8.6%</em></div>
                  <div><span>首日关键行为率</span><b>34.2%</b><em>+2.1pp</em></div>
                  <div><span>实验组转化率</span><b>7.8%</b><em>+0.9pp</em></div>
                  <div><span>项目进度</span><b>86%</b><em>按计划</em></div>
                </div>
              </div>
            </section>

            <section className="stealth-panel">
              <div className="stealth-panel-head">
                <span className="stealth-panel-index">02</span>
                <h2 id="progress">关键进展</h2>
                <small>PROGRESS</small>
              </div>
              <div className="stealth-panel-body">
                <div className="stealth-progress">
                  <div className="stealth-progress-row">
                    <span className="stealth-check">01</span>
                    <div><b>引导流程重构</b><p>完成 4 个关键步骤的精简，首屏加载时间下降 18%，已全量上线。</p></div>
                    <span className="stealth-chip">已完成</span>
                  </div>
                  <div className="stealth-progress-row">
                    <span className="stealth-check">02</span>
                    <div><b>首日任务激励</b><p>新版任务卡进入 30% 灰度，任务完成率提升 4.3pp，暂无负向反馈。</p></div>
                    <span className="stealth-chip is-doing">灰度中</span>
                  </div>
                  <div className="stealth-progress-row">
                    <span className="stealth-check">03</span>
                    <div><b>企微触达链路</b><p>完成模板审批与人群包配置，待数据侧确认归因口径后开启第二轮触达。</p></div>
                    <span className="stealth-chip is-wait">待开始</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="stealth-panel">
              <div className="stealth-panel-head">
                <span className="stealth-panel-index">03</span>
                <h2 id="risks">风险与依赖</h2>
                <small>RISKS</small>
              </div>
              <div className="stealth-panel-body">
                <table className="stealth-table">
                  <thead><tr><th>事项</th><th>影响</th><th>负责人</th><th>计划完成</th></tr></thead>
                  <tbody>
                    <tr><td>埋点字段补充</td><td>影响实验分群准确性</td><td>数据组</td><td>10-22</td></tr>
                    <tr><td>客服反馈回收</td><td>影响体验问题优先级</td><td>运营组</td><td>10-23</td></tr>
                    <tr><td>触达模板审批</td><td>影响第二轮灰度时间</td><td>增长组</td><td>10-24</td></tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section className="stealth-panel">
              <div className="stealth-panel-head">
                <span className="stealth-panel-index">04</span>
                <h2 id="next">下周计划</h2>
                <small>NEXT WEEK</small>
              </div>
              <div className="stealth-panel-body">
                <ul className="stealth-list">
                  <li>完成灰度实验第一轮数据复盘，输出实验结论与下一步建议。</li>
                  <li>补齐新用户路径的 6 个关键埋点，统一数据看板口径。</li>
                  <li>与客服团队完成 10 个典型用户访谈，整理体验问题清单。</li>
                </ul>
                <div className="stealth-comment">
                  <span className="stealth-comment-avatar">W</span>
                  <div><b>王敏</b><span>10-20 18:26</span><p>收到，埋点部分我这边明天上午同步一版字段清单。</p></div>
                </div>
              </div>
            </section>

            <div className="stealth-doc-foot">最后编辑：李欢 · 2026-10-20 22:50 · 仅团队成员可见</div>
          </main>

          <aside className="stealth-aside">
            <div className="stealth-side-card">
              <div className="stealth-side-card-head"><span><FileText size={12} /> 文档信息</span></div>
              <div className="stealth-info-row"><span>负责人</span><b>李欢</b></div>
              <div className="stealth-info-row"><span>协作人</span><b>王敏、陈默</b></div>
              <div className="stealth-info-row"><span>所属项目</span><b>Q4 增长项目</b></div>
              <div className="stealth-info-row"><span>更新时间</span><b>10-20 22:50</b></div>
              <div className="stealth-info-tags"><span>增长</span><span>周报</span><span>实验</span></div>
            </div>

            <div className="stealth-side-card">
              <div className="stealth-side-card-head">
                <span><Clock3 size={12} /> 本文目录</span>
                <ChevronDown size={12} />
              </div>
              <a href="#summary">本周摘要</a>
              <a href="#progress">关键进展</a>
              <a href="#risks">风险与依赖</a>
              <a href="#next">下周计划</a>
              <div className="stealth-side-divider" />
              <div className="stealth-read-note"><CheckCircle2 size={11} /> 已同步到团队空间</div>
            </div>

            <div className="stealth-side-card">
              <div className="stealth-side-card-head"><span><Folder size={12} /> 相关文档</span></div>
              <a href="#summary" className="stealth-related"><FileText size={12} /><span>10 月运营复盘<small>10-18</small></span></a>
              <a href="#progress" className="stealth-related"><FileText size={12} /><span>新用户路径实验记录<small>10-16</small></span></a>
              <a href="#risks" className="stealth-related"><AlertTriangle size={12} /><span>Q4 风险登记表<small>10-14</small></span></a>
            </div>

            <div className="stealth-side-card stealth-team">
              <div className="stealth-side-card-head"><span><Users size={12} /> 项目成员</span></div>
              <div className="stealth-avatars"><i>LH</i><i>WM</i><i>CM</i><i>+3</i></div>
              <div className="stealth-read-note"><CalendarDays size={11} /> 周会：每周一 10:00</div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
