import { ArrowRight, CheckCircle2, CircleHelp, XCircle } from 'lucide-react'
import type { LensResult } from '../api'
import { Card, SectionTitle, cx } from '../ui'

const LABEL: Record<string, { title: string; what: string }> = {
  original: { title: 'Original', what: 'What the RAG retrieved' },
  gold_only: { title: 'Gold chunk only', what: 'Same model, only the right chunk' },
  no_context: { title: 'No context', what: 'Does the model know it from memory?' },
  shuffled: { title: 'Shuffled order', what: 'Is it sensitive to chunk order?' },
}

export default function CounterfactualStrip({ lens, gold }: { lens?: LensResult; gold?: string | null }) {
  const runs: { condition: string; answer: string; correct: boolean | null; n_chunks?: number }[] = lens?.evidence?.runs ?? []
  if (!runs.length) return null
  return (
    <Card>
      <SectionTitle hint="same generator, different context: if swapping in the gold chunk fixes it, retrieval was at fault">
        Counterfactual re-runs
      </SectionTitle>
      {gold && <p className="mb-3 text-xs text-muted">Expected: <b className="text-ink">{gold}</b></p>}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
        {runs.map((r, i) => {
          const meta = LABEL[r.condition] ?? { title: r.condition, what: '' }
          return (
            <div key={r.condition} className="flex flex-1 items-center gap-2">
              {i > 0 && <ArrowRight className="hidden h-4 w-4 shrink-0 text-faint lg:block" />}
              <div className={cx('h-full flex-1 rounded-lg border p-3',
                r.correct ? 'border-ok/40 bg-ok/8' : r.correct === false ? 'border-generation/35 bg-generation/6' : 'border-line bg-subtle')}>
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                  {r.correct ? <CheckCircle2 className="h-4 w-4 text-ok" /> : r.correct === false ? <XCircle className="h-4 w-4 text-generation" /> : <CircleHelp className="h-4 w-4 text-faint" />}
                  {meta.title}
                  {r.n_chunks != null && <span className="ml-auto text-[11px] font-normal text-faint">{r.n_chunks} chunk{r.n_chunks === 1 ? '' : 's'}</span>}
                </div>
                <div className="mt-0.5 text-[11px] text-faint">{meta.what}</div>
                <p className="mt-2 text-xs leading-relaxed text-ink-2">{r.answer}</p>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
