export type Verdict = 'ok' | 'retrieval' | 'generation' | 'abstention' | 'uncertain'

export interface RagConfig {
  chunk_size: number
  chunk_overlap: number
  k: number
  retrieval: 'dense' | 'hybrid'
  rerank: boolean
  prompt_style: 'basic' | 'grounded'
}

export interface TestQuestion {
  qid: string
  qtype: string
  question: string
  gold_answer: string | null
  gold_chunk_ids: string[]
  closed_book_correct: boolean | null
  evidence: string | null
}

export interface RetrievedChunk { chunk_id: string; rank: number; score: number; text: string; in_context: boolean }
export interface RagTrace { qid: string; config: RagConfig; retrieved_top50: RetrievedChunk[]; answer: string; answer_sentences: string[] }

export interface LensResult {
  lens: string
  tier: number
  verdict: Verdict
  sub_cause: string | null
  confidence: number
  evidence: Record<string, any>
  llm_calls: number
  cached_calls?: number
  latency_ms: number
}

export interface Diagnosis {
  qid: string
  verdict: Verdict
  sub_cause: string | null
  confidence: number
  needs_review: boolean
  lens_results: LensResult[]
  max_tier_reached: number
  prescription: string | null
  total_llm_calls: number
  total_cached_calls?: number
  total_latency_ms: number
}

/** What GET /runs/{id} returns per question; full detail comes from the autopsy endpoint. */
export interface DiagnosisSummary {
  qid: string
  verdict: Verdict
  sub_cause: string | null
  confidence: number
  needs_review: boolean
  max_tier_reached: number
  prescription: string | null
  total_llm_calls: number
  total_cached_calls?: number
  lenses_run: string[]
}

export interface Score { value: number | null; lo: number | null; hi: number | null; n: number }
export interface Scorecards {
  context_relevance: Score
  faithfulness: Score
  accuracy: Score
  abstention: Score
  root_causes: Record<string, number>
  verdicts: Record<string, number>
}
export interface Cost { questions: number; total_llm_calls: number; avg_llm_calls: number; billed_llm_calls?: number; cached_llm_calls?: number; resolved_pct: Record<string, number>; total_ms: number }

export interface Run {
  run_id: string
  corpus_id: string
  config: RagConfig
  status: 'running' | 'done' | 'error'
  progress: { done: number; total: number }
  traces: RagTrace[]
  diagnoses: DiagnosisSummary[]
  scorecards: Scorecards | Record<string, never>
  cost: Cost | Record<string, never>
  prescription: { sentences: string[]; patch: Partial<RagConfig> } | null
  parent_run_id: string | null
  error: string | null
  questions: TestQuestion[]
}

export interface Autopsy { question: TestQuestion; trace: RagTrace; diagnosis: Diagnosis; gold_chunk_ids: string[] }

export interface Diff {
  before: Scorecards
  after: Scorecards
  deltas: Record<string, number | null>
  rows: { qid: string; status: 'fixed' | 'broken' | 'unchanged'; before: Verdict; after: Verdict; before_sub: string | null; after_sub: string | null }[]
  counts: { fixed: number; broken: number; unchanged: number }
  config_before: RagConfig
  config_after: RagConfig
}

export interface CorpusInfo { corpus_id: string; n_docs: number; n_chunks: number; n_questions: number }
export interface RunSummary { run_id: string; corpus_id: string; config: RagConfig; status: string; parent_run_id: string | null; scorecards?: Partial<Scorecards> }

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  if (!r.ok) {
    let msg = r.statusText
    try { msg = (await r.json()).detail ?? msg } catch { /* not json */ }
    throw new Error(msg)
  }
  return r.json()
}
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms))

