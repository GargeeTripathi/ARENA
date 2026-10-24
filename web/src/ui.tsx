/* Small shared building blocks so every panel looks the same. */
import type { ReactNode } from 'react'
import type { Verdict } from './api'
import { pretty } from './api'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

// One colour per verdict family; text-*/bg-* resolve to the theme tokens in index.css.
export const VERDICT: Record<Verdict, { label: string; text: string; bg: string; dot: string; hex: string }> = {
  ok: { label: 'Healthy', text: 'text-ok', bg: 'bg-ok/10', dot: 'bg-ok', hex: 'var(--ok)' },
  retrieval: { label: 'Retrieval', text: 'text-retrieval', bg: 'bg-retrieval/12', dot: 'bg-retrieval', hex: 'var(--retrieval)' },
  generation: { label: 'Generation', text: 'text-generation', bg: 'bg-generation/10', dot: 'bg-generation', hex: 'var(--generation)' },
  abstention: { label: 'Abstention', text: 'text-abstention', bg: 'bg-abstention/10', dot: 'bg-abstention', hex: 'var(--abstention)' },
  uncertain: { label: 'Uncertain', text: 'text-uncertain', bg: 'bg-uncertain/12', dot: 'bg-uncertain', hex: 'var(--uncertain)' },
}

const CAUSE_FAMILY: Record<string, Verdict> = {
  ok: 'ok', recall_miss: 'retrieval', ranking_miss: 'retrieval', chunking_miss: 'retrieval', wrong_chunk_reliance: 'retrieval',
  hallucination: 'generation', misread_incomplete: 'generation', lucky_guess: 'generation', parametric_answer: 'generation',
  abstention_failure: 'abstention', uncertain: 'uncertain', retrieval: 'retrieval', generation: 'generation', abstention: 'abstention',
}
export const causeFamily = (c: string): Verdict => CAUSE_FAMILY[c] ?? 'uncertain'

export function Card({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <div className={cx('rounded-xl border border-line bg-surface', pad && 'p-4', className)}>{children}</div>
}

export function SectionTitle({ children, hint, right }: { children: ReactNode; hint?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <h3 className="text-[13px] font-semibold text-ink">{children}</h3>
      {hint && <span className="text-xs text-muted">{hint}</span>}
      {right && <div className="ml-auto">{right}</div>}
    </div>
  )
}

export function VerdictBadge({ verdict, sub, size = 'md' }: { verdict: Verdict; sub?: string | null; size?: 'sm' | 'md' }) {
  const v = VERDICT[verdict]
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full font-medium', v.bg, v.text,
      size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs')}>
      <span className={cx('h-1.5 w-1.5 rounded-full', v.dot)} />
      {verdict === 'ok' ? v.label : sub ? `${v.label} · ${pretty(sub)}` : v.label}
    </span>
  )
}

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center rounded-md bg-subtle px-1.5 py-0.5 text-[11px] font-medium text-muted', className)}>{children}</span>
}

export function Button({ children, onClick, disabled, variant = 'secondary', className, title }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: 'primary' | 'secondary' | 'ghost'; className?: string; title?: string
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-accent text-accent-ink shadow-sm hover:opacity-90',
        variant === 'secondary' && 'border border-line bg-surface text-ink-2 hover:bg-subtle',
        variant === 'ghost' && 'text-muted hover:bg-subtle hover:text-ink',
        className)}>
      {children}
    </button>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-lg bg-subtle p-0.5" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={cx('rounded-md px-2.5 py-1 text-xs font-medium transition',
            value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Thin horizontal meter; `color` is a CSS colour (use the verdict hex vars). */
export function Meter({ value, color = 'var(--accent)', className }: { value: number; color?: string; className?: string }) {
  return (
    <div className={cx('h-1.5 overflow-hidden rounded-full bg-subtle', className)}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </div>
  )
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 text-faint">{icon}</div>}
      <div className="text-sm font-medium text-ink-2">{title}</div>
      {children && <div className="mt-1 max-w-sm text-xs text-muted">{children}</div>}
    </div>
  )
}

export function scoreTone(v: number | null) {
  if (v === null) return { color: 'var(--faint)', label: 'No data', text: 'text-faint' }
  if (v >= 0.8) return { color: 'var(--ok)', label: 'Healthy', text: 'text-ok' }
  if (v >= 0.6) return { color: 'var(--retrieval)', label: 'Watch', text: 'text-retrieval' }
  return { color: 'var(--generation)', label: 'Critical', text: 'text-generation' }
}
