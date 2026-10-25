import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteJson } from '../lib/atomic.js'

const FILE = path.join(process.cwd(), 'data', 'kill-switch.json')
interface KillState { active: boolean; reason: string; updatedAt: string }
let state: KillState = load()

export function getKillSwitch(): KillState { return { ...state } }
export function activateKillSwitch(reason: string): KillState {
  state = { active: true, reason: reason || '手动紧急停止', updatedAt: new Date().toISOString() }
  save()
  return getKillSwitch()
}
export function clearKillSwitch(): KillState {
  state = { active: false, reason: '', updatedAt: new Date().toISOString() }
  save()
  return getKillSwitch()
}
export function assertNotKilled() {
  if (state.active) throw new Error(`系统已急停：${state.reason}`)
}
function load(): KillState {
  try { const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as KillState; return { active: Boolean(raw.active), reason: raw.reason || '', updatedAt: raw.updatedAt || new Date().toISOString() } } catch { return { active: false, reason: '', updatedAt: new Date().toISOString() } }
}
function save() { try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); atomicWriteJson(FILE, state) } catch { /* best effort */ } }
