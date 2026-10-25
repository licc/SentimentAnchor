import assert from 'node:assert/strict'
const base = process.env.BASE_URL || 'http://127.0.0.1:8787'
const s = await fetch(`${base}/api/snapshot`).then((r) => r.json())
const b = s.breadth
assert.match(b.amountWindow, /^\d{2}:\d{2}$/, 'amountWindow missing')
assert.ok(b.prevAmount > 0, 'previous window amount missing')
assert.ok(Number.isFinite(b.amountChangePct), 'amountChangePct missing')
assert.ok(Math.abs(b.amountChangePct) < 20, `window comparison looks like full-day comparison: ${b.amountChangePct}`)
assert.ok(b.avg5Amount > 0, 'avg5 window missing')
assert.ok(Number.isFinite(b.amountDiff), 'amountDiff missing')
assert.ok(Number.isFinite(b.amountVs5Diff), 'amountVs5Diff missing')
console.log(JSON.stringify({
  amount: `${(b.amount / 1e12).toFixed(3)}万亿`,
  prevWindow: `${(b.prevAmount / 1e12).toFixed(3)}万亿`,
  changePct: `${b.amountChangePct.toFixed(2)}%`,
  amountDiff: `${Math.abs(b.amountDiff / 1e8).toFixed(2)}亿`,
  avg5Window: `${(b.avg5Amount / 1e12).toFixed(3)}万亿`,
  vs5Diff: `${Math.abs(b.amountVs5Diff / 1e8).toFixed(2)}亿`,
  vs5Pct: `${b.amountVs5Pct.toFixed(2)}%`,
  window: b.amountWindow,
  days: b.amountWindowDays,
}, null, 2))
