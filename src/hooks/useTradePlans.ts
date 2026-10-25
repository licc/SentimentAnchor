import { useCallback, useEffect, useState } from 'react'
import { getTradePlans, reviewTradePlan } from '../api'
type Plan = Awaited<ReturnType<typeof getTradePlans>>[number]
export function useTradePlans() {
  const [plans, setPlans] = useState<Plan[]>([])
  const refresh = useCallback(async () => { setPlans(await getTradePlans()) }, [])
  useEffect(() => { void refresh() }, [refresh])
  const review = useCallback(async (id: string, text: string) => { const next = await reviewTradePlan(id, text); setPlans((current) => current.map((p) => p.id === id ? next : p)); return next }, [])
  return { plans, refresh, review }
}
