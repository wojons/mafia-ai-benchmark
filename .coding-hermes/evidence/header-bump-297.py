#!/usr/bin/env python3
"""Tick closeout: bump board.jsonl header (ticks_total 296->297, last_tick,
updated_at, last_commit) per the repo's closeout convention."""

import json
import pathlib

p = pathlib.Path(
    "/home/kara/wojons/mafia-ai-benchmark/.coding-hermes/board/board.jsonl"
)
doc = json.loads(p.read_text())
header = doc if isinstance(doc, dict) else doc[0]
header["ticks_total"] = 297
header["last_tick"] = "2026-11-21T01:05:08.000000"
header["updated_at"] = "2026-11-21 02:05:00.000000"
header["last_commit"] = "9be98fe"
p.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
print("header:", {k: header[k] for k in ("ticks_total", "last_tick", "last_commit")})
