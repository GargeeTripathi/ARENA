import { Activity, Database, Loader2, Play, Sparkles, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CorpusInfo, Cost, RagConfig, Run, RunSummary, Scorecards, TestQuestion } from './api'
import { BAD_CONFIG, DEFAULT_CONFIG, api } from './api'
import AutopsyView from './components/AutopsyView'
import FailureList from './components/FailureList'
import HealthStrip from './components/HealthStrip'
import PrescriptionRail from './components/PrescriptionRail'

const PRESETS: Record<string, RagConfig> = { 'Seeded bad config': BAD_CONFIG, Default: DEFAULT_CONFIG }
const save = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* storage blocked */ } }
const load = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }

export default function App() {
  const [corpus, setCorpus] = useState<CorpusInfo | null>(null)
  const [questions, setQuestions] = useState<TestQuestion[]>([])
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [run, setRun] = useState<Run | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [preset, setPreset] = useState('Seeded bad config')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

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
    setRun(r); save('run', id)
    setSelected((s) => (s && r.diagnoses.some((d) => d.qid === s) ? s : r.diagnoses.find((d) => d.verdict !== 'ok')?.qid ?? r.diagnoses[0]?.qid ?? null))
  }, [])

  // restore last session
  useEffect(() => {
    const c = load('corpus'), r = load('run')
    if (c) openCorpus(JSON.parse(c)).then(() => { if (r) return openRun(r) }).catch(() => {})
  }, [openCorpus, openRun])

  // poll a running run
  useEffect(() => {
    if (run?.status !== 'running') return
    const t = setInterval(() => openRun(run.run_id).catch(() => {}), 1500)
    return () => clearInterval(t)
  }, [run?.status, run?.run_id, openRun])
  useEffect(() => { if (run?.status === 'done' && corpus) api.runs(corpus.corpus_id).then(setRuns).catch(() => {}) }, [run?.status, corpus])

  const sc = run && 'accuracy' in run.scorecards ? (run.scorecards as Scorecards) : undefined
  const cost = run && 'avg_llm_calls' in run.cost ? (run.cost as Cost) : undefined
  const btn = 'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50'

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
        <div className="mr-3 flex items-center gap-2">
          <Activity className="h-5 w-5 text-indigo-600" />
          <span className="font-semibold tracking-tight">RAG Autopsy</span>
        </div>

        <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.txt,.md" className="hidden"
          onChange={(e) => e.target.files?.length && act('upload', async () => { await openCorpus(await api.upload(e.target.files!)); setRun(null) })} />
        <button className={`${btn} ring-1 ring-slate-200 hover:bg-slate-50`} disabled={!!busy} onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4" /> Upload docs
        </button>
        <button className={`${btn} ring-1 ring-slate-200 hover:bg-slate-50`} disabled={!!busy}
          onClick={() => act('demo', async () => { await openCorpus(await api.demo()); setRun(null) })}>
          <Database className="h-4 w-4" /> Demo corpus
        </button>
        {corpus && (
          <span className="text-xs text-slate-500 tabular-nums">
            {corpus.n_docs} docs · {corpus.n_chunks} chunks · <b>{questions.length}</b> questions
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button className={`${btn} ring-1 ring-slate-200 hover:bg-slate-50`} disabled={!corpus || !!busy}
            onClick={() => act('generate', async () => setQuestions(await api.generate(corpus!.corpus_id)))}>
            {busy === 'generate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy === 'generate' ? 'Generating… (minutes on a local LLM)' : 'Generate questions'}
          </button>
          <select value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="RAG config"
            className="rounded-lg border-0 bg-slate-100 py-1.5 pl-2.5 pr-7 text-sm text-slate-700 focus:ring-2 focus:ring-indigo-500">
            {Object.keys(PRESETS).map((p) => <option key={p}>{p}</option>)}
          </select>
          <button className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`} disabled={!corpus || !questions.length || !!busy || run?.status === 'running'}
            onClick={() => act('run', async () => openRun((await api.startRun(corpus!.corpus_id, PRESETS[preset])).run_id))}>
            <Play className="h-4 w-4" /> Run evaluation
          </button>
          {runs.length > 0 && (
            <select value={run?.run_id ?? ''} onChange={(e) => openRun(e.target.value)} aria-label="Open a past run"
              className="max-w-[220px] rounded-lg border-0 bg-slate-100 py-1.5 pl-2.5 pr-7 text-xs text-slate-600">
              <option value="" disabled>past runs</option>
              {runs.map((r) => (
                <option key={r.run_id} value={r.run_id}>
                  {r.run_id} · {r.config.chunk_size}/{r.config.k}/{r.config.retrieval}{r.config.rerank ? '+rr' : ''}/{r.config.prompt_style}{r.parent_run_id ? ' (fix)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>

      {err && <div className="bg-rose-50 px-4 py-1.5 text-sm text-rose-700">{err}</div>}
      {run?.status === 'running' && (
        <div className="flex items-center gap-2 bg-indigo-50 px-4 py-1.5 text-sm text-indigo-700">
          <Loader2 className="h-4 w-4 animate-spin" /> Evaluating {run.progress.done}/{run.progress.total} questions…
          <div className="h-1.5 w-40 rounded-full bg-indigo-100"><div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${(100 * run.progress.done) / Math.max(run.progress.total, 1)}%` }} /></div>
        </div>
      )}
      {run?.status === 'error' && <div className="bg-rose-50 px-4 py-1.5 text-sm text-rose-700">Run failed: {run.error}</div>}

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <HealthStrip sc={sc} cost={cost} />
        {run ? (
          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[300px_minmax(0,1fr)_290px]">
            <div className="min-h-[300px] lg:min-h-0">
              <FailureList questions={run.questions} diagnoses={run.diagnoses} selected={selected} onSelect={setSelected} />
            </div>
            <div className="min-h-0 overflow-y-auto">
              {selected ? <AutopsyView runId={run.run_id} qid={selected} version={run.progress.done} />
                : <div className="p-10 text-center text-sm text-slate-400">Select a question</div>}
            </div>
            <div className="min-h-0 overflow-y-auto">
              <PrescriptionRail run={run} selected={run.diagnoses.find((d) => d.qid === selected)} onOpenRun={openRun} />
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-xl bg-white text-sm text-slate-400 ring-1 ring-slate-200">
            {corpus ? (questions.length ? 'Pick a config and press Run evaluation.' : 'Generate test questions to start.') : 'Upload documents or load the demo corpus.'}
          </div>
        )}
      </main>
    </div>
  )
}
