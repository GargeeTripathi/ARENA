"""The ONLY place that talks to the LLM. Disk-cached, rate-limited, call-counted."""
import asyncio
import contextvars
import hashlib
import json
import logging
from typing import Literal

import diskcache

from app import config

log = logging.getLogger("llm")

_cache = diskcache.Cache(str(config.CACHE_DIR))
_sem: asyncio.Semaphore | None = None
_client = None

# Per-context call counter: wrap a lens in `counting()` to read its calls.
_calls: contextvars.ContextVar[list[int] | None] = contextvars.ContextVar("llm_calls", default=None)


class counting:
    """`with counting() as c: ...; c.n` -> real (non-cached) LLM calls made inside."""

    def __enter__(self):
        self._box = [0]
        self._tok = _calls.set(self._box)
        return self

    def __exit__(self, *exc):
        _calls.reset(self._tok)

    @property
    def n(self) -> int:
        return self._box[0]


def _get_client():
    global _client
    if _client is None:
        from openai import AsyncOpenAI
        if not config.LLM_API_KEY:
            raise RuntimeError("LLM_API_KEY is not set (see .env.example)")
        _client = AsyncOpenAI(base_url=config.LLM_BASE_URL, api_key=config.LLM_API_KEY)
    return _client


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


async def _raw_call(model: str, messages: list[dict], json_mode: bool, temperature: float) -> str:
    global _sem
    if _sem is None:
        _sem = asyncio.Semaphore(config.LLM_MAX_CONCURRENCY)
    from openai import APIStatusError, APIConnectionError, BadRequestError

    kwargs = {"model": model, "messages": messages, "temperature": temperature}
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    async with _sem:
        for attempt in range(4):
            try:
                r = await _get_client().chat.completions.create(**kwargs)
                return r.choices[0].message.content or ""
            except BadRequestError:
                if "response_format" in kwargs:  # provider lacks JSON mode: rely on the prompt
                    kwargs.pop("response_format")
                    continue
                raise
            except (APIStatusError, APIConnectionError) as e:
                status = getattr(e, "status_code", None)
                if attempt == 3 or (status is not None and status != 429 and status < 500):
                    raise
                await asyncio.sleep(2 ** attempt)
    raise RuntimeError("unreachable")


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
        return hit

    out = await _raw_call(model, messages, json_mode, temperature)
    box = _calls.get()
    if box is not None:
        box[0] += 1
    if json_mode:
        try:
            extract_json(out)
        except ValueError:  # one repair retry
            repair = [*messages, {"role": "assistant", "content": out},
                      {"role": "user", "content": "That was not valid JSON. Return only the JSON object."}]
            out = await _raw_call(model, repair, json_mode, temperature)
            if box is not None:
                box[0] += 1
            extract_json(out)  # still bad -> raise, don't cache garbage
    _cache.set(key, out)
    return out


async def complete_json(role: Literal["gen", "judge"], messages: list[dict], temperature: float = 0.0) -> dict:
    return extract_json(await complete(role, messages, json_mode=True, temperature=temperature))
