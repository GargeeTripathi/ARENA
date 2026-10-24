import asyncio

import pytest

from app.llm import client


def test_extract_json_tolerant():
    assert client.extract_json('{"a": 1}') == {"a": 1}
    assert client.extract_json('Sure! ```json\n{"a": {"b": 2}}\n``` hope that helps') == {"a": {"b": 2}}
    with pytest.raises(ValueError):
        client.extract_json("no json here")


def test_cache_counter_and_json_repair(monkeypatch, tmp_path):
    import diskcache

    monkeypatch.setattr(client, "_cache", diskcache.Cache(str(tmp_path)))
    monkeypatch.setattr(client, "_model", lambda role: "fake-" + role)
    replies = iter(["oops not json", '{"ok": true}'])
    sent = []

    async def fake_raw(role, model, messages, json_mode, temperature):
        sent.append(messages)
        return next(replies)

    monkeypatch.setattr(client, "_raw_call", fake_raw)
    msgs = [{"role": "user", "content": "hi"}]

    async def go():
        with client.counting() as c:
            first = await client.complete_json("judge", msgs)
            second = await client.complete_json("judge", msgs)  # served from cache
        return first, second, c.n

    first, second, n = asyncio.run(go())
    assert first == second == {"ok": True}
    assert n == 2  # original + one repair; cache hit is free
    assert len(sent) == 2
