import { AlertTriangle, Check, CheckCircle2, Database, FileText, FileUp, Loader2, Play, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CorpusInfo, TestQuestion } from '../api'
import { pretty } from '../api'
import { STATIC, hostedBackend } from '../api'
import { Button, Card, cx } from '../ui'

export const PRESETS = {
  bad: { label: 'Seeded bad config', desc: '1024-word chunks, k = 3, dense only, basic prompt. Built to fail.' },
  default: { label: 'Default config', desc: '512-word chunks, k = 5, dense, basic prompt.' },
} as const
export type Preset = keyof typeof PRESETS

function Step({ n, title, done, active, children }: { n: number; title: string; done: boolean; active: boolean; children: ReactNode }) {
  return (
    <Card hover className={cx('flex flex-col', active && 'border-accent/50 shadow-glow', !done && !active && 'opacity-60')}>
      <div className="flex items-center gap-2.5">
        <span className={cx('flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
          done ? 'bg-ok text-white' : active ? 'bg-brand text-white' : 'bg-subtle text-muted')}>
          {done ? <Check className="h-3.5 w-3.5" /> : n}
        </span>
        <span className="font-display text-[15px] font-semibold text-ink">{title}</span>
      </div>
      <div className="mt-3 flex flex-1 flex-col">{children}</div>
    </Card>
  )
}

export default function Setup({ corpus, questions, busy, error, preset, setPreset, onUpload, onDemo, onGenerate, onRun }: {
  corpus: CorpusInfo | null; questions: TestQuestion[]; busy: string | null; error: string | null; preset: Preset; setPreset: (p: Preset) => void
  onUpload: (f: File[]) => void; onDemo: () => void; onGenerate: () => void; onRun: () => void
}) {
  const file = useRef<HTMLInputElement>(null)
  const errRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (error) errRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [error])
  // elapsed-time counter while a slow step (question generation) runs
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (busy !== 'generate') return
    setSecs(0)
    const t = setInterval(() => setSecs((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [busy])
  const elapsed = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
  // Hosted site: is the live backend (uploads, new runs) reachable right now?
  const [online, setOnline] = useState<boolean | null>(STATIC ? null : true)
  useEffect(() => { if (STATIC) hostedBackend().then((b) => setOnline(!!b)) }, [])
  const byType = questions.reduce<Record<string, number>>((m, q) => ({ ...m, [q.qtype]: (m[q.qtype] ?? 0) + 1 }), {})
  const step = !corpus ? 1 : !questions.length ? 2 : 3

  return (
    <div className="space-y-4">
    {error && (
      <div ref={errRef} role="alert" className="flex items-start gap-2.5 rounded-xl border border-generation/40 bg-generation/10 px-4 py-3 text-[13px] text-ink-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-generation" />
        <span><b className="text-ink">That didn't work.</b> {error}</span>
      </div>
    )}
    <div className="grid gap-4 lg:grid-cols-3">
      <Step n={1} title="Add documents" done={!!corpus} active={step === 1}>
        <p className="text-xs text-muted">PDF, Word, Markdown or text. We parse, chunk and index them.</p>
        {STATIC && (
          <p className={cx('mt-2 flex items-start gap-2 rounded-md px-2.5 py-2 text-[11px] leading-relaxed text-ink-2',
            online ? 'bg-ok/10' : online === false ? 'bg-retrieval/10' : 'bg-subtle')}>
            <span className={cx('mt-1 h-2 w-2 shrink-0 rounded-full', online ? 'bg-ok' : online === false ? 'bg-retrieval' : 'animate-pulse bg-faint')} />
            <span>
              {online === null && 'Checking the live backend…'}
              {online && <><b className="text-ink">Live backend online.</b> Upload up to 3 files (2 MB total): PDF, Word, Markdown or text.</>}
              {online === false && <><b className="text-ink">Live backend offline right now.</b> Uploads work while the team's server is running. Meanwhile, explore the demo corpus.</>}
            </span>
          </p>
        )}
        {busy === 'upload' && (
          <p className="mt-2 flex items-center gap-2 text-xs text-ink-2"><Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />Uploading and indexing… (the first upload after a restart takes ~20 s)</p>
        )}
        {corpus && busy !== 'upload' && (
          <div className="mt-2 rounded-md border border-ok/30 bg-ok/8 px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
              <CheckCircle2 className="h-3.5 w-3.5 text-ok" />
              {corpus.files?.length && corpus.files.length <= 3 ? 'Ready' : `Ready: ${corpus.n_docs} documents`}
              <span className="ml-auto font-normal text-muted">{corpus.n_chunks} chunks indexed</span>
            </div>
            {corpus.files && corpus.files.length <= 3 && (
              <ul className="mt-1 space-y-0.5">
                {corpus.files.map((f) => <li key={f} className="flex items-center gap-1.5 truncate text-[11px] text-ink-2"><FileText className="h-3 w-3 shrink-0 text-faint" />{f}</li>)}
              </ul>
            )}
          </div>
        )}
        <input ref={file} type="file" multiple accept=".pdf,.docx,.txt,.md" className="hidden"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? [])
            e.target.value = ''  // so choosing the same file again still triggers an upload
            if (picked.length) onUpload(picked)
          }} />
        <div className="mt-auto flex gap-2 pt-4">
          <Button onClick={() => file.current?.click()} disabled={!!busy || online === false}
            title={online === false ? 'The live backend is offline right now' : undefined}>
            {busy === 'upload' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}Upload
          </Button>
          <Button onClick={onDemo} disabled={!!busy} variant={corpus ? 'secondary' : 'primary'}>
            {busy === 'demo' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}Use demo corpus
          </Button>
        </div>
      </Step>

      <Step n={2} title="Generate test questions" done={questions.length > 0} active={step === 2}>
        <p className="text-xs text-muted">Each question is tied to the exact sentence that answers it, so we always know the right chunk.</p>
        {questions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(byType).map(([t, n]) => <span key={t} className="rounded-md bg-subtle px-2 py-0.5 text-[11px] text-ink-2"><b>{n}</b> {pretty(t)}</span>)}
          </div>
        )}
        {busy === 'generate' && <p className="mt-2 text-[11px] text-muted">An LLM reads each chunk and writes questions, then a second model checks every one. Usually 1–3 minutes.</p>}
        <div className="mt-auto pt-4">
          <Button onClick={onGenerate} disabled={!corpus || !!busy || online === false} variant={step === 2 ? 'primary' : 'secondary'}>
            {busy === 'generate' ? <><Loader2 className="h-4 w-4 animate-spin" />Writing questions… {elapsed}</> : <><Sparkles className="h-4 w-4" />{questions.length ? 'Regenerate' : 'Generate questions'}</>}
          </Button>
        </div>
      </Step>

      <Step n={3} title="Evaluate a RAG config" done={false} active={step === 3}>
        <div className="space-y-2">
          {(Object.keys(PRESETS) as Preset[]).map((k) => (
            <label key={k} className={cx('flex cursor-pointer gap-2.5 rounded-lg border p-2.5 transition',
              preset === k ? 'border-accent/60 bg-accent/5' : 'border-line hover:bg-subtle')}>
              <input type="radio" name="preset" checked={preset === k} onChange={() => setPreset(k)} className="mt-0.5 accent-[var(--accent)]" />
              <span><span className="block text-[13px] font-medium text-ink">{PRESETS[k].label}</span>
                <span className="block text-[11px] text-muted">{PRESETS[k].desc}</span></span>
            </label>
          ))}
        </div>
        <div className="mt-auto pt-4">
          <Button variant="primary" onClick={onRun} disabled={!questions.length || !!busy}>
            {busy === 'run' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Run evaluation
          </Button>
        </div>
      </Step>
    </div>
    </div>
  )
}

