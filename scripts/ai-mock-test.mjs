/**
 * Verify the optional LLM path without an external key:
 * spin up a tiny OpenAI-compatible mock, point ai.ts at it,
 * then assert the returned insight is mode=llm.
 */
import assert from 'node:assert/strict'
import http from 'node:http'

const mock = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    const payload = JSON.parse(body || '{}')
    assert.equal(payload.model, 'mock-model')
    const content = JSON.stringify({
      title: 'Mock LLM: 主线聚焦机器人，空间看吉大正元',
      stance: '进攻',
      confidence: 81,
      summary: 'Mock LLM summary based on supplied snapshot.',
      conclusions: [
        { label: '情绪结构', text: 'Mock 情绪结论', tone: 'up' },
        { label: '主线判断', text: 'Mock 主线结论', tone: 'warn' },
        { label: '个股锚定', text: 'Mock 个股结论', tone: 'flat' },
      ],
      attack: 'Mock attack plan',
      avoid: 'Mock avoid plan',
      confirm: 'Mock confirm condition',
      risks: ['Mock risk 1', 'Mock risk 2'],
    })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ model: 'mock-model', choices: [{ message: { content } }] }))
  })
})
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve))
const port = mock.address().port
process.env.LLM_BASE_URL = `http://127.0.0.1:${port}/v1`
process.env.LLM_API_KEY = 'test-key'
process.env.LLM_MODEL = 'mock-model'
const snapshot = await fetch(process.env.BASE_URL || 'http://127.0.0.1:8787/api/snapshot').then((r) => r.json())
const { generateAi } = await import('../server/services/ai.ts')
const envelope = await generateAi(snapshot, 'llm', true)
assert.equal(envelope.insight.mode, 'llm')
assert.equal(envelope.insight.provider, 'custom')
assert.equal(envelope.insight.model, 'mock-model')
assert.equal(envelope.insight.stance, '进攻')
assert.equal(envelope.insight.risks.length, 2)
console.log('ai-mock check passed:', {
  mode: envelope.insight.mode,
  provider: envelope.insight.provider,
  model: envelope.insight.model,
  title: envelope.insight.title,
})
mock.close()
