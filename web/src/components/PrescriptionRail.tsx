import { ArrowRight, CheckCircle2, FileSearch, FlaskConical, Loader2, Pill, ShieldCheck, Target, Wrench } from 'lucide-react'
import { useState } from 'react'
import type { Diagnosis, Diff, Run } from '../api'
import { api, pretty } from '../api'
import { ScoreCard } from './HealthStrip'

const ICONS = { context_relevance: FileSearch, faithfulness: ShieldCheck, accuracy: Target, abstention: CheckCircle2 } as const

export default function PrescriptionRail({ run, selected, onOpenRun }: {
  run: Run; selected?: Diagnosis; onOpenRun: (id: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string>('')
  const [diff, setDiff] = useState<{ id: string; d: Diff } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const p = run.prescription
  const patch = p?.patch ?? {}

  async function apply() {
    setBusy(true); setErr(null); setDiff(null)
    try {
      const { run_id } = await api.fix(run.run_id)
      for (;;) {
        const r = await api.run(run_id)
        setProgress(`${r.progress.done}/${r.progress.total}`)
        if (r.status === 'error') throw new Error(r.error ?? 'run failed')
        if (r.status === 'done') break
        await new Promise((ok) => setTimeout(ok, 1500))
      }
      setDiff({ id: run_id, d: await api.diff(run.run_id, run_id) })
    } catch (e: any) {
      setErr(e.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {selected?.prescription && (
        <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-500"><Pill className="h-3.5 w-3.5 text-indigo-500" />This question</div>
          <p className="text-xs leading-relaxed text-slate-600">{selected.prescription}</p>
        </div>
      )}

      <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-500"><Wrench className="h-3.5 w-3.5 text-indigo-500" />Prescription for this run</div>
        {run.status !== 'done' ? <p className="text-xs text-slate-400">Available when the run finishes.</p>
          : !p?.sentences.length ? <p className="text-xs text-emerald-600">No failures to fix.</p>
          : (
            <>
              <ul className="space-y-1.5 text-xs leading-relaxed text-slate-600">
                {p.sentences.map((s) => {
                  const [cause, ...rest] = s.split(': ')
                  return <li key={s}><b className="text-slate-700">{pretty(cause)}</b>: {rest.join(': ')}</li>
                })}
              </ul>
              <div className="mt-2.5 space-y-1">
                {Object.entries(patch).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1 font-mono text-[11px]">
                    <span className="text-slate-500">{k}</span>
                    <span className="ml-auto text-slate-400 line-through">{String((run.config as any)[k])}</span>
                    <ArrowRight className="h-3 w-3 text-slate-400" />
                    <span className="font-semibold text-indigo-700">{String(v)}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={apply} disabled={busy || !Object.keys(patch).length}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Re-testing {progress}</> : <><FlaskConical className="h-4 w-4" /> Apply &amp; re-test</>}
              </button>
              {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
            </>
          )}
      </div>

      {diff && (
        <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
          <div className="mb-2 text-xs font-semibold text-slate-500">Before → after <span className="font-normal text-slate-400">on the {diff.d.rows.length} failed questions</span></div>
          <div className="mb-2 flex gap-1.5 text-[11px] font-semibold">
            <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700">{diff.d.counts.fixed} fixed</span>
            <span className="rounded bg-rose-50 px-2 py-0.5 text-rose-700">{diff.d.counts.broken} broken</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">{diff.d.counts.unchanged} unchanged</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(ICONS) as (keyof typeof ICONS)[]).map((k) => (
              <ScoreCard key={k} label={pretty(k)} hint={`was ${diff.d.before[k].value?.toFixed(2) ?? '—'}`} Icon={ICONS[k]} s={diff.d.after[k]} delta={diff.d.deltas[k]} />
            ))}
          </div>
          <button onClick={() => onOpenRun(diff.id)} className="mt-2.5 w-full rounded-lg px-3 py-1.5 text-xs font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50">
            Open the re-test run
          </button>
        </div>
      )}
    </div>
  )
}
