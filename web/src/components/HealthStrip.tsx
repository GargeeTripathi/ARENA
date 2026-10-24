import { CheckCircle2, FileSearch, ShieldCheck, Target } from 'lucide-react'
import type { Cost, Score, Scorecards } from '../api'
import { pretty } from '../api'
import { Card, VERDICT, causeFamily, cx, scoreTone } from '../ui'
import CostCounter from './CostCounter'

export const METRICS = [
  { key: 'context_relevance', label: 'Context relevance', hint: 'Right chunk retrieved in top-k', Icon: FileSearch },
  { key: 'faithfulness', label: 'Faithfulness', hint: 'Answer sentences backed by context', Icon: ShieldCheck },
  { key: 'accuracy', label: 'Accuracy', hint: 'Answer matches the gold answer', Icon: Target },
  { key: 'abstention', label: 'Abstention', hint: 'Says "I don\'t know" when it should', Icon: CheckCircle2 },
] as const

export function ScoreCard({ label, hint, Icon, s, delta, compact }: {
  label: string; hint: string; Icon: typeof Target; s?: Score; delta?: number | null; compact?: boolean
}) {
  const v = s?.value ?? null
  const tone = scoreTone(v)
  return (
    <Card hover className={cx('tile-corner', compact && 'p-3')}>
      <div className="flex items-center gap-2 whitespace-nowrap text-xs font-medium text-muted" title={hint}>
        <Icon className="h-4 w-4 shrink-0" style={{ color: tone.color }} />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={cx('font-display font-bold tabular-nums tracking-tight text-ink', compact ? 'text-xl' : 'text-[30px] leading-none')}>
          {v === null ? '—' : v.toFixed(2)}
        </span>
        {s && v !== null && s.lo !== null && s.hi !== null && (
          <span className="text-xs tabular-nums text-faint">±{((s.hi - s.lo) / 2).toFixed(2)}</span>
        )}
        {!compact && v !== null && (
          <span className={cx('ml-auto self-center shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide', tone.text)}
            style={{ background: `color-mix(in srgb, ${tone.color} 12%, transparent)` }}>
            {tone.label}
          </span>
        )}
        {delta != null && delta !== 0 && (
          <span className={cx('ml-auto text-xs font-semibold tabular-nums', delta > 0 ? 'text-ok' : 'text-generation')}>
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(2)}
          </span>
        )}
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-subtle">
        <div className="h-full rounded-full" style={{ width: `${(v ?? 0) * 100}%`, background: tone.color }} />
      </div>
      <div className="mt-2 truncate text-[11px] text-muted" title={hint}>{hint}{s?.n ? <span className="text-faint"> · n={s.n}</span> : null}</div>
    </Card>
  )
}

export function CauseBreakdown({ causes }: { causes: Record<string, number> }) {
  const total = Object.values(causes).reduce((a, b) => a + b, 0) || 1
  const failures = Object.entries(causes).filter(([c]) => c !== 'ok').sort((a, b) => b[1] - a[1])
  const ok = causes.ok ?? 0
  const nFail = failures.reduce((a, [, n]) => a + n, 0)
  return (
    <Card hover className="tile-corner">
      <div className="text-xs font-medium text-muted">Diagnosis</div>
      <div className="mt-1 flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="font-display text-[30px] font-bold leading-none tabular-nums tracking-tight text-ink">{nFail}</span>
        <span className="text-xs text-muted">failing of {total}</span>
      </div>
      <div className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
        {ok > 0 && <div style={{ width: `${(100 * ok) / total}%`, background: VERDICT.ok.hex, opacity: 0.35 }} title={`healthy: ${ok}`} />}
        {failures.map(([c, n]) => (
          <div key={c} style={{ width: `${(100 * n) / total}%`, background: VERDICT[causeFamily(c)].hex }} title={`${pretty(c)}: ${n}`} />
        ))}
      </div>
      <ul className="mt-2.5 space-y-1">
        {failures.length === 0 && <li className="text-xs text-ok">No failures found</li>}
        {failures.slice(0, 4).map(([c, n]) => (
          <li key={c} className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 rounded-full" style={{ background: VERDICT[causeFamily(c)].hex }} />
            <span className="truncate text-ink-2">{pretty(c)}</span>
            <span className="ml-auto font-semibold tabular-nums text-ink">{n}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export default function HealthStrip({ sc, cost }: { sc?: Scorecards; cost?: Cost }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {METRICS.map((m) => <ScoreCard key={m.key} label={m.label} hint={m.hint} Icon={m.Icon} s={sc?.[m.key]} />)}
      {sc?.root_causes ? <CauseBreakdown causes={sc.root_causes} /> : <Card><span className="text-xs text-muted">Diagnosis</span></Card>}
      <CostCounter cost={cost} />
    </div>
  )
}
