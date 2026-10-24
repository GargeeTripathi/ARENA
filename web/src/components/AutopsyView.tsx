import { Flag, FlaskConical, Lightbulb, Loader2, Microscope, ScrollText } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Autopsy } from '../api'
import { api, pretty } from '../api'
import { Card, Meter, Segmented, Tag, VERDICT, VerdictBadge, cx } from '../ui'
import AnswerPanel from './AnswerPanel'
import ChunkPanel from './ChunkPanel'
import ConsensusPanel from './ConsensusPanel'
import CounterfactualStrip from './CounterfactualStrip'
import LensTabs from './LensTabs'

type Tab = 'evidence' | 'diagnosis' | 'counterfactual'

const HEADLINE: Record<string, string> = {
  ok: 'Answered correctly and grounded in the retrieved context.',
  retrieval: 'The retriever failed to put the right chunk in front of the model.',
  generation: 'The right context was there, but the model got the answer wrong.',
  abstention: 'The model answered a question the documents cannot answer.',
  uncertain: 'The lenses could not agree on a cause.',
}

export default function AutopsyView({ runId, qid }: { runId: string; qid: string }) {
  const [a, setA] = useState<Autopsy | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('evidence')

  useEffect(() => {
    let live = true
    setErr(null)
    api.autopsy(runId, qid).then((x) => live && setA(x)).catch((e) => live && setErr(String(e.message ?? e)))
    return () => { live = false }
  }, [runId, qid])

  if (err) return <Card className="text-sm text-generation">{err}</Card>
  if (!a || a.question.qid !== qid || a.trace.qid !== qid) {
    return <div className="flex justify-center p-16"><Loader2 className="h-5 w-5 animate-spin text-faint" /></div>
  }

  const { question: q, trace, diagnosis: d } = a
  const lenses = Object.fromEntries(d.lens_results.map((r) => [r.lens, r]))
  const cf = lenses.counterfactual
  const runs: { condition: string; correct: boolean | null }[] = cf?.evidence?.runs ?? []
  const proven = runs.find((r) => r.condition === 'original')?.correct === false && runs.find((r) => r.condition === 'gold_only')?.correct
  const v = VERDICT[d.verdict]

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Tag>{pretty(q.qtype)}</Tag>
          <span className="font-mono text-[11px] text-faint">{q.qid}</span>
          {q.closed_book_correct && <Tag className="text-retrieval">model knows this from memory</Tag>}
          {d.needs_review && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-retrieval"><Flag className="h-3 w-3" />needs human review</span>}
          <div className="ml-auto"><VerdictBadge verdict={d.verdict} sub={d.sub_cause} /></div>
        </div>

        <h2 className="mt-3 text-[17px] font-semibold leading-snug text-ink">{q.question}</h2>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-subtle px-3 py-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-faint">Expected answer</div>
            <div className="mt-0.5 text-[13px] font-medium text-ink">{q.gold_answer ?? 'None (should say "I don\'t know")'}</div>
          </div>
          <div className="rounded-lg px-3 py-2" style={{ background: `color-mix(in srgb, ${v.hex} 9%, transparent)` }}>
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-faint">
              Verdict confidence
              <span className={cx('ml-auto tabular-nums normal-case tracking-normal', v.text)}>{Math.round(d.confidence * 100)}%</span>
            </div>
            <Meter value={d.confidence} color={v.hex} className="mt-1.5" />
            <div className="mt-1.5 text-[11px] text-muted">
              Settled at Tier {d.max_tier_reached} · {d.total_llm_calls + (d.total_cached_calls ?? 0)} LLM call{d.total_llm_calls + (d.total_cached_calls ?? 0) === 1 ? '' : 's'}
            </div>
          </div>
        </div>

        <p className="mt-3 text-[13px] text-ink-2">{HEADLINE[d.verdict]}</p>

        {proven && (
          <button onClick={() => setTab('counterfactual')}
            className="mt-3 flex w-full items-start gap-2.5 rounded-lg border border-ok/30 bg-ok/8 px-3 py-2.5 text-left hover:bg-ok/12">
            <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
            <span className="text-[13px] text-ink-2">
              <b className="text-ink">Proven by counterfactual.</b> Given only the gold chunk, the same model answers correctly,
              so the failure is in retrieval, not generation. <span className="text-accent">See the re-runs →</span>
            </span>
          </button>
        )}
        {d.prescription && (
          <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-accent/25 bg-accent/5 px-3 py-2.5">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <span className="text-[13px] text-ink-2"><b className="text-ink">Suggested fix.</b> {d.prescription}</span>
          </div>
        )}
      </Card>

      <div className="flex items-center gap-3">
        <Segmented value={tab} onChange={setTab} options={[
          { value: 'evidence', label: <span className="inline-flex items-center gap-1.5"><ScrollText className="h-3.5 w-3.5" />Answer & evidence</span> },
          { value: 'diagnosis', label: <span className="inline-flex items-center gap-1.5"><Microscope className="h-3.5 w-3.5" />How we diagnosed it</span> },
          ...(runs.length ? [{ value: 'counterfactual' as Tab, label: <span className="inline-flex items-center gap-1.5"><FlaskConical className="h-3.5 w-3.5" />Counterfactual</span> }] : []),
        ]} />
      </div>

      {tab === 'evidence' && (
        <div className="space-y-4">
          <AnswerPanel trace={trace} lenses={lenses} onHover={setHover} />
          <ChunkPanel chunks={trace.retrieved_top50} gold={a.gold_chunk_ids} k={trace.config.k} highlight={hover} />
        </div>
      )}
      {tab === 'diagnosis' && (
        <div className="space-y-4">
          <ConsensusPanel d={d} />
          <LensTabs d={d} />
        </div>
      )}
      {tab === 'counterfactual' && <CounterfactualStrip lens={cf} gold={q.gold_answer} />}
    </div>
  )
}
