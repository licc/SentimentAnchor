import { Anchor, LockKeyhole, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { login } from '../api'

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!token.trim()) {
      setError('请输入访问口令')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await login(token.trim())
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-mark"><Anchor size={26} /></div>
        <span className="login-eyebrow">SENTIMENT ANCHOR · PRIVATE WORKSPACE</span>
        <h1>情绪锚</h1>
        <p className="login-sub">A股实时监控台 · 需要访问口令</p>
        <div className="login-form">
          <label htmlFor="token"><LockKeyhole size={13} /> 访问口令</label>
          <input
            id="token"
            type="password"
            value={token}
            autoFocus
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
            placeholder="输入 APP_TOKEN"
          />
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit()}>
            <ShieldCheck size={14} /> {busy ? '验证中…' : '进入工作台'}
          </button>
        </div>
        {error ? <div className="login-error">{error}</div> : null}
        <div className="login-foot">服务端通过 APP_TOKEN 保护 API；未设置时仅本机可访问。</div>
      </div>
    </div>
  )
}
