import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Autopsy } from '../api'
import { VERDICT_STYLE, api, pretty } from '../api'
import AnswerPanel from './AnswerPanel'
import ChunkPanel from './ChunkPanel'
import ConsensusPanel from './ConsensusPanel'
import CounterfactualStrip from './CounterfactualStrip'
import LensTabs from './LensTabs'

export default function AutopsyView({ runId, qid, version }: { runId: string; qid: string; version: number }) {
  const [a, setA] = useState<Autopsy | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setErr(null)
    api.autopsy(runId, qid).then((x) => live && setA(x)).catch((e) => live && setErr(String(e.message ?? e)))
    return () => { live = false }
  }, [runId, qid, version])

  if (err) return <div className="p-6 text-sm text-rose-600">{err}</div>
  if (!a || a.question.qid !== qid) return <div className="flex justify-center p-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>

  const { question: q, trace, diagnosis: d } = a
  const lenses = Object.fromEntries(d.lens_results.map((r) => [r.lens, r]))
  const st = VERDICT_STYLE[d.verdict]

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">{pretty(q.qtype)}</span>
          <span>{q.qid}</span>
          {q.closed_book_correct && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">model knows this closed-book</span>}
          <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${st.bg} ${st.text}`}>
            {st.label}{d.sub_cause ? ` · ${pretty(d.sub_cause)}` : ''}
          </span>
        </div>
        <h2 className="mt-1.5 text-base font-semibold leading-snug text-slate-800">{q.question}</h2>
        <div className="mt-1 text-xs text-slate-500">
          Gold answer: <b className="text-slate-700">{q.gold_answer ?? '— (unanswerable: should abstain)'}</b>
          {q.evidence && <span className="ml-1 text-slate-400">· evidence: “{q.evidence.slice(0, 140)}{q.evidence.length > 140 ? '…' : ''}”</span>}
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <div className="max-h-[440px] min-h-0 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 flex flex-col">
          <ChunkPanel chunks={trace.retrieved_top50} gold={a.gold_chunk_ids} k={trace.config.k} highlight={hover} />
        </div>
        <div className="space-y-3">
          <AnswerPanel trace={trace} lenses={lenses} onHover={setHover} />
          <ConsensusPanel d={d} />
        </div>
      </div>

      <CounterfactualStrip lens={lenses.counterfactual} />
      <LensTabs key={qid} d={d} />
    </div>
  )
}
