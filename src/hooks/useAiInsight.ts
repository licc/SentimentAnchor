import { useCallback, useEffect, useState } from 'react'
import type { AiEnvelope, AiInsight, Snapshot } from '../../shared/types'
import { generateAiInsight, getAiInsight } from '../api'

export function useAiInsight(snapshot: Snapshot | null) {
  const [insight, setInsight] = useState<AiInsight | null>(null)
  const [llmConfigured, setLlmConfigured] = useState(false)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState<'local' | 'llm' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const key = snapshot
    ? [snapshot.tradingDate, snapshot.sentiment.score, snapshot.sentiment.stage, snapshot.breadth.limitUp, snapshot.breadth.limitDown, Math.round(snapshot.breadth.amount / 1e8), snapshot.headline.title].join('|')
    : ''

  useEffect(() => {
    if (!snapshot || !key) return
    let cancelled = false
    setLoading(true)
    getAiInsight()
      .then((res) => {
        if (cancelled) return
        setInsight(res.insight)
        setLlmConfigured(res.llmConfigured)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'AI 研判加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [key])

  const refresh = useCallback(async () => {
    try {
      const res = await getAiInsight()
      setInsight(res.insight)
      setLlmConfigured(res.llmConfigured)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 配置刷新失败')
    }
  }, [])

  const generate = useCallback(
    async (mode: 'local' | 'llm'): Promise<AiEnvelope | null> => {
      if (!snapshot) return null
      setGenerating(mode)
      try {
        const res = await generateAiInsight(mode, true)
        setInsight(res.insight)
        setLlmConfigured(res.llmConfigured)
        setError(null)
        return res
      } catch (err) {
        setError(err instanceof Error ? err.message : 'AI 研判失败')
        return null
      } finally {
        setGenerating(null)
      }
    },
    [snapshot],
  )

  return { insight, llmConfigured, loading, generating, error, generate, refresh }
}
