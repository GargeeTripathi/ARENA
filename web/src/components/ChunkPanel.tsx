import { ChevronDown, Star } from 'lucide-react'
import { useState } from 'react'
import type { RetrievedChunk } from '../api'
import { Button, Card, SectionTitle, cx } from '../ui'

export default function ChunkPanel({ chunks, gold, k, highlight }: {
  chunks: RetrievedChunk[]; gold: string[]; k: number; highlight: string | null
}) {
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const goldSet = new Set(gold)
  const goldRank = chunks.find((c) => goldSet.has(c.chunk_id))?.rank
  const shown = all ? chunks : chunks.filter((c) => c.rank <= Math.max(k + 2, 5) || goldSet.has(c.chunk_id))

  return (
    <Card>
      <SectionTitle hint={`top ${chunks.length} ranked · first ${k} sent to the model`}
        right={<Button variant="ghost" onClick={() => setAll(!all)} className="py-1 text-xs">{all ? 'Show fewer' : `Show all ${chunks.length}`}</Button>}>
        Retrieved chunks
      </SectionTitle>

      {gold.length > 0 && (
        <div className={cx('mb-3 rounded-lg px-3 py-2 text-xs',
          goldRank && goldRank <= k ? 'bg-ok/8 text-ink-2' : 'bg-retrieval/10 text-ink-2')}>
          {goldRank === undefined
            ? <><b className="text-retrieval">Gold chunk not retrieved at all</b> in the top {chunks.length} (recall miss).</>
            : goldRank <= k
              ? <><b className="text-ok">Gold chunk at rank {goldRank}</b>, inside the context window.</>
              : <><b className="text-retrieval">Gold chunk at rank {goldRank}</b>, just below the cut-off of k = {k}.</>}
        </div>
      )}

      <div className="space-y-2">
        {shown.map((c, i) => {
          const isGold = goldSet.has(c.chunk_id)
          const lit = highlight === c.chunk_id
          const cut = i > 0 && shown[i - 1].in_context && !c.in_context
          return (
            <div key={c.chunk_id}>
              {cut && (
                <div className="my-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-faint">
                  <span className="h-px flex-1 bg-line" />not sent to the model (k = {k})<span className="h-px flex-1 bg-line" />
                </div>
              )}
              <button onClick={() => setOpen(open === c.chunk_id ? null : c.chunk_id)}
                className={cx('w-full rounded-lg border p-3 text-left transition',
                  isGold ? 'border-accent/60 ring-1 ring-accent/30' : 'border-line',
                  lit ? 'bg-ok/10' : c.in_context ? 'bg-surface hover:bg-subtle' : 'bg-canvas opacity-75 hover:opacity-100')}>
                <div className="mb-1.5 flex items-center gap-2 text-[11px]">
                  <span className="rounded bg-subtle px-1.5 py-0.5 font-semibold tabular-nums text-ink-2">#{c.rank}</span>
                  <span className="tabular-nums text-faint">score {c.score.toFixed(3)}</span>
                  <span className="truncate font-mono text-faint">{c.chunk_id}</span>
                  <span className="ml-auto flex items-center gap-2">
                    {isGold && <span className="inline-flex items-center gap-1 font-semibold text-accent"><Star className="h-3 w-3 fill-current" />gold</span>}
                    {c.in_context && <span className="text-muted">in context</span>}
                    <ChevronDown className={cx('h-3.5 w-3.5 text-faint transition', open === c.chunk_id && 'rotate-180')} />
                  </span>
                </div>
                <div className={cx('whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-2', open !== c.chunk_id && 'line-clamp-3')}>{c.text}</div>
              </button>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
