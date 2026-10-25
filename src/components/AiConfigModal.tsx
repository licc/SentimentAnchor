import { AlertCircle, CheckCircle2, KeyRound, Loader2, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AiConfigPublic, AiTestResult } from '../../shared/types'
import { clearAiConfig, fetchAiModels, getAiConfig, saveAiConfig, testAiConnection } from '../api'
import { Modal } from './Modals'

const DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  custom: { baseUrl: '', model: 'deepseek-chat' },
}

export function AiConfigModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [config, setConfig] = useState<AiConfigPublic | null>(null)
  const [provider, setProvider] = useState('deepseek')
  const [baseUrl, setBaseUrl] = useState(DEFAULTS.deepseek.baseUrl)
  const [model, setModel] = useState(DEFAULTS.deepseek.model)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [test, setTest] = useState<AiTestResult | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [manualModel, setManualModel] = useState(false)
  const readonly = config?.source === 'env'

  useEffect(() => {
    getAiConfig()
      .then((cfg) => {
        setConfig(cfg)
        setProvider(cfg.provider || 'deepseek')
        setBaseUrl(cfg.baseUrl || DEFAULTS.deepseek.baseUrl)
        setModel(cfg.model || DEFAULTS.deepseek.model)
      })
      .catch((err) => setError(err instanceof Error ? err.message : '读取 AI 配置失败'))
  }, [])

  function chooseProvider(next: string) {
    setProvider(next)
    setModels([])
    setManualModel(false)
    if (next !== 'custom') {
      setBaseUrl(DEFAULTS[next].baseUrl)
      if (!model || Object.values(DEFAULTS).some((d) => d.model === model)) setModel(DEFAULTS[next].model)
    }
  }

  async function save() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const cfg = await saveAiConfig({ provider, baseUrl, model, apiKey: apiKey || undefined })
      setConfig(cfg)
      setApiKey('')
      setNotice('配置已保存，Key 只在服务端保存，不会回传浏览器')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  async function loadModels() {
    setModelsLoading(true)
    setError(null)
    setTest(null)
    try {
      const result = await fetchAiModels({ provider, baseUrl, model, apiKey: apiKey || undefined })
      setModels(result.models)
      if (!result.ok) {
        setError(result.message)
      } else if (result.models.length) {
        setManualModel(false)
        if (!result.models.includes(model)) {
          setModel(result.models[0])
          setNotice(`已获取 ${result.models.length} 个模型，当前模型不在列表中，已切换到 ${result.models[0]}`)
        } else {
          setNotice(result.message)
        }
      } else {
        setNotice(result.message || '服务商没有返回模型，可手动输入模型名')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取模型失败')
    } finally {
      setModelsLoading(false)
    }
  }

  async function runTest() {
    setTesting(true)
    setError(null)
    setTest(null)
    try {
      const result = await testAiConnection({ provider, baseUrl, model, apiKey: apiKey || undefined })
      setTest(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : '测试失败')
    } finally {
      setTesting(false)
    }
  }

  async function clear() {
    setBusy(true)
    setError(null)
    try {
      const cfg = await clearAiConfig()
      setConfig(cfg)
      setApiKey('')
      setNotice('服务端保存的 Key 已清除')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : '清除失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="AI 深度研判配置" subtitle="配置后，“LLM 深度研判”按钮启用；Key 只保存在服务端 data/ai-config.json" onClose={onClose} width={620}>
      <div className={`ai-config-state ${config?.configured ? 'is-on' : ''}`}>
        {config?.configured ? <CheckCircle2 size={14} /> : <KeyRound size={14} />}
        <div>
          <b>{config?.configured ? '已配置' : '尚未配置 API Key'}</b>
          <span>
            {config?.configured
              ? `${config.source === 'env' ? '环境变量' : '服务端文件'} · ${config.provider} / ${config.model} · ${config.masked}`
              : '未配置时只能使用本地量化推理，不会调用外部大模型'}
          </span>
        </div>
      </div>

      {readonly ? (
        <div className="ai-config-readonly">当前由环境变量提供配置，界面不可覆盖。请修改 <code>.env</code> 后重启服务。</div>
      ) : (
        <>
          <div className="ai-config-form">
            <label>
              <span>服务商</span>
              <select value={provider} onChange={(e) => chooseProvider(e.target.value)}>
                <option value="deepseek">DeepSeek</option>
                <option value="openai">OpenAI</option>
                <option value="custom">自定义 OpenAI 兼容接口</option>
              </select>
            </label>
            <label>
              <span>Base URL</span>
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com/v1" />
            </label>
            <label>
              <span>模型</span>
              <div className="ai-model-row">
                {models.length > 0 && !manualModel ? (
                  <select value={model} onChange={(e) => { setModel(e.target.value); setTest(null) }}>
                    {!models.includes(model) ? <option value={model}>{model}（当前）</option> : null}
                    {models.map((m) => <option value={m} key={m}>{m}</option>)}
                  </select>
                ) : (
                  <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" />
                )}
                <button type="button" className="ai-btn" onClick={() => void loadModels()} disabled={modelsLoading}>
                  {modelsLoading ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />} 获取模型
                </button>
              </div>
              {models.length > 0 ? (
                <div className="ai-model-hint">
                  <span>已获取 {models.length} 个模型，可直接下拉选择</span>
                  <button type="button" onClick={() => setManualModel((v) => !v)}>
                    {manualModel ? '返回列表' : '手动输入'}
                  </button>
                </div>
              ) : null}
            </label>
            <label>
              <span>API Key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={config?.configured ? '已保存，留空则不修改' : 'sk-...'}
                autoComplete="new-password"
              />
            </label>
          </div>
          <div className="ai-config-actions">
            <button type="button" className="ai-btn ai-btn-deep" onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 size={12} className="spin" /> : <ShieldCheck size={12} />} 保存配置
            </button>
            <button type="button" className="ai-btn" onClick={() => void runTest()} disabled={testing || !config?.configured}>
              {testing ? <Loader2 size={12} className="spin" /> : null} 测试连接
            </button>
            {config?.source === 'file' ? (
              <button type="button" className="ai-btn ai-btn-danger" onClick={() => void clear()} disabled={busy}>
                <Trash2 size={12} /> 清除 Key
              </button>
            ) : null}
          </div>
        </>
      )}

      {notice ? <div className="import-status"><CheckCircle2 size={13} /> {notice}</div> : null}
      {test ? (
        <div className={`ai-test-result ${test.ok ? 'is-ok' : 'is-error'}`}>
          <b>{test.ok ? '连接成功' : '连接失败'}</b>
          <span>{test.ok ? `${test.model} · ${test.latencyMs}ms · ${test.message}` : test.message}</span>
        </div>
      ) : null}
      {error ? <div className="form-error"><AlertCircle size={13} /> {error}</div> : null}
      <div className="modal-note">
        <ShieldCheck size={12} /> Key 不会出现在前端代码、接口响应或 Git 中；保存文件权限为 600。测试会发起一次最小模型请求。
      </div>
      <div className="modal-foot-note">也可以使用 .env：LLM_API_KEY / LLM_BASE_URL / LLM_MODEL，环境变量优先。</div>
    </Modal>
  )
}
