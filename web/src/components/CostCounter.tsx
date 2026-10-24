import { Zap } from 'lucide-react'
import type { Cost } from '../api'
import { Card } from '../ui'

const TIERS = [
  { t: 1, label: 'Tier 1', note: 'local checks', color: 'color-mix(in srgb, var(--accent) 35%, transparent)' },
  { t: 2, label: 'Tier 2', note: 'judge', color: 'color-mix(in srgb, var(--accent) 65%, transparent)' },
  { t: 3, label: 'Tier 3', note: 'counterfactual', color: 'var(--accent)' },
]

export default function CostCounter({ cost }: { cost?: Cost }) {
  const pct = cost?.resolved_pct ?? {}
  return (
    <Card hover className="tile-corner">
      <div className="flex items-center gap-2 text-xs font-medium text-muted">
        <Zap className="h-4 w-4 text-accent" /> LLM cost
      </div>
      <div className="mt-2 flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="font-display text-[30px] font-bold leading-none tabular-nums tracking-tight text-brand">{cost?.avg_llm_calls ?? '—'}</span>
        <span className="text-xs text-muted">calls / question</span>
      </div>
      <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-subtle">
        {TIERS.map(({ t, color }) => <div key={t} style={{ width: `${pct[t] ?? 0}%`, background: color }} />)}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
        {TIERS.map(({ t, note, color }) => (
          <span key={t} className="flex items-center gap-1" title={note}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />T{t} <b className="tabular-nums text-ink-2">{pct[t] ?? 0}%</b>
          </span>
        ))}
      </div>
      {cost?.cached_llm_calls != null && (
        <div className="mt-1 text-[11px] text-faint tabular-nums">{cost.billed_llm_calls} billed · {cost.cached_llm_calls} cached · {(cost.total_ms / 1000).toFixed(0)}s</div>
      )}
    </Card>
  )
}
