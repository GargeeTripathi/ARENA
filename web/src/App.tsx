import { Activity, Loader2, Monitor, Moon, Plus, Stethoscope, Sun } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { CorpusInfo, Cost, Run, RunSummary, Scorecards, TestQuestion } from './api'
import { BAD_CONFIG, DEFAULT_CONFIG, api } from './api'
import AutopsyView from './components/AutopsyView'
import FailureList from './components/FailureList'
import HealthStrip from './components/HealthStrip'
import PrescriptionRail from './components/PrescriptionRail'
import Setup, { type Preset } from './components/Setup'
import { Button, Empty, Meter, Tag } from './ui'

const save = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* storage blocked */ } }
const load = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }

type Theme = 'system' | 'light' | 'dark'
function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (load('theme') as Theme) || 'system')
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && mq.matches))
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
  const next = () => setTheme((t) => { const n: Theme = t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system'; save('theme', n); return n })
  return [theme, next]
}

const configLabel = (c: RunSummary['config']) =>
  `${c.chunk_size}w · k=${c.k} · ${c.retrieval}${c.rerank ? ' + rerank' : ''} · ${c.prompt_style} prompt`

export default function App() {
  const [theme, cycleTheme] = useTheme()
  const [corpus, setCorpus] = useState<CorpusInfo | null>(null)
  const [questions, setQuestions] = useState<TestQuestion[]>([])
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [run, setRun] = useState<Run | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [preset, setPreset] = useState<Preset>('bad')
  const [setup, setSetup] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setErr(null)
    try { await fn() } catch (e: any) { setErr(e.message ?? String(e)) } finally { setBusy(null) }
  }

  const openCorpus = useCallback(async (c: CorpusInfo) => {
    setCorpus(c); save('corpus', JSON.stringify(c))
    setQuestions(await api.questions(c.corpus_id))
    setRuns(await api.runs(c.corpus_id))
  }, [])

  const openRun = useCallback(async (id: string) => {
    const r = await api.run(id)
    setRun(r); setSetup(false); save('run', id)
    setSelected((s) => (s && r.diagnoses.some((d) => d.qid === s) ? s
      : r.diagnoses.find((d) => d.verdict !== 'ok')?.qid ?? r.diagnoses[0]?.qid ?? null))
  }, [])

  useEffect(() => { // restore last session
    const c = load('corpus'), r = load('run')
    if (c) openCorpus(JSON.parse(c)).then(() => { if (r) return openRun(r) }).catch(() => {})
  }, [openCorpus, openRun])

  useEffect(() => { // poll a running run
    if (run?.status !== 'running') return
    const t = setInterval(() => openRun(run.run_id).catch(() => {}), 1500)
    return () => clearInterval(t)
  }, [run?.status, run?.run_id, openRun])
  useEffect(() => { if (run?.status === 'done' && corpus) api.runs(corpus.corpus_id).then(setRuns).catch(() => {}) }, [run?.status, corpus])

  const sc = run && 'accuracy' in run.scorecards ? (run.scorecards as Scorecards) : undefined
  const cost = run && 'avg_llm_calls' in run.cost ? (run.cost as Cost) : undefined
  const showSetup = setup || !run
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent"><Stethoscope className="h-4 w-4 text-accent-ink" /></div>
            <div className="leading-tight">
              <div className="text-[14px] font-semibold tracking-tight text-ink">RAG Autopsy</div>
              <div className="text-[10px] text-faint">Why your RAG gets answers wrong</div>
            </div>
          </div>

          {corpus && (
            <div className="ml-4 hidden items-center gap-2 text-xs text-muted md:flex">
              <Tag>{corpus.n_docs} docs</Tag><Tag>{questions.length} questions</Tag>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            {runs.length > 0 && (
              <select value={run?.run_id ?? ''} onChange={(e) => act('open', () => openRun(e.target.value))} aria-label="Open a run"
                className="max-w-[340px] rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink-2 outline-none focus:border-accent">
                <option value="" disabled>Open a run…</option>
                {runs.slice(0, 15).map((r) => {
                  const fails = Object.entries(r.scorecards?.root_causes ?? {}).filter(([c]) => c !== 'ok').reduce((a, [, n]) => a + n, 0)
                  return <option key={r.run_id} value={r.run_id}>{r.parent_run_id ? '↳ re-test · ' : ''}{configLabel(r.config)} · {fails} failing</option>
                })}
              </select>
            )}
            <Button onClick={() => setSetup(true)} variant={showSetup ? 'secondary' : 'primary'} disabled={showSetup}>
              <Plus className="h-4 w-4" />New evaluation
            </Button>
            <Button variant="ghost" onClick={cycleTheme} title={`Theme: ${theme}`} className="px-2"><ThemeIcon className="h-4 w-4" /></Button>
          </div>
        </div>
        {run?.status === 'running' && (
          <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-5 pb-2 text-xs text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
            Evaluating {run.progress.done} of {run.progress.total} questions
            <Meter value={run.progress.done / Math.max(run.progress.total, 1)} className="w-48" />
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1440px] space-y-5 px-5 py-6">
        {err && <div className="rounded-lg border border-generation/30 bg-generation/8 px-4 py-2.5 text-[13px] text-generation">{err}</div>}
        {run?.status === 'error' && <div className="rounded-lg border border-generation/30 bg-generation/8 px-4 py-2.5 text-[13px] text-generation">Run failed: {run.error}</div>}

        {showSetup ? (
          <section>
            <div className="mb-4 flex items-end gap-3">
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-ink">Set up an evaluation</h1>
                <p className="mt-1 text-[13px] text-muted">Three steps: give us documents, we write test questions with known answers, then we diagnose every failure.</p>
              </div>
              {run && <Button variant="ghost" className="ml-auto" onClick={() => setSetup(false)}>Back to current run</Button>}
            </div>
            <Setup corpus={corpus} questions={questions} busy={busy} preset={preset} setPreset={setPreset}
              onUpload={(f) => act('upload', async () => { await openCorpus(await api.upload(f)); setRun(null) })}
              onDemo={() => act('demo', async () => { await openCorpus(await api.demo()); setRun(null) })}
              onGenerate={() => act('generate', async () => setQuestions(await api.generate(corpus!.corpus_id)))}
              onRun={() => act('run', async () => openRun((await api.startRun(corpus!.corpus_id, preset === 'bad' ? BAD_CONFIG : DEFAULT_CONFIG)).run_id))} />
          </section>
        ) : run && (
          <>
            <section className="flex flex-wrap items-center gap-2">
              <h1 className="mr-2 text-xl font-semibold tracking-tight text-ink">{run.parent_run_id ? 'Re-test run' : 'Evaluation run'}</h1>
              <Tag className="font-mono">{run.config.chunk_size}-word chunks</Tag>
              <Tag className="font-mono">k = {run.config.k}</Tag>
              <Tag className="font-mono">{run.config.retrieval}{run.config.rerank ? ' + rerank' : ''}</Tag>
              <Tag className="font-mono">{run.config.prompt_style} prompt</Tag>
              <span className="ml-auto font-mono text-[11px] text-faint">{run.run_id}</span>
            </section>

            <HealthStrip sc={sc} cost={cost} />
            <PrescriptionRail key={run.run_id} run={run} onOpenRun={(id) => act('open', () => openRun(id))} />

            <section className="grid items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
              <div className="h-[420px] lg:sticky lg:top-20 lg:h-[calc(100vh-6.5rem)]">
                <FailureList questions={run.questions} diagnoses={run.diagnoses} selected={selected} onSelect={setSelected} />
              </div>
              <div className="min-w-0">
                {selected
                  ? <AutopsyView key={`${run.run_id}:${selected}`} runId={run.run_id} qid={selected} />
                  : <div className="rounded-xl border border-line bg-surface"><Empty icon={<Activity className="h-6 w-6" />} title="Pick a question">Choose a question on the left to see its autopsy.</Empty></div>}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}

