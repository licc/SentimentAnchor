const counters = new Map<string, number>()
const timings = new Map<string, { count: number; total: number; max: number }>()

export function inc(name: string, value = 1) { counters.set(name, (counters.get(name) ?? 0) + value) }
export function observe(name: string, ms: number) {
  const t = timings.get(name) ?? { count: 0, total: 0, max: 0 }
  t.count += 1; t.total += ms; t.max = Math.max(t.max, ms)
  timings.set(name, t)
}
export function metricsSnapshot() {
  return {
    counters: Object.fromEntries([...counters.entries()].sort(([a], [b]) => a.localeCompare(b))),
    timings: Object.fromEntries([...timings.entries()].map(([k, v]) => [k, { count: v.count, avgMs: Math.round(v.total / v.count), maxMs: Math.round(v.max) }])),
    at: new Date().toISOString(),
  }
}
