import { Star } from 'lucide-react'
import { useState } from 'react'
import type { RetrievedChunk } from '../api'

export default function ChunkPanel({ chunks, gold, k, highlight }: {
  chunks: RetrievedChunk[]; gold: string[]; k: number; highlight: string | null
}) {
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const goldSet = new Set(gold)
  const shown = all ? chunks : chunks.filter((c) => c.rank <= Math.max(k + 3, 8) || goldSet.has(c.chunk_id))
  const goldMissing = gold.length > 0 && !chunks.some((c) => goldSet.has(c.chunk_id))

  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-500">
        Retrieved chunks <span className="font-normal text-slate-400">top {chunks.length}, k = {k}</span>
        <button className="ml-auto font-medium text-indigo-600 hover:underline" onClick={() => setAll(!all)}>
          {all ? 'show fewer' : 'show all'}
        </button>
      </div>
      {goldMissing && (
        <div className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
          Gold chunk not in the top {chunks.length} at all (recall miss).
        </div>
      )}
      <div className="space-y-1.5 overflow-y-auto pr-1">
        {shown.map((c, i) => {
          const isGold = goldSet.has(c.chunk_id)
          const lit = highlight === c.chunk_id
          const cut = i > 0 && shown[i - 1].in_context && !c.in_context
          return (
            <div key={c.chunk_id}>
              {cut && <div className="my-1.5 border-t border-dashed border-slate-300 text-center text-[10px] uppercase tracking-wide text-slate-400">cut-off k = {k}</div>}
              <button
                onClick={() => setOpen(open === c.chunk_id ? null : c.chunk_id)}
                className={`w-full rounded-lg p-2 text-left text-xs transition ring-1
                  ${isGold ? 'ring-2 ring-indigo-500' : 'ring-slate-200'}
                  ${lit ? 'bg-emerald-50' : c.in_context ? 'bg-white' : 'bg-slate-50 opacity-70'}`}
              >
                <div className="mb-1 flex items-center gap-1.5 text-[11px] text-slate-400">
                  <span className="font-semibold tabular-nums text-slate-600">#{c.rank}</span>
                  <span className="tabular-nums">{c.score.toFixed(3)}</span>
                  <span className="truncate">{c.chunk_id}</span>
                  {isGold && <span className="ml-auto flex items-center gap-0.5 font-semibold text-indigo-600"><Star className="h-3 w-3" />gold</span>}
                  {!isGold && c.in_context && <span className="ml-auto text-slate-500">in context</span>}
                </div>
                <div className={`whitespace-pre-wrap leading-relaxed text-slate-600 ${open === c.chunk_id ? '' : 'line-clamp-3'}`}>{c.text}</div>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
