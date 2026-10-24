import { ArrowRight, FlaskConical, Loader2, Wand2, X } from 'lucide-react'
import { useState } from 'react'
import type { Diff, Run } from '../api'
import { api, pretty } from '../api'
import { Button, Card, Meter, cx } from '../ui'
import { METRICS, ScoreCard } from './HealthStrip'

/** Run-level "Recommended fix" banner: what to change, one click to re-test, then before/after. */
export default function PrescriptionRail({ run, onOpenRun }: { run: Run; onOpenRun: (id: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [diff, setDiff] = useState<{ id: string; d: Diff } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const p = run.prescription
  if (run.status !== 'done' || !p) return null
  const patch = p.patch ?? {}
  const failures = run.diagnoses.filter((d) => d.verdict !== 'ok').length

  async function apply() {
    setBusy(true); setErr(null); setDiff(null)
    try {
      const { run_id } = await api.fix(run.run_id)
      for (;;) {
        const r = await api.run(run_id)
        setProgress(r.progress)
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

  if (!p.sentences.length) {
    return (
      <Card className="flex items-center gap-3 border-ok/30 bg-ok/5 py-3">
        <FlaskConical className="h-4 w-4 text-ok" />
        <span className="text-[13px] text-ink-2"><b className="text-ink">No failures to fix.</b> Every question was answered correctly and grounded.</span>
      </Card>
    )
  }

  return (
    <Card className="border-accent/25 p-0">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
        <div className="flex min-w-[260px] flex-1 items-start gap-3">
          <div className="rounded-lg bg-accent/10 p-2"><Wand2 className="h-4 w-4 text-accent" /></div>
          <div>
            <div className="text-[13px] font-semibold text-ink">Recommended fix for {failures} failing question{failures === 1 ? '' : 's'}</div>
            <ul className="mt-1 space-y-0.5">
              {p.sentences.map((s) => {
                const [cause, ...rest] = s.split(': ')
                return <li key={s} className="text-xs text-muted"><span className="font-medium text-ink-2">{pretty(cause)}</span>: {rest.join(': ')}</li>
              })}
            </ul>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(patch).map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-canvas px-2 py-1 font-mono text-[11px]">
              <span className="text-muted">{k}</span>
              <span className="text-faint line-through">{String((run.config as any)[k])}</span>
              <ArrowRight className="h-3 w-3 text-faint" />
              <span className="font-semibold text-accent">{String(v)}</span>
            </span>
          ))}
        </div>
        <Button variant="primary" onClick={apply} disabled={busy || !Object.keys(patch).length} className="px-4 py-2">
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" />Re-testing {progress.done}/{progress.total || failures}</> : <><FlaskConical className="h-4 w-4" />Apply & re-test</>}
        </Button>
      </div>
      {busy && <Meter value={progress.total ? progress.done / progress.total : 0.03} className="mx-4 mb-4" />}
      {err && <p className="px-4 pb-4 text-xs text-generation">{err}</p>}

      {diff && (
        <div className="border-t border-line bg-canvas/60 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-ink">Before → after</span>
            <span className="text-xs text-muted">on the {diff.d.rows.length} questions that failed</span>
            <span className="rounded-full bg-ok/12 px-2 py-0.5 text-[11px] font-semibold text-ok">{diff.d.counts.fixed} fixed</span>
            <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', diff.d.counts.broken ? 'bg-generation/12 text-generation' : 'bg-subtle text-muted')}>{diff.d.counts.broken} broken</span>
            <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-semibold text-muted">{diff.d.counts.unchanged} unchanged</span>
            <div className="ml-auto flex gap-2">
              <Button onClick={() => onOpenRun(diff.id)}>Open re-test run</Button>
              <Button variant="ghost" onClick={() => setDiff(null)} title="Dismiss"><X className="h-4 w-4" /></Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {METRICS.map((m) => (
              <ScoreCard key={m.key} compact label={m.label} Icon={m.Icon} s={diff.d.after[m.key]} delta={diff.d.deltas[m.key]}
                hint={`was ${diff.d.before[m.key].value?.toFixed(2) ?? '—'}`} />
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
