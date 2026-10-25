import fs from 'node:fs'
import path from 'node:path'
import type { AiConfigPublic, AiModelsResult, AiTestResult } from '../../shared/types.js'
import { atomicWriteJson } from '../lib/atomic.js'

const DIR = path.join(process.cwd(), 'data')
const FILE = path.join(DIR, 'ai-config.json')

interface Stored {
  apiKey: string
  baseUrl: string
  model: string
  provider: string
  updatedAt: string
}

export interface ResolvedLlm {
  key: string
  baseUrl: string
  model: string
  provider: string
  source: 'env' | 'file'
}

const PROVIDERS: Record<string, { baseUrl: string; model: string }> = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  custom: { baseUrl: '', model: 'deepseek-chat' },
}

let stored: Stored | null = load()

function envConfig(): ResolvedLlm | null {
  const key = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || ''
  if (!key) return null
  let baseUrl = process.env.LLM_BASE_URL
  let provider = 'custom'
  let model = process.env.LLM_MODEL
  if (!baseUrl) {
    if (process.env.DEEPSEEK_API_KEY) {
      baseUrl = PROVIDERS.deepseek.baseUrl
      provider = 'deepseek'
      model = model || PROVIDERS.deepseek.model
    } else {
      baseUrl = PROVIDERS.openai.baseUrl
      provider = 'openai'
      model = model || PROVIDERS.openai.model
    }
  }
  return {
    key,
    baseUrl: normalizeBaseUrl(baseUrl),
    model: model || 'deepseek-chat',
    provider,
    source: 'env',
  }
}

export function getResolvedLlmConfig(): ResolvedLlm | null {
  const env = envConfig()
  if (env) return env
  if (stored?.apiKey) {
    return {
      key: stored.apiKey,
      baseUrl: normalizeBaseUrl(stored.baseUrl),
      model: stored.model,
      provider: stored.provider,
      source: 'file',
    }
  }
  return null
}

export function publicAiConfig(): AiConfigPublic {
  const env = envConfig()
  if (env) {
    return {
      configured: true,
      source: 'env',
      provider: env.provider,
      baseUrl: env.baseUrl,
      model: env.model,
      masked: maskKey(env.key),
    }
  }
  if (stored?.apiKey) {
    return {
      configured: true,
      source: 'file',
      provider: stored.provider,
      baseUrl: stored.baseUrl,
      model: stored.model,
      masked: maskKey(stored.apiKey),
    }
  }
  return { configured: false, source: 'none', provider: 'deepseek', baseUrl: PROVIDERS.deepseek.baseUrl, model: PROVIDERS.deepseek.model, masked: '' }
}

export function saveAiConfig(input: {
  apiKey?: string
  baseUrl?: string
  model?: string
  provider?: string
}): AiConfigPublic {
  if (envConfig()) throw new Error('当前由环境变量配置，请修改 .env 并重启服务')
  const provider = ['deepseek', 'openai', 'custom'].includes(String(input.provider)) ? String(input.provider) : 'deepseek'
  const key = String(input.apiKey ?? '').trim() || stored?.apiKey || ''
  if (!key) throw new Error('请填写 API Key')
  const baseUrl = normalizeBaseUrl(String(input.baseUrl ?? '').trim() || PROVIDERS[provider].baseUrl || stored?.baseUrl || '')
  if (!baseUrl) throw new Error('自定义服务商必须填写 Base URL')
  const model = String(input.model ?? '').trim() || PROVIDERS[provider].model || stored?.model || 'deepseek-chat'
  stored = { apiKey: key, baseUrl, model, provider, updatedAt: new Date().toISOString() }
  atomicWriteJson(FILE, stored)
  try {
    fs.chmodSync(FILE, 0o600)
  } catch {
    // best effort
  }
  return publicAiConfig()
}

export function clearAiConfig(): AiConfigPublic {
  if (envConfig()) throw new Error('当前由环境变量配置，请修改 .env 并重启服务')
  stored = null
  try {
    if (fs.existsSync(FILE)) fs.unlinkSync(FILE)
  } catch {
    // best effort
  }
  return publicAiConfig()
}

interface Overrides {
  apiKey?: string
  baseUrl?: string
  model?: string
  provider?: string
}

function resolveForRequest(input?: Overrides): ResolvedLlm {
  const base = getResolvedLlmConfig()
  const key = String(input?.apiKey ?? '').trim() || base?.key
  if (!key) throw new Error('尚未配置 API Key')
  const provider = String(input?.provider ?? base?.provider ?? 'deepseek')
  const baseUrl = normalizeBaseUrl(String(input?.baseUrl ?? '').trim() || base?.baseUrl || PROVIDERS[provider]?.baseUrl || '')
  const model = String(input?.model ?? '').trim() || base?.model || PROVIDERS[provider]?.model || 'deepseek-chat'
  return { key, baseUrl, model, provider, source: base?.source ?? 'file' }
}

export async function listAiModels(input?: Overrides): Promise<AiModelsResult> {
  const cfg = resolveForRequest(input)
  const started = Date.now()
  const response = await fetch(`${cfg.baseUrl}/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${cfg.key}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  if (!response.ok) {
    return { ok: false, models: [], message: `HTTP ${response.status} ${text.slice(0, 180)}` }
  }
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, models: [], message: `响应不是 JSON：${text.slice(0, 120)}` }
  }
  const rows = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : []
  const models: string[] = [...new Set<string>(rows.map((r: any) => String(r?.id ?? r?.name ?? '')).filter(Boolean))]
  return {
    ok: true,
    models,
    message: `获取到 ${models.length} 个模型 · ${Date.now() - started}ms`,
  }
}

export async function testAiConfig(input?: Overrides): Promise<AiTestResult> {
  const cfg = resolveForRequest(input)
  const started = Date.now()
  const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      max_tokens: 5,
      messages: [{ role: 'user', content: '只回复 OK' }],
    }),
  })
  const text = await response.text()
  if (!response.ok) {
    return { ok: false, latencyMs: Date.now() - started, model: cfg.model, message: `HTTP ${response.status} ${text.slice(0, 160)}` }
  }
  let model = cfg.model
  try {
    const json = JSON.parse(text) as { model?: string }
    model = json.model || model
  } catch {
    // keep configured model
  }
  return { ok: true, latencyMs: Date.now() - started, model, message: '连接成功，模型已返回响应' }
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Base URL 只支持 http/https')
  if (url.username || url.password) throw new Error('Base URL 不能包含账号密码')
  return url.toString().replace(/\/$/, '')
}

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}

function load(): Stored | null {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Stored
    if (raw.apiKey && raw.baseUrl) return raw
  } catch {
    // no stored config
  }
  return null
}