const STATS = [
  { value: '6', label: 'diagnostic lenses' },
  { value: '3', label: 'cascade tiers, LLM only when needed' },
  { value: 'Top-50', label: 'ranked chunks traced per question' },
  { value: '1-click', label: 'prescribed fix & re-test' },
]

/** Landing hero shown before any run exists. */
export function Hero({ onDemo, busy }: { onDemo: () => void; busy: string | null }) {
  return (
    <div className="mb-8">
      <div className="relative overflow-hidden rounded-2xl border border-line bg-surface px-8 py-12 md:px-12">
        <div className="pointer-events-none absolute -left-24 -top-32 h-96 w-96" style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--accent) 28%, transparent), transparent 65%)" }} />
        <div className="pointer-events-none absolute -bottom-40 -right-10 h-96 w-[32rem]" style={{ background: "radial-gradient(ellipse, color-mix(in srgb, var(--accent-2) 16%, transparent), transparent 65%)" }} />
        <div className="relative max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-2" />RAG evaluation with root causes
          </div>
          <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] text-ink md:text-5xl">
            Find out <span className="text-brand">why</span> your RAG<br />gets answers wrong.
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted">
            We generate test questions from your own documents, run them through your RAG, and diagnose every failure:
            retrieval, hallucination or a missing "I don't know". Retrieval failures are <b className="text-ink-2">proven</b>, not
            guessed: we swap the right chunk back in and re-ask the same model.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button variant="primary" onClick={onDemo} disabled={!!busy} className="px-5 py-2.5 text-sm">
              {busy === 'demo' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}{STATIC ? 'Explore the live demo' : 'Try the demo corpus'}
            </Button>
            <a href="#setup"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-5 py-2.5 text-sm font-medium text-ink-2 transition hover:border-accent/60 hover:text-ink">
              Use my own documents
            </a>
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STATS.map((s) => (
          <Card key={s.label} hover className="tile-corner py-5 text-center">
            <div className="font-display text-3xl font-bold text-brand">{s.value}</div>
            <div className="mt-1 text-xs text-muted">{s.label}</div>
          </Card>
        ))}
      </div>
      <h2 id="setup" className="mt-10 text-xl font-bold text-ink">Get started in <span className="text-brand">three steps</span></h2>
    </div>
  )
}
