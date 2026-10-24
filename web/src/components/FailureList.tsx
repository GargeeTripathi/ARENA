import { AlertTriangle } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Diagnosis, TestQuestion, Verdict } from '../api'
import { VERDICT_STYLE, pretty } from '../api'

const QTYPES = ['all', 'single_hop', 'numeric', 'unanswerable']
const VERDICTS: ('all' | Verdict)[] = ['all', 'retrieval', 'generation', 'abstention', 'uncertain', 'ok']

export default function FailureList({ questions, diagnoses, selected, onSelect }: {
  questions: TestQuestion[]; diagnoses: Diagnosis[]; selected: string | null; onSelect: (qid: string) => void
}) {
  const [qtype, setQtype] = useState('all')
  const [verdict, setVerdict] = useState<'all' | Verdict>('all')
  const qs = useMemo(() => Object.fromEntries(questions.map((q) => [q.qid, q])), [questions])
  const rows = useMemo(
    () => diagnoses
      .filter((d) => (qtype === 'all' || qs[d.qid]?.qtype === qtype) && (verdict === 'all' || d.verdict === verdict))
      .sort((a, b) => Number(a.verdict === 'ok') - Number(b.verdict === 'ok') || b.confidence - a.confidence),
    [diagnoses, qs, qtype, verdict],
  )
  const sel = 'rounded-md border-0 bg-slate-100 py-1 pl-2 pr-6 text-xs text-slate-600 focus:ring-2 focus:ring-indigo-500'

  return (
    <div className="flex h-full flex-col rounded-xl bg-white ring-1 ring-slate-200">
      <div className="flex items-center gap-2 border-b border-slate-100 p-2.5">
        <span className="text-sm font-semibold">Questions</span>
        <span className="text-xs text-slate-400 tabular-nums">{rows.length}</span>
        <select className={`${sel} ml-auto`} value={qtype} onChange={(e) => setQtype(e.target.value)} aria-label="Filter by type">
          {QTYPES.map((t) => <option key={t} value={t}>{t === 'all' ? 'all types' : pretty(t)}</option>)}
        </select>
        <select className={sel} value={verdict} onChange={(e) => setVerdict(e.target.value as Verdict)} aria-label="Filter by verdict">
          {VERDICTS.map((v) => <option key={v} value={v}>{v === 'all' ? 'all verdicts' : v}</option>)}
        </select>
      </div>
      <ul className="flex-1 overflow-y-auto">
        {rows.map((d) => {
          const q = qs[d.qid]
          const st = VERDICT_STYLE[d.verdict]
          return (
            <li key={d.qid}>
              <button
                onClick={() => onSelect(d.qid)}
                className={`flex w-full items-start gap-2.5 border-b border-slate-50 px-3 py-2 text-left hover:bg-slate-50 ${selected === d.qid ? 'bg-indigo-50/70' : ''}`}
              >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${st.dot}`} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[13px] leading-snug text-slate-700">{q?.question ?? d.qid}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                    <span className={st.text}>{d.verdict === 'ok' ? 'ok' : pretty(d.sub_cause ?? d.verdict)}</span>
                    <span>· {pretty(q?.qtype)}</span>
                    <span>· T{d.max_tier_reached}</span>
                    {d.needs_review && <AlertTriangle className="h-3 w-3 text-amber-500" aria-label="needs review" />}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
        {!rows.length && <li className="p-4 text-center text-xs text-slate-400">Nothing here yet</li>}
      </ul>
    </div>
  )
}
