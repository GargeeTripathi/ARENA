import { useState } from 'react'
import type { Diagnosis, LensResult } from '../api'
import { VERDICT_STYLE, pretty } from '../api'

export const LENSES: { name: string; tier: number; label: string; what: string }[] = [
  { name: 'forensics', tier: 1, label: 'Forensics', what: 'Where the gold chunk ranked (no LLM)' },
  { name: 'span_detector', tier: 1, label: 'Span detector', what: 'LettuceDetect token-level hallucination spans (no LLM)' },
  { name: 'answer_check', tier: 1, label: 'Answer check', what: 'Correct vs gold: rules/lexical first, LLM judge only if unsure' },
  { name: 'grounding', tier: 2, label: 'Grounding', what: 'MiniCheck support score per sentence (no LLM)' },
  { name: 'sufficiency', tier: 2, label: 'Sufficiency', what: 'LLM judge: is the context enough to answer?' },
  { name: 'counterfactual', tier: 3, label: 'Counterfactual', what: 'Re-generate with the gold chunk swapped in' },
]

function Evidence({ r }: { r: LensResult }) {
  const e = r.evidence
  switch (r.lens) {
    case 'forensics':
      return (
        <div className="space-y-2">
          <div>Gold rank: <b>{e.gold_rank ?? 'not retrieved'}</b> (k = {e.k})</div>
          {e.k_sweep && (
            <div className="flex gap-1.5">
              {Object.entries(e.k_sweep as Record<string, boolean>).map(([kk, hit]) => (
                <span key={kk} className={`rounded px-2 py-0.5 tabular-nums ${hit ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  hit@{kk} {hit ? '✓' : '✗'}
                </span>
              ))}
            </div>
          )}
          {e.split && <div className="text-amber-700">Evidence is split across chunk boundaries.</div>}
        </div>
      )
    case 'span_detector':
      return e.spans?.length
        ? <ul className="space-y-1">{e.spans.map((s: any, i: number) => <li key={i}><mark className="rounded bg-rose-100 px-1 text-rose-700">{s.text}</mark> <span className="tabular-nums text-slate-400">p={s.prob}</span></li>)}</ul>
        : <div className="text-slate-500">{e.error ?? e.note ?? 'No hallucinated spans found.'}</div>
    case 'grounding':
      return e.sentences
        ? <ul className="space-y-1">{e.sentences.map((s: any, i: number) => (
          <li key={i} className="flex gap-2"><span>{s.supported ? '✅' : '❌'}</span><span className="flex-1">{s.text}</span>
            <span className="shrink-0 tabular-nums text-slate-400">{s.score ?? ''} {s.best_chunk_id ?? ''}</span></li>))}
          {e.model && <li className="text-slate-400">checker: {e.model}</li>}</ul>
        : <div className="text-slate-500">{e.error ?? e.note}</div>
    case 'sufficiency':
    case 'answer_check':
      return (
        <div>
          {'sufficient' in e && <div>Sufficient: <b>{String(e.sufficient)}</b></div>}
          {'correct' in e && <div>Correct: <b>{e.correct === null ? 'unsure' : String(e.correct)}</b> <span className="text-slate-400">({e.method})</span></div>}
          <div className="text-slate-500">{e.reason}</div>
        </div>
      )
    default:
      return <pre className="overflow-x-auto text-[11px] text-slate-500">{JSON.stringify(e, null, 1)}</pre>
  }
}

export default function LensTabs({ d }: { d: Diagnosis }) {
  const by = Object.fromEntries(d.lens_results.map((r) => [r.lens, r]))
  const [tab, setTab] = useState<string>(d.lens_results[0]?.lens ?? 'forensics')
  const active = by[tab] ? tab : d.lens_results[0]?.lens
  const r = by[active]
  const meta = LENSES.find((l) => l.name === active)

  return (
    <div className="rounded-lg bg-white ring-1 ring-slate-200">
      <div className="flex flex-wrap gap-1 border-b border-slate-100 p-1.5" role="tablist">
        {LENSES.map((l) => {
          const ran = !!by[l.name]
          const st = ran ? VERDICT_STYLE[by[l.name].verdict] : null
          return (
            <button
              key={l.name} role="tab" aria-selected={active === l.name} disabled={!ran}
              onClick={() => setTab(l.name)}
              title={ran ? l.what : `not needed — resolved at Tier ${d.max_tier_reached}`}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium
                ${active === l.name ? 'bg-indigo-50 text-indigo-700' : ran ? 'text-slate-600 hover:bg-slate-50' : 'cursor-not-allowed text-slate-300'}`}
            >
              {st ? <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-200" />}
              {l.label} <span className="text-[10px] opacity-60">T{l.tier}</span>
            </button>
          )
        })}
      </div>
      {r ? (
        <div className="p-3 text-xs text-slate-700">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
            <span>{meta?.what}</span>
            <span className={`ml-auto rounded px-1.5 py-0.5 font-medium ${VERDICT_STYLE[r.verdict].bg} ${VERDICT_STYLE[r.verdict].text}`}>
              {r.verdict}{r.sub_cause ? ` · ${pretty(r.sub_cause)}` : ''}
            </span>
            <span className="tabular-nums">conf {r.confidence.toFixed(2)}</span>
            <span className="tabular-nums">{r.llm_calls} LLM call{r.llm_calls === 1 ? '' : 's'}</span>
            <span className="tabular-nums">{r.latency_ms} ms</span>
          </div>
          <Evidence r={r} />
        </div>
      ) : <div className="p-3 text-xs text-slate-400">No lens results.</div>}
      <div className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
        {LENSES.filter((l) => !by[l.name]).map((l) => l.label).join(', ') || 'All lenses ran'}
        {LENSES.some((l) => !by[l.name]) && ` — not needed, resolved at Tier ${d.max_tier_reached}`}
      </div>
    </div>
  )
}
