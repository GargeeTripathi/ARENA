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

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init)
  if (!r.ok) {
    let msg = r.statusText
    try { msg = (await r.json()).detail ?? msg } catch { /* not json */ }
    throw new Error(msg)
  }
  return r.json()
}
const post = <T,>(path: string, body?: unknown) =>
  req<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })

const liveApi = {
  upload: (files: FileList) => {
    const fd = new FormData()
    Array.from(files).forEach((f) => fd.append('files', f))
    return req<CorpusInfo>('/api/corpus', { method: 'POST', body: fd })
  },
  demo: () => post<CorpusInfo>('/api/corpus/demo'),
  corpus: (cid: string) => req<CorpusInfo>(`/api/corpus/${cid}`),
  questions: (cid: string) => req<TestQuestion[]>(`/api/corpus/${cid}/questions`),
  generate: (cid: string, n_per_type = 2) => post<TestQuestion[]>(`/api/corpus/${cid}/questions`, { n_per_type }),
  startRun: (corpus_id: string, config: RagConfig) => post<{ run_id: string }>('/api/runs', { corpus_id, config }),
  runs: (cid: string) => req<RunSummary[]>(`/api/runs?corpus_id=${cid}`),
  run: (id: string) => req<Run>(`/api/runs/${id}`),
  autopsy: (id: string, qid: string) => req<Autopsy>(`/api/runs/${id}/questions/${qid}`),
  fix: (id: string) => post<{ run_id: string; patch: Partial<RagConfig> }>(`/api/runs/${id}/fix`, {}),
  diff: (a: string, b: string) => req<Diff>(`/api/runs/${a}/diff/${b}`),
}

/** Hosted read-only demo (e.g. Vercel): the same calls, answered from JSON files exported by
 *  backend/scripts/export_static.py. Built with VITE_STATIC=1. */
export const STATIC = import.meta.env.VITE_STATIC === '1'
const offline = (what: string) => Promise.reject(new Error(`${what} needs the Python backend. This online demo is read-only; run the project locally to try your own documents.`))
const file = <T,>(name: string) => req<T>(`/demo/${name}.json`)
const manifest = () => file<{ bad_run: string; fix_run: string; corpus_id: string }>('manifest')

const staticApi: typeof liveApi = {
  upload: () => offline('Uploading documents'),
  demo: () => file<CorpusInfo>('corpus'),
  corpus: () => file<CorpusInfo>('corpus'),
  questions: () => file<TestQuestion[]>('questions'),
  generate: () => offline('Generating questions'),
  startRun: async (_cid, config) => {
    if (config.chunk_size !== BAD_CONFIG.chunk_size || config.k !== BAD_CONFIG.k) return offline('Evaluating this config')
    return { run_id: (await manifest()).bad_run }
  },
  runs: () => file<RunSummary[]>('runs'),
  run: (id) => file<Run>(`run_${id}`),
  autopsy: (id, qid) => file<Autopsy>(`autopsy_${id}_${qid}`),
  fix: async (id) => {
    const m = await manifest()
    if (id !== m.bad_run) return offline('Re-testing this run')
    const r = await file<Run>(`run_${m.fix_run}`)
    const base = (await file<Run>(`run_${m.bad_run}`)).config as unknown as Record<string, unknown>
    const patch = Object.fromEntries(Object.entries(r.config).filter(([k, v]) => base[k] !== v)) as Partial<RagConfig>
    return { run_id: m.fix_run, patch }
  },
  diff: (a, b) => file<Diff>(`diff_${a}_${b}`),
}

export const api = STATIC ? staticApi : liveApi

export const DEFAULT_CONFIG: RagConfig = { chunk_size: 512, chunk_overlap: 64, k: 5, retrieval: 'dense', rerank: false, prompt_style: 'basic' }
export const BAD_CONFIG: RagConfig = { chunk_size: 1024, chunk_overlap: 64, k: 3, retrieval: 'dense', rerank: false, prompt_style: 'basic' }

export const pretty = (s: string | null | undefined) => (s ?? '').replace(/_/g, ' ')
