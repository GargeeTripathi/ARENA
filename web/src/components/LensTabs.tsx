import type { Diagnosis, LensResult } from '../api'
import { pretty } from '../api'
import { Card, SectionTitle, Tag, VERDICT, VerdictBadge, cx } from '../ui'

export const LENSES: { name: string; tier: number; label: string; what: string }[] = [
  { name: 'forensics', tier: 1, label: 'Retrieval forensics', what: 'Where the gold chunk ranked. No LLM.' },
  { name: 'span_detector', tier: 1, label: 'Span detector', what: 'LettuceDetect marks unsupported words. No LLM.' },
  { name: 'answer_check', tier: 1, label: 'Answer check', what: 'Matches the gold answer; LLM judge only if unsure.' },
  { name: 'grounding', tier: 2, label: 'Grounding', what: 'Scores every sentence against the context. No LLM.' },
  { name: 'sufficiency', tier: 2, label: 'Sufficiency', what: 'LLM judge: was the context enough to answer?' },
  { name: 'counterfactual', tier: 3, label: 'Counterfactual', what: 'Re-generates with the gold chunk swapped in.' },
]

function Finding({ r }: { r: LensResult }) {
  const e = r.evidence
  if (e?.error) return <p className="text-xs text-muted">Abstained: {String(e.error).slice(0, 120)}</p>
  switch (r.lens) {
    case 'forensics':
      if (e.gold_rank === undefined || (e.gold_rank === null && !e.gold_chunk_ids)) return <p className="text-xs text-muted">No gold chunk (unanswerable question).</p>
      return (
        <div className="space-y-2">
          <p className="text-xs text-ink-2">Gold chunk rank: <b className="text-ink">{e.gold_rank ?? 'not retrieved'}</b> with k = {e.k}</p>
          {e.k_sweep && (
            <div className="flex flex-wrap gap-1">
              {Object.entries(e.k_sweep as Record<string, boolean>).map(([kk, hit]) => (
                <span key={kk} className={cx('rounded px-1.5 py-0.5 text-[11px] tabular-nums', hit ? 'bg-ok/12 text-ok' : 'bg-subtle text-faint')}>
                  k={kk} {hit ? '✓' : '✗'}
                </span>
              ))}
            </div>
          )}
          {e.split && <p className="text-xs text-retrieval">Evidence is split across chunk boundaries.</p>}
        </div>
      )
    case 'span_detector':
      return e.spans?.filter((s: any) => s.prob > 0.5).length
        ? <ul className="space-y-1">{e.spans.filter((s: any) => s.prob > 0.5).slice(0, 4).map((s: any, i: number) => (
          <li key={i} className="text-xs"><mark className="rounded bg-generation/12 px-1 text-generation">{s.text}</mark> <span className="tabular-nums text-faint">p={s.prob}</span></li>))}</ul>
        : <p className="text-xs text-muted">{e.note ?? 'No unsupported spans found.'}</p>
    case 'grounding':
      return e.sentences
        ? <p className="text-xs text-ink-2">{e.sentences.filter((s: any) => s.supported).length} of {e.sentences.length} sentences supported
            {e.model && <span className="text-faint"> · {e.model}</span>}</p>
        : <p className="text-xs text-muted">{e.note}</p>
    case 'sufficiency':
      return <p className="text-xs text-ink-2"><b className="text-ink">{e.sufficient ? 'Enough context.' : 'Not enough context.'}</b> {e.reason}</p>
    case 'answer_check':
      return <p className="text-xs text-ink-2"><b className="text-ink">{e.correct === null ? 'Unsure.' : e.correct ? 'Correct.' : 'Incorrect.'}</b> {e.reason} <span className="text-faint">({e.method})</span></p>
    case 'counterfactual':
      return <p className="text-xs text-ink-2">{(e.runs ?? []).length} re-run(s); see the Counterfactual tab.</p>
    default:
      return null
  }
}

export default function LensTabs({ d }: { d: Diagnosis }) {
  const by = Object.fromEntries(d.lens_results.map((r) => [r.lens, r]))
  return (
    <div>
      <SectionTitle hint="cheap lenses run on every question; LLM lenses only when needed">Lenses</SectionTitle>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {LENSES.map((l) => {
          const r = by[l.name]
          return (
            <Card key={l.name} className={cx('p-3.5', !r && 'opacity-55')}>
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-ink">{l.label}</span>
                <Tag>T{l.tier}</Tag>
                <span className="ml-auto">{r ? <VerdictBadge verdict={r.verdict} size="sm" /> : <span className="text-[11px] text-faint">skipped</span>}</span>
              </div>
              <p className="mt-1 text-[11px] text-faint">{l.what}</p>
              <div className="mt-2.5 border-t border-line pt-2.5">
                {r ? <Finding r={r} /> : <p className="text-xs text-muted">Not needed: settled at Tier {d.max_tier_reached}.</p>}
              </div>
              {r && (
                <div className="mt-2 flex gap-3 text-[11px] tabular-nums text-faint">
                  <span>conf {r.confidence.toFixed(2)}</span>
                  {r.sub_cause && <span className={VERDICT[r.verdict].text}>{pretty(r.sub_cause)}</span>}
                  <span className="ml-auto">{r.llm_calls + (r.cached_calls ?? 0)} LLM · {r.latency_ms} ms</span>
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
