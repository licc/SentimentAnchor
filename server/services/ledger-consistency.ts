import { getExecutions } from './etf-execution.js'
import { ledgerSummary } from './ledger.js'

export function checkLedgerConsistency(): { ok: boolean; executionFills: number; ledgerFills: number; note: string } {
  const executionFills = getExecutions(200).filter((e) => e.status === 'filled').length
  const ledgerFills = ledgerSummary().fills
  return { ok: executionFills === ledgerFills, executionFills, ledgerFills, note: executionFills === ledgerFills ? '执行审计与账本成交数一致' : '执行审计与账本成交数不一致，请检查回填' }
}
