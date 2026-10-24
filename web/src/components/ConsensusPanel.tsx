import type { Diagnosis } from '../api'
import { pretty } from '../api'
import { Card, SectionTitle, VERDICT } from '../ui'

// Mirrors backend config.LENS_WEIGHTS (display only).
const WEIGHTS: Record<string, number> = {
  counterfactual: 3, grounding: 2, forensics: 1.5, span_detector: 1.5, sufficiency: 1, answer_check: 1,
}

export default function ConsensusPanel({ d }: { d: Diagnosis }) {
  const votes = d.lens_results
    .map((r) => ({ r, w: r.verdict === 'uncertain' ? 0 : (WEIGHTS[r.lens] ?? 1) * r.confidence }))
    .sort((a, b) => b.w - a.w)
  const max = Math.max(...votes.map((v) => v.w), 0.01)
  return (
    <Card>
      <SectionTitle hint="each lens votes with weight × confidence; the strongest verdict wins">Consensus</SectionTitle>
      <div className="space-y-2">
        {votes.map(({ r, w }) => (
          <div key={r.lens} className="grid grid-cols-[130px_1fr_140px] items-center gap-3 text-xs">
            <span className="truncate text-ink-2">{pretty(r.lens)}</span>
            <div className="h-2 overflow-hidden rounded-full bg-subtle">
              <div className="h-full rounded-full" style={{ width: `${(100 * w) / max}%`, background: VERDICT[r.verdict].hex, opacity: r.verdict === 'ok' ? 0.55 : 1 }} />
            </div>
            <span className={`truncate ${VERDICT[r.verdict].text}`}>
              {r.verdict === 'uncertain' ? 'no vote' : VERDICT[r.verdict].label}{r.sub_cause ? ` · ${pretty(r.sub_cause)}` : ''}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}
