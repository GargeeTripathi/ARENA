import { AlertTriangle } from 'lucide-react'
import type { Diagnosis } from '../api'
import { CAUSE_COLOR, VERDICT_STYLE, pretty } from '../api'

// Mirrors backend config.LENS_WEIGHTS (display only).
const WEIGHTS: Record<string, number> = {
  counterfactual: 3, grounding: 2, forensics: 1.5, span_detector: 1.5, sufficiency: 1, answer_check: 1,
}

const SENTENCE: Record<string, string> = {
  retrieval: 'Retrieval failure', generation: 'Generation failure', abstention: 'Abstention failure',
  ok: 'Healthy answer', uncertain: 'Could not decide',
}

export default function ConsensusPanel({ d }: { d: Diagnosis }) {
  const votes = d.lens_results.map((r) => ({ r, w: (WEIGHTS[r.lens] ?? 1) * r.confidence }))
  const max = Math.max(...votes.map((v) => v.w), 0.01)
  const st = VERDICT_STYLE[d.verdict]

  return (
    <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
      <div className="mb-2 text-xs font-semibold text-slate-500">Consensus (weight × confidence)</div>
      <div className="space-y-1">
        {votes.map(({ r, w }) => (
          <div key={r.lens} className="flex items-center gap-2 text-[11px]">
            <span className="w-24 shrink-0 text-slate-500">{pretty(r.lens)}</span>
            <div className="h-2.5 flex-1 rounded bg-slate-100">
              <div className="h-2.5 rounded" style={{ width: `${(100 * w) / max}%`, background: r.verdict === 'uncertain' ? '#cbd5e1' : CAUSE_COLOR[r.verdict] }} />
            </div>
            <span className={`w-20 shrink-0 truncate ${VERDICT_STYLE[r.verdict].text}`}>{r.verdict}</span>
          </div>
        ))}
      </div>
      <div className={`mt-3 rounded-md px-2.5 py-2 text-xs ${st.bg} ${st.text}`}>
        <b>{SENTENCE[d.verdict]}{d.sub_cause ? ` (${pretty(d.sub_cause)})` : ''}</b>
        {' '}· {(d.confidence * 100).toFixed(0)}% confidence · resolved at Tier {d.max_tier_reached} with {d.total_llm_calls} LLM call{d.total_llm_calls === 1 ? '' : 's'}
        {d.needs_review && <span className="ml-1 inline-flex items-center gap-0.5 font-semibold text-amber-700"><AlertTriangle className="h-3 w-3" /> needs human review</span>}
      </div>
    </div>
  )
}