/** The real backend API, at `base()` ('' = same origin, e.g. the Vite dev proxy). */
function makeLive(base: () => Promise<string>) {
  const get = async <T,>(p: string) => req<T>((await base()) + p)
  const post = async <T,>(p: string, body?: unknown) =>
    req<T>((await base()) + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  return {
    upload: async (files: FileList) => {
      const fd = new FormData()
      Array.from(files).forEach((f) => fd.append('files', f))
      return req<CorpusInfo>((await base()) + '/api/corpus', { method: 'POST', body: fd })
    },
    demo: () => post<CorpusInfo>('/api/corpus/demo'),
    corpus: (cid: string) => get<CorpusInfo>(`/api/corpus/${cid}`),
    questions: (cid: string) => get<TestQuestion[]>(`/api/corpus/${cid}/questions`),
    /** Starts generation (takes minutes) and waits for it. */
    generate: async (cid: string, n_per_type = 2) => {
      await post(`/api/corpus/${cid}/questions`, { n_per_type })
      for (;;) {
        await sleep(3000)
        const st = await get<{ state: string; error: string | null }>(`/api/corpus/${cid}/questions/status`)
        if (st.state === 'error') throw new Error(st.error ?? 'Question generation failed')
        if (st.state === 'done') return get<TestQuestion[]>(`/api/corpus/${cid}/questions`)
      }
    },
    startRun: (corpus_id: string, config: RagConfig) => post<{ run_id: string }>('/api/runs', { corpus_id, config }),
    runs: (cid: string) => get<RunSummary[]>(`/api/runs?corpus_id=${cid}`),
    run: (id: string) => get<Run>(`/api/runs/${id}`),
    autopsy: (id: string, qid: string) => get<Autopsy>(`/api/runs/${id}/questions/${qid}`),
    fix: (id: string) => post<{ run_id: string; patch: Partial<RagConfig> }>(`/api/runs/${id}/fix`, {}),
    diff: (a: string, b: string) => get<Diff>(`/api/runs/${a}/diff/${b}`),
  }
}
const liveApi = makeLive(async () => '')

/** Hosted build (VITE_STATIC=1, e.g. Vercel). The demo corpus and its two finished runs are answered from JSON
 *  files exported by backend/scripts/export_static.py, so they always work. Everything else (uploads, new
 *  questions, new runs) goes to the backend listed in /backend.json (e.g. a tunnel to the team's machine). */
export const STATIC = import.meta.env.VITE_STATIC === '1'
export const OFFLINE_MSG = "The live backend is offline right now, so uploads and new runs are unavailable. The demo below still works."

let backendCheck: Promise<string | null> | null = null
/** Base URL of the hosted backend if it's reachable, else null (re-checked on the next call). */
export function hostedBackend(): Promise<string | null> {
  backendCheck ??= fetch('/backend.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then(async (c: { api?: string } | null) => {
      const api = c?.api?.replace(/\/$/, '')
      if (!api) return null
      const ok = await fetch(`${api}/api/health`, { signal: AbortSignal.timeout(6000) }).then((r) => r.ok).catch(() => false)
      return ok ? api : null
    })
    .catch(() => null)
    .then((b) => { if (!b) backendCheck = null; return b })
  return backendCheck
}
const remote = makeLive(async () => {
  const b = await hostedBackend()
  if (!b) throw new Error(OFFLINE_MSG)
  return b
})

const file = <T,>(name: string) => req<T>(`/demo/${name}.json`)
const manifest = () => file<{ bad_run: string; fix_run: string; corpus_id: string }>('manifest')
const isDemoCorpus = async (cid: string) => cid === (await manifest()).corpus_id
const isDemoRun = async (id: string) => { const m = await manifest(); return id === m.bad_run || id === m.fix_run }

const staticApi: typeof liveApi = {
  upload: (files) => remote.upload(files),
  demo: () => file<CorpusInfo>('corpus'),
  corpus: async (cid) => (await isDemoCorpus(cid) ? file<CorpusInfo>('corpus') : remote.corpus(cid)),
  questions: async (cid) => (await isDemoCorpus(cid) ? file<TestQuestion[]>('questions') : remote.questions(cid)),
  generate: async (cid, n) => {
    if (await isDemoCorpus(cid)) throw new Error('The demo questions are already generated. Upload your own documents to generate new ones.')
    return remote.generate(cid, n)
  },
  startRun: async (cid, config) => {
    if (await isDemoCorpus(cid) && config.chunk_size === BAD_CONFIG.chunk_size && config.k === BAD_CONFIG.k) {
      return { run_id: (await manifest()).bad_run }  // the pre-computed demo run
    }
    return remote.startRun(cid, config)
  },
  runs: async (cid) => (await isDemoCorpus(cid) ? file<RunSummary[]>('runs') : remote.runs(cid)),
  run: async (id) => (await isDemoRun(id) ? file<Run>(`run_${id}`) : remote.run(id)),
  autopsy: async (id, qid) => (await isDemoRun(id) ? file<Autopsy>(`autopsy_${id}_${qid}`) : remote.autopsy(id, qid)),
  fix: async (id) => {
    const m = await manifest()
    if (id !== m.bad_run) return remote.fix(id)
    const r = await file<Run>(`run_${m.fix_run}`)
    const base = (await file<Run>(`run_${m.bad_run}`)).config as unknown as Record<string, unknown>
    const patch = Object.fromEntries(Object.entries(r.config).filter(([k, v]) => base[k] !== v)) as Partial<RagConfig>
    return { run_id: m.fix_run, patch }
  },
  diff: async (a, b) => (await isDemoRun(a) && await isDemoRun(b) ? file<Diff>(`diff_${a}_${b}`) : remote.diff(a, b)),
}

export const api = STATIC ? staticApi : liveApi

export const DEFAULT_CONFIG: RagConfig = { chunk_size: 512, chunk_overlap: 64, k: 5, retrieval: 'dense', rerank: false, prompt_style: 'basic' }
export const BAD_CONFIG: RagConfig = { chunk_size: 1024, chunk_overlap: 64, k: 3, retrieval: 'dense', rerank: false, prompt_style: 'basic' }

export const pretty = (s: string | null | undefined) => (s ?? '').replace(/_/g, ' ')
