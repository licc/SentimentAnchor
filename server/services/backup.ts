import fs from 'node:fs'
import path from 'node:path'

const DATA = path.join(process.cwd(), 'data')
const ROOT = path.join(DATA, 'backups')
const CONFIG = path.join(DATA, 'backup-config.json')
export interface BackupConfig { enabled: boolean; intervalHours: number; keep: number; lastAt: string | null }
let config: BackupConfig = load()

export function getBackupConfig(): BackupConfig { return { ...config } }
export function getBackups(): Array<{ name: string; at: string; files: number }> {
  try {
    return fs.readdirSync(ROOT).filter((n) => n.startsWith('backup-')).sort().reverse().map((name) => {
      const dir = path.join(ROOT, name)
      return { name, at: fs.statSync(dir).mtime.toISOString(), files: fs.readdirSync(dir).length }
    })
  } catch { return [] }
}
export function saveBackupConfig(input: Partial<BackupConfig>): BackupConfig {
  config = {
    enabled: input.enabled ?? config.enabled,
    intervalHours: Math.max(1, Math.min(168, Number(input.intervalHours ?? config.intervalHours))),
    keep: Math.max(1, Math.min(60, Number(input.keep ?? config.keep))),
    lastAt: config.lastAt,
  }
  persist()
  return getBackupConfig()
}
export function runBackup(): { name: string; files: number } {
  const name = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const dir = path.join(ROOT, name)
  fs.mkdirSync(dir, { recursive: true })
  const files = fs.readdirSync(DATA).filter((n) => (n.endsWith('.json') || n.endsWith('.db')) && !n.startsWith('backup-'))
  for (const file of files) {
    const src = path.join(DATA, file)
    if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(dir, file))
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ name, at: new Date().toISOString(), files }, null, 2))
  config.lastAt = new Date().toISOString()
  persist()
  prune()
  return { name, files: files.length + 1 }
}
export function maybeAutoBackup(): void {
  if (!config.enabled) return
  const last = config.lastAt ? Date.parse(config.lastAt) : 0
  if (Date.now() - last < config.intervalHours * 3_600_000) return
  try { runBackup() } catch { /* best effort */ }
}
function prune() {
  const list = fs.readdirSync(ROOT).filter((n) => n.startsWith('backup-')).sort().reverse()
  for (const name of list.slice(config.keep)) fs.rmSync(path.join(ROOT, name), { recursive: true, force: true })
}
function load(): BackupConfig {
  try { const raw = JSON.parse(fs.readFileSync(CONFIG, 'utf8')) as BackupConfig; return { enabled: raw.enabled !== false, intervalHours: Number(raw.intervalHours) || 24, keep: Number(raw.keep) || 14, lastAt: raw.lastAt ?? null } } catch { return { enabled: true, intervalHours: 24, keep: 14, lastAt: null } }
}
function persist() { try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2)) } catch { /* best effort */ } }
