/**
 * 情绪温度归档的持久化层（SQLite）。
 *
 * 为什么用库而不是 JSON 文件：
 * - 需要按日期范围查询（最近 N 天）、按日期 upsert，文件方案每次都要全量读目录；
 * - 归档会随运行时间增长，单文件 JSON 越来越大，也怕写坏；
 * - 用 Node 24 内置的 `node:sqlite`，零额外依赖、无需编译，直接落一个 `data/sentiment.db`。
 *
 * 表结构刻意扁平：一天一行，分钟序列存 JSON 字符串。
 * 序列只在"当日 N 日趋势"里整体读取，不需要按点查询，扁平的收益大于拆分。
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const ROOT = process.cwd()
const DATA_DIR = path.join(ROOT, 'data')
const DB_PATH = path.join(DATA_DIR, 'sentiment.db')
/** 兼容早期版本：这些 JSON 文件会被一次性导入数据库 */
const LEGACY_DIR = path.join(DATA_DIR, 'history', 'sentiment')

export interface SentimentPoint {
  time: string
  temp: number
}

export interface SentimentDayRecord {
  date: string
  /** 当日最后一个采样点的温度（与日内曲线同尺度） */
  score: number
  high: number
  low: number
  points: SentimentPoint[]
  updatedAt: string
}

let db: DatabaseSync | null = null
let legacyImported = false

function conn(): DatabaseSync {
  if (db) return db
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const handle = new DatabaseSync(DB_PATH)
  handle.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sentiment_daily (
      date       TEXT PRIMARY KEY,
      score      INTEGER NOT NULL,
      high       INTEGER NOT NULL,
      low        INTEGER NOT NULL,
      points     TEXT    NOT NULL,
      updated_at TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sentiment_daily_date ON sentiment_daily(date);
  `)
  db = handle
  importLegacyJson()
  return handle
}

/** 把旧版本写在 data/history/sentiment/<date>.json 的文件一次性搬进库。 */
function importLegacyJson() {
  if (legacyImported) return
  legacyImported = true
  try {
    if (!fs.existsSync(LEGACY_DIR)) return
    const files = fs.readdirSync(LEGACY_DIR).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
    for (const name of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(LEGACY_DIR, name), 'utf8')) as SentimentDayRecord
        if (raw?.date && Array.isArray(raw.points)) upsertDay(raw)
      } catch {
        // 单个文件坏了就跳过
      }
    }
  } catch {
    // 迁移是尽力而为
  }
}

/** 写入/覆盖某一天的归档。 */
export function upsertDay(record: SentimentDayRecord): void {
  const handle = conn()
  handle
    .prepare(
      `INSERT INTO sentiment_daily (date, score, high, low, points, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         score = excluded.score,
         high = excluded.high,
         low = excluded.low,
         points = excluded.points,
         updated_at = excluded.updated_at`,
    )
    .run(
      record.date,
      Math.round(record.score),
      Math.round(record.high),
      Math.round(record.low),
      JSON.stringify(record.points),
      record.updatedAt,
    )
}

/** 取最近 days 个交易日的归档（升序：最早的在前）。 */
export function getDays(days: number): SentimentDayRecord[] {
  const handle = conn()
  const rows = handle
    .prepare(
      `SELECT date, score, high, low, points, updated_at
         FROM sentiment_daily
        ORDER BY date DESC
        LIMIT ?`,
    )
    .all(Math.max(1, Math.min(400, days))) as Array<Record<string, unknown>>
  return rows
    .map((row) => {
      let points: SentimentPoint[] = []
      try {
        points = JSON.parse(String(row.points)) as SentimentPoint[]
      } catch {
        points = []
      }
      return {
        date: String(row.date),
        score: Number(row.score),
        high: Number(row.high),
        low: Number(row.low),
        points,
        updatedAt: String(row.updated_at),
      }
    })
    .reverse()
}

/** 已有归档的交易日数量。 */
export function countDays(): number {
  const handle = conn()
  const row = handle.prepare('SELECT COUNT(*) AS n FROM sentiment_daily').get() as { n?: number } | undefined
  return Number(row?.n ?? 0)
}

/** 已有归档的日期集合（升序）。 */
export function getDates(): string[] {
  const handle = conn()
  const rows = handle.prepare('SELECT date FROM sentiment_daily ORDER BY date').all() as Array<{ date: string }>
  return rows.map((r) => r.date)
}

/** 删除某一天的归档（用于清理回填时误写入的非交易日）。 */
export function deleteDay(date: string): void {
  const handle = conn()
  handle.prepare('DELETE FROM sentiment_daily WHERE date = ?').run(date)
}
