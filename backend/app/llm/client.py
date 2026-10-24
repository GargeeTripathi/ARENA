"""The ONLY place that talks to the LLM. Disk-cached, rate-limited, call-counted."""
import asyncio
import contextvars
import hashlib
import json
import logging
import re
from typing import Literal

import diskcache

from app import config

log = logging.getLogger("llm")

_cache = diskcache.Cache(str(config.CACHE_DIR))
_sem: asyncio.Semaphore | None = None
_clients: dict = {}

# Per-context call counter: wrap a lens in `counting()` to read its calls.
_calls: contextvars.ContextVar[list[int] | None] = contextvars.ContextVar("llm_calls", default=None)


class counting:
    """`with counting() as c: ...; c.n` -> real (non-cached) LLM calls made inside."""

    def __enter__(self):
        self._box = [0, 0]  # [real calls, cache hits]
        self._tok = _calls.set(self._box)
        return self

    def __exit__(self, *exc):
        _calls.reset(self._tok)

    @property
    def n(self) -> int:
        return self._box[0]

    @property
    def cached(self) -> int:
        return self._box[1]


def _get_client(role: str):
    if role not in _clients:
        from openai import AsyncOpenAI
        base, key = (config.GEN_BASE_URL, config.GEN_API_KEY) if role == "gen" else (config.JUDGE_BASE_URL, config.JUDGE_API_KEY)
        if not key:
            raise RuntimeError("LLM API key is not set (see .env.example)")
        _clients[role] = AsyncOpenAI(base_url=base, api_key=key, max_retries=2, timeout=120)
    return _clients[role]


def _model(role: str) -> str:
    m = config.GEN_MODEL if role == "gen" else config.JUDGE_MODEL
    if not m:
        raise RuntimeError(f"{'GEN' if role == 'gen' else 'JUDGE'}_MODEL is not set")
    return m


def extract_json(text: str) -> dict:
    """Tolerant JSON parse: first '{' to last '}'. Raises ValueError if hopeless."""
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        pass
    s, e = (text or "").find("{"), (text or "").rfind("}")
    if s == -1 or e <= s:
        raise ValueError(f"no JSON object in LLM output: {text[:200]!r}")
    return json.loads(text[s : e + 1])


async def _raw_call(role: str, model: str, messages: list[dict], json_mode: bool, temperature: float) -> str:
    """One chat call. The SDK retries 429/5xx/connection errors with exponential backoff and honours
    the provider's retry-after (free tiers reset token budgets per minute)."""
    global _sem
    if _sem is None:
        _sem = asyncio.Semaphore(config.LLM_MAX_CONCURRENCY)
    from openai import BadRequestError, RateLimitError

    kwargs: dict = {"model": model, "messages": messages, "temperature": temperature}
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    if "gpt-oss" in model:  # reasoning tokens count against rate limits; these prompts don't need them
        kwargs["extra_body"] = {"reasoning_effort": "low"}
    async with _sem:
        for attempt in range(12):
            try:
                r = await _get_client(role).chat.completions.create(**kwargs)
                return r.choices[0].message.content or ""
            except BadRequestError:
                if "response_format" not in kwargs:
                    raise
                kwargs.pop("response_format")  # provider lacks JSON mode: the prompt already asks for JSON
            except RateLimitError as e:  # free tiers: wait as long as the provider asks, then retry
                m = re.search(r"try again in (?:(\d+)m)?([\d.]+)(m?s)", str(e))
                wait = (int(m.group(1) or 0) * 60 + float(m.group(2)) / (1000 if m.group(3) == "ms" else 1)) if m else 2 ** min(attempt, 5)
                log.info("rate limited on %s, waiting %.1fs", model, wait + 0.5)
                await asyncio.sleep(wait + 0.5)
        raise RuntimeError(f"{model}: still rate limited after 12 tries")


async def complete(
    role: Literal["gen", "judge"],
    messages: list[dict],
    json_mode: bool = False,
    temperature: float = 0.0,
) -> str:
    model = _model(role)
    if json_mode:
        messages = [*messages[:-1], {**messages[-1], "content": messages[-1]["content"] + "\n\nReturn only JSON."}]
    key = hashlib.sha256(json.dumps([model, messages, temperature, json_mode], sort_keys=True).encode()).hexdigest()
    hit = _cache.get(key)
    if hit is not None:
        log.debug("cached %s", key[:8])
        box = _calls.get()
        if box is not None:
            box[1] += 1
        return hit

    out = await _raw_call(role, model, messages, json_mode, temperature)
    box = _calls.get()
    if box is not None:
        box[0] += 1
    if json_mode:
        try:
            extract_json(out)
        except ValueError:  # one repair retry
            repair = [*messages, {"role": "assistant", "content": out},
                      {"role": "user", "content": "That was not valid JSON. Return only the JSON object."}]
            out = await _raw_call(role, model, repair, json_mode, temperature)
            if box is not None:
                box[0] += 1
            extract_json(out)  # still bad -> raise, don't cache garbage
    _cache.set(key, out)
    return out


async def complete_json(role: Literal["gen", "judge"], messages: list[dict], temperature: float = 0.0) -> dict:
    return extract_json(await complete(role, messages, json_mode=True, temperature=temperature))


def memo(namespace: str, payload, fn):
    """Disk-cache any deterministic local computation (e.g. checker-model inference) by its inputs."""
    key = namespace + ":" + hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()
    hit = _cache.get(key)
    if hit is None:
        hit = fn()
        if hit is not None:
            _cache.set(key, hit)
    return hit
