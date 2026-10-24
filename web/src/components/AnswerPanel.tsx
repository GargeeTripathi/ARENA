import type { LensResult, RagTrace } from '../api'

type Span = { start: number; end: number; text: string; prob: number }
type Sent = { text: string; supported: boolean; score: number | null; best_chunk_id: string | null }

/** Split [start,end) of the answer into plain / hallucinated-span segments. */
function segments(answer: string, start: number, end: number, spans: Span[]) {
  const cuts = spans.filter((s) => s.prob > 0.5 && s.start < end && s.end > start)
  const out: { text: string; bad: boolean; prob?: number }[] = []
  let pos = start
  for (const s of cuts.sort((a, b) => a.start - b.start)) {
    const a = Math.max(s.start, pos), b = Math.min(s.end, end)
    if (a > pos) out.push({ text: answer.slice(pos, a), bad: false })
    if (b > a) out.push({ text: answer.slice(a, b), bad: true, prob: s.prob })
    pos = Math.max(pos, b)
  }
  if (pos < end) out.push({ text: answer.slice(pos, end), bad: false })
  return out
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
    return { s, i, start, end: start + s.length, g: sents?.[i] }
  })

  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-2 flex items-center gap-3 text-xs font-semibold text-slate-500">
        RAG answer
        <span className="flex items-center gap-1 font-normal text-slate-400"><span className="h-2 w-2 rounded-sm bg-emerald-200" />supported</span>
        <span className="flex items-center gap-1 font-normal text-slate-400"><span className="h-2 w-2 rounded-sm bg-rose-200" />unsupported</span>
        <span className="flex items-center gap-1 font-normal text-slate-400"><span className="border-b-2 border-rose-500 px-1 text-[10px]">abc</span>flagged span</span>
      </div>
      <div className="rounded-lg bg-white p-3 text-sm leading-7 ring-1 ring-slate-200">
        {placed.map(({ i, start, end, g }) => (
          <span
            key={i}
            onMouseEnter={() => onHover(g?.best_chunk_id ?? null)}
            onMouseLeave={() => onHover(null)}
            title={g ? `${g.supported ? 'supported' : 'NOT supported'}${g.score != null ? ` (score ${g.score})` : ''}${g.best_chunk_id ? ` · best chunk ${g.best_chunk_id}` : ''}` : undefined}
            className={`rounded px-0.5 ${g ? (g.supported ? 'bg-emerald-100/80 hover:bg-emerald-200' : 'bg-rose-100 hover:bg-rose-200') : ''}`}
          >
            {segments(trace.answer, start, end, spans).map((seg, j) =>
              seg.bad
                ? <mark key={j} className="bg-transparent border-b-2 border-rose-500 text-rose-700" title={`hallucination p=${seg.prob}`}>{seg.text}</mark>
                : <span key={j}>{seg.text}</span>)}
            {' '}
          </span>
        ))}
        {!trace.answer && <span className="text-slate-400">(empty answer)</span>}
      </div>
      {!sents && <p className="mt-1.5 text-[11px] text-slate-400">Sentence grounding not needed for this question (resolved before Tier 2).</p>}
    </div>
  )
}
