import fs from 'node:fs'
import path from 'node:path'

const FILE = path.join(process.cwd(), 'data', 'server.lock')
let held = false

export function acquireInstanceLock(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as { pid?: number }
    const pid = Number(raw.pid)
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0)
        console.error(`[server] another instance is already running (pid ${pid}); refusing to start`)
        process.exit(1)
      } catch {
        // stale lock, continue
      }
    }
  } catch {
    // no lock yet
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
  held = true
  process.on('exit', releaseInstanceLock)
}

export function releaseInstanceLock(): void {
  if (!held) return
  held = false
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as { pid?: number }
    if (Number(raw.pid) === process.pid) fs.unlinkSync(FILE)
  } catch {
    // best effort
  }
}
