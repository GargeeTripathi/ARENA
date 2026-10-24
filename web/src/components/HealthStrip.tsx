import { CheckCircle2, FileSearch, ShieldCheck, Target } from 'lucide-react'
import type { Cost, Score, Scorecards } from '../api'
import { CAUSE_COLOR, pretty } from '../api'
import CostCounter from './CostCounter'

const CARDS = [
  { key: 'context_relevance', label: 'Context relevance', hint: 'gold chunk in top-k', Icon: FileSearch },
  { key: 'faithfulness', label: 'Faithfulness', hint: 'supported sentences', Icon: ShieldCheck },
  { key: 'accuracy', label: 'Accuracy', hint: 'correct vs gold answer', Icon: Target },
  { key: 'abstention', label: 'Abstention', hint: '"I don\'t know" when it should', Icon: CheckCircle2 },
] as const

export function tone(v: number | null) {
  if (v === null) return { text: 'text-slate-400', bar: 'bg-slate-200', ring: 'ring-slate-200' }
  if (v >= 0.8) return { text: 'text-emerald-600', bar: 'bg-emerald-500', ring: 'ring-emerald-200' }
  if (v >= 0.6) return { text: 'text-amber-600', bar: 'bg-amber-500', ring: 'ring-amber-200' }
  return { text: 'text-rose-600', bar: 'bg-rose-500', ring: 'ring-rose-200' }
}

export function ScoreCard({ label, hint, Icon, s, delta }: { label: string; hint: string; Icon: typeof Target; s?: Score; delta?: number | null }) {
  const v = s?.value ?? null
  const t = tone(v)
  return (
    <div className="flex-1 min-w-[150px] rounded-xl bg-white p-3 ring-1 ring-slate-200">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <Icon className={`h-3.5 w-3.5 ${t.text}`} /> {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`text-2xl font-semibold tabular-nums ${t.text}`}>{v === null ? '—' : v.toFixed(2)}</span>
        {s && v !== null && <span className="text-xs text-slate-400 tabular-nums">± {((s.hi! - s.lo!) / 2).toFixed(2)}</span>}
        {delta != null && delta !== 0 && (
          <span className={`ml-auto text-xs font-semibold tabular-nums ${delta > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {delta > 0 ? '+' : ''}{delta.toFixed(2)}
          </span>
        )}
      </div>
      <div className="mt-1.5 h-1 rounded-full bg-slate-100">
        <div className={`h-1 rounded-full ${t.bar}`} style={{ width: `${(v ?? 0) * 100}%` }} />
      </div>
      <div className="mt-1 text-[11px] text-slate-400">{hint}{s?.n ? ` · n=${s.n}` : ''}</div>
    </div>
  )
}

export function CauseBar({ causes }: { causes: Record<string, number> }) {
  const total = Object.values(causes).reduce((a, b) => a + b, 0) || 1
  const entries = Object.entries(causes).sort((a, b) => (a[0] === 'ok' ? -1 : b[0] === 'ok' ? 1 : b[1] - a[1]))
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
        {entries.map(([c, n]) => (
          <div key={c} title={`${pretty(c)}: ${n}`} style={{ width: `${(100 * n) / total}%`, background: CAUSE_COLOR[c] ?? '#94a3b8' }} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
        {entries.map(([c, n]) => (
          <span key={c} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: CAUSE_COLOR[c] ?? '#94a3b8' }} />
            {pretty(c)} <b className="tabular-nums text-slate-700">{n}</b>
          </span>
        ))}
      </div>
    </div>
  )
}

export default function HealthStrip({ sc, cost }: { sc?: Scorecards; cost?: Cost }) {
  return (
    <div className="flex flex-wrap gap-3">
      {CARDS.map((c) => (
        <ScoreCard key={c.key} label={c.label} hint={c.hint} Icon={c.Icon} s={sc?.[c.key]} />
      ))}
      <div className="flex-[1.4] min-w-[260px] rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <div className="mb-2 text-xs font-medium text-slate-500">Root causes</div>
        {sc?.root_causes ? <CauseBar causes={sc.root_causes} /> : <div className="text-xs text-slate-400">No run yet</div>}
      </div>
      <CostCounter cost={cost} />
    </div>
  )
}
