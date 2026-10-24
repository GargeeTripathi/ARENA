import { CheckCircle2, CircleHelp, XCircle } from 'lucide-react'
import type { LensResult } from '../api'

const LABEL: Record<string, string> = {
  original: 'Original context', gold_only: 'Gold chunk only', no_context: 'No context', shuffled: 'Shuffled order',
}

export default function CounterfactualStrip({ lens }: { lens?: LensResult }) {
  const runs: { condition: string; answer: string; correct: boolean | null; n_chunks?: number }[] = lens?.evidence?.runs ?? []
  if (!runs.length) return null
  return (
    <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
      <div className="mb-2 text-xs font-semibold text-slate-500">Counterfactual re-runs <span className="font-normal text-slate-400">same generator, swapped context</span></div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {runs.map((r) => (
          <div key={r.condition} className={`rounded-md p-2 ring-1 ${r.correct ? 'bg-emerald-50 ring-emerald-200' : r.correct === false ? 'bg-rose-50 ring-rose-200' : 'bg-slate-50 ring-slate-200'}`}>
            <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-600">
              {r.correct ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : r.correct === false ? <XCircle className="h-3.5 w-3.5 text-rose-600" /> : <CircleHelp className="h-3.5 w-3.5 text-slate-400" />}
              {LABEL[r.condition] ?? r.condition}
              {r.n_chunks != null && <span className="ml-auto font-normal text-slate-400">{r.n_chunks} chunk{r.n_chunks === 1 ? '' : 's'}</span>}
            </div>
            <div className="mt-1 line-clamp-3 text-[11px] leading-snug text-slate-600" title={r.answer}>{r.answer}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
