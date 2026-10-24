import type { LensResult, RagTrace } from '../api'
import { Card, SectionTitle, cx } from '../ui'

type Span = { start: number; end: number; text: string; prob: number }
type Sent = { text: string; supported: boolean; score: number | null; best_chunk_id: string | null }

/** Split [start,end) of the answer into plain / flagged-span segments. */
function segments(answer: string, start: number, end: number, spans: Span[]) {
  const cuts = spans.filter((s) => s.prob > 0.5 && s.start < end && s.end > start).sort((a, b) => a.start - b.start)
  const out: { text: string; bad: boolean; prob?: number }[] = []
  let pos = start
  for (const s of cuts) {
    const a = Math.max(s.start, pos), b = Math.min(s.end, end)
    if (a > pos) out.push({ text: answer.slice(pos, a), bad: false })
    if (b > a) out.push({ text: answer.slice(a, b), bad: true, prob: s.prob })
    pos = Math.max(pos, b)
  }
  if (pos < end) out.push({ text: answer.slice(pos, end), bad: false })
  return out
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5 text-[11px] text-muted"><span className={cx('h-2.5 w-2.5 rounded-sm', swatch)} />{label}</span>
}

export default function AnswerPanel({ trace, lenses, onHover }: {
  trace: RagTrace; lenses: Record<string, LensResult>; onHover: (chunkId: string | null) => void
}) {
  const spans: Span[] = lenses.span_detector?.evidence?.spans ?? []
  const sents: Sent[] | undefined = lenses.grounding?.evidence?.sentences
  let pos = 0
  const placed = trace.answer_sentences.map((s, i) => {
    const start = Math.max(trace.answer.indexOf(s, pos), 0)
    pos = start + s.length
    return { i, start, end: start + s.length, g: sents?.[i] }
  })

  return (
    <Card>
      <SectionTitle hint="hover a sentence to see the chunk that supports it"
        right={<div className="flex gap-3"><Legend swatch="bg-ok/25" label="supported" /><Legend swatch="bg-generation/25" label="unsupported" />
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted"><span className="border-b-2 border-generation px-0.5 text-[10px] leading-none">ab</span>flagged span</span></div>}>
        What the RAG answered
      </SectionTitle>
      <div className="rounded-lg bg-canvas px-4 py-3 text-[14px] leading-7 text-ink">
        {placed.map(({ i, start, end, g }) => (
          <span key={i}
            onMouseEnter={() => onHover(g?.best_chunk_id ?? null)} onMouseLeave={() => onHover(null)}
            title={g ? `${g.supported ? 'Supported' : 'Not supported'}${g.score != null ? ` · score ${g.score}` : ''}${g.best_chunk_id ? ` · best chunk ${g.best_chunk_id}` : ''}` : undefined}
            className={cx('rounded px-0.5 transition-colors', g && (g.supported ? 'bg-ok/12 hover:bg-ok/25' : 'bg-generation/12 hover:bg-generation/25'))}>
            {segments(trace.answer, start, end, spans).map((seg, j) => seg.bad
              ? <mark key={j} className="border-b-2 border-generation bg-transparent text-generation" title={`flagged, p=${seg.prob}`}>{seg.text}</mark>
              : <span key={j}>{seg.text}</span>)}
            {' '}
          </span>
        ))}
        {!trace.answer && <span className="text-faint">(empty answer)</span>}
      </div>
      {!sents && <p className="mt-2 text-[11px] text-faint">Sentence-level grounding wasn't needed: the cheap Tier 1 checks settled this question.</p>}
    </Card>
  )
}
