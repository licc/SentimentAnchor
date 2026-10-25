import type { EtfFeeModel } from '../../shared/types.js'
import { getEtfFeeSettings } from './etf-fee-config.js'

export const ETF_FEES = {
  commissionRate: Number(process.env.ETF_COMMISSION_RATE ?? 0.0002),
  minCommission: Number(process.env.ETF_MIN_COMMISSION ?? 5),
  slippageBps: Number(process.env.ETF_SLIPPAGE_BPS ?? 5),
  stampDuty: 0,
  maxDailyFeePct: Number(process.env.ETF_MAX_DAILY_FEE_PCT ?? 0.3),
}

export function commission(notional: number): number {
  return round(Math.max(ETF_FEES.minCommission, notional * ETF_FEES.commissionRate))
}

export function roundTripCostPct(notional: number, price: number): number {
  if (!(notional > 0) || !(price > 0)) return 0
  const fee = commission(notional) * 2
  const tick = (0.001 / price) * notional * 2
  const slip = (ETF_FEES.slippageBps / 10_000) * notional * 2
  return round(((fee + tick + slip) / notional) * 100)
}

export function getFeeModel(): EtfFeeModel {
  return {
    commissionRate: ETF_FEES.commissionRate,
    minCommission: ETF_FEES.minCommission,
    slippageBps: ETF_FEES.slippageBps,
    stampDuty: ETF_FEES.stampDuty,
    maxDailyFeePct: getEtfFeeSettings().maxDailyFeePct,
    maxDailyFeeAmount: getEtfFeeSettings().maxDailyFeeAmount,
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
