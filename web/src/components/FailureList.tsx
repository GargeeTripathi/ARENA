import { Flag, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { DiagnosisSummary, TestQuestion } from '../api'
import { pretty } from '../api'
import { Segmented, VERDICT, cx } from '../ui'

type View = 'failures' | 'review' | 'all'
const TYPES = ['all', 'single_hop', 'numeric', 'unanswerable']

export default function FailureList({ questions, diagnoses, selected, onSelect }: {
  questions: TestQuestion[]; diagnoses: DiagnosisSummary[]; selected: string | null; onSelect: (qid: string) => void
}) {
  const [view, setView] = useState<View>('failures')
  const [qtype, setQtype] = useState('all')
  const [query, setQuery] = useState('')
  const qs = useMemo(() => Object.fromEntries(questions.map((q) => [q.qid, q])), [questions])
  const counts = {
    failures: diagnoses.filter((d) => d.verdict !== 'ok').length,
    review: diagnoses.filter((d) => d.needs_review).length,
    all: diagnoses.length,
  }
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return diagnoses
      .filter((d) => view === 'all' || (view === 'failures' ? d.verdict !== 'ok' : d.needs_review))
      .filter((d) => qtype === 'all' || qs[d.qid]?.qtype === qtype)
      .filter((d) => !needle || (qs[d.qid]?.question ?? '').toLowerCase().includes(needle))
      .sort((a, b) => Number(a.verdict === 'ok') - Number(b.verdict === 'ok') || b.confidence - a.confidence)
  }, [diagnoses, qs, view, qtype, query])

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-line bg-surface">
      <div className="space-y-2.5 border-b border-line p-3">
        <Segmented value={view} onChange={setView} options={[
          { value: 'failures', label: <>Failures <span className="tabular-nums text-faint">{counts.failures}</span></> },
          { value: 'review', label: <>Review <span className="tabular-nums text-faint">{counts.review}</span></> },
          { value: 'all', label: <>All <span className="tabular-nums text-faint">{counts.all}</span></> },
        ]} />
        <div className="flex gap-2">
          <label className="flex flex-1 items-center gap-1.5 rounded-lg border border-line bg-canvas px-2.5 focus-within:border-accent">
            <Search className="h-3.5 w-3.5 text-faint" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search questions"
              className="w-full bg-transparent py-1.5 text-xs text-ink outline-none placeholder:text-faint" />
          </label>
          <select value={qtype} onChange={(e) => setQtype(e.target.value)} aria-label="Question type"
            className="rounded-lg border border-line bg-canvas px-2 text-xs text-ink-2 outline-none focus:border-accent">
            {TYPES.map((t) => <option key={t} value={t}>{t === 'all' ? 'All types' : pretty(t)}</option>)}
          </select>
        </div>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {rows.map((d) => {
          const q = qs[d.qid]
          const v = VERDICT[d.verdict]
          const active = selected === d.qid
          return (
            <li key={d.qid}>
              <button onClick={() => onSelect(d.qid)}
                className={cx('group flex w-full gap-3 rounded-lg px-2.5 py-2.5 text-left transition',
                  active ? 'bg-accent/10' : 'hover:bg-subtle')}>
                <span className={cx('mt-0.5 w-1 shrink-0 self-stretch rounded-full', v.dot)} style={{ opacity: d.verdict === 'ok' ? 0.4 : 1 }} />
                <span className="min-w-0 flex-1">
                  <span className={cx('line-clamp-2 text-[13px] leading-snug', active ? 'text-ink' : 'text-ink-2')}>{q?.question ?? d.qid}</span>
                  <span className="mt-1.5 flex items-center gap-2 text-[11px]">
                    <span className={cx('font-medium', v.text)}>{d.verdict === 'ok' ? 'Healthy' : pretty(d.sub_cause ?? d.verdict)}</span>
                    <span className="text-faint">{pretty(q?.qtype)}</span>
                    <span className="text-faint">T{d.max_tier_reached}</span>
                    {d.needs_review && <Flag className="h-3 w-3 text-retrieval" aria-label="needs review" />}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
        {!rows.length && (
          <li className="px-4 py-10 text-center text-xs text-muted">
            {view === 'failures' ? 'No failures in this run.' : view === 'review' ? 'Nothing flagged for review.' : 'No questions match.'}
          </li>
        )}
      </ul>
    </div>
  )
}
