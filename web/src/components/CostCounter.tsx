import { Coins } from 'lucide-react'
import type { Cost } from '../api'

const TIER_COLOR = ['bg-indigo-300', 'bg-indigo-500', 'bg-indigo-700']

export default function CostCounter({ cost }: { cost?: Cost }) {
  const pct = cost?.resolved_pct ?? {}
  return (
    <div className="min-w-[200px] rounded-xl bg-white p-3 ring-1 ring-slate-200">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <Coins className="h-3.5 w-3.5 text-indigo-500" /> Cascade cost
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-semibold tabular-nums text-slate-800">{cost?.avg_llm_calls ?? '—'}</span>
        <span className="text-xs text-slate-400">LLM calls / question</span>
      </div>
      <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-slate-100">
        {[1, 2, 3].map((t, i) => (
          <div key={t} className={TIER_COLOR[i]} style={{ width: `${pct[t] ?? 0}%` }} />
        ))}
      </div>
      <div className="mt-1 flex gap-2 text-[11px] text-slate-500 tabular-nums">
        {[1, 2, 3].map((t) => <span key={t}>T{t} {pct[t] ?? 0}%</span>)}
        {cost && <span className="ml-auto">{(cost.total_ms / 1000).toFixed(0)}s</span>}
      </div>
    </div>
  )
}
