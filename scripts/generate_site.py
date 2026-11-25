#!/usr/bin/env python3
"""Static-site generator for the Mafia AI Benchmark (MAF-LAYER-4).

Reads the MAF-LAYER-1 run-record corpus (data/runs/*.jsonl + index.jsonl) and
the MAF-LAYER-2 per-run metrics (data/metrics/<game_id>/metrics.jsonl), and
emits a fully static `site/` directory:

    site/index.html          run index (most recent N runs, link to replays)
    site/runs/<game_id>.html one replay page per run (stage-by-stage playback)
    site/leaderboard.html    per-model leaderboard from layer-2 aggregates
    site/style.css, site/site.js, site/_data/aggregate.jsonl

No runtime API dependency anywhere — publishing is a sync of this tree
(GitHub Pages), never a live API. Numbers are real derived numbers, even when
bad ("publish real numbers even when bad").

Regeneration is ONE deterministic command from the corpus:

    python3 scripts/generate_site.py [--runs N] [--corpus-dir DIR]
                                     [--metrics-dir DIR] [--out DIR]

If layer-2 metrics are missing for a selected run, the script derives them by
invoking the mafiactl CLI (`node apps/cli/dist/index.js metrics derive …`),
the same tool that produced every other metrics file — it never invents
metrics itself. Build the CLI first if needed:

    pnpm --filter @mafia/shared build && pnpm --filter @mafia/cli build

Python stdlib only.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from html import escape

LOW_SAMPLE_N = 5  # matches the layer-2 aggregator: n < 5 carries the low-sample marker

# ---------------------------------------------------------------- helpers ---


def fail(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def read_jsonl(path: str) -> list[dict]:
    out = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def locate_corpus(cli_value: str | None) -> str:
    """Find the data/runs corpus directory."""
    candidates = []
    if cli_value:
        candidates.append(cli_value)
    env = os.environ.get("MAFIA_RUNS_DIR")
    if env:
        candidates.append(env)
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    candidates.append(os.path.join(repo_root, "data", "runs"))
    # A checkout sitting next to this worktree/clone (the corpus is gitignored
    # data, so it only exists in the primary checkout).
    candidates.append(
        os.path.join(os.path.dirname(repo_root), "mafia-ai-benchmark", "data", "runs")
    )
    for cand in candidates:
        if cand and os.path.isfile(os.path.join(cand, "index.jsonl")):
            return cand
    fail(
        "run corpus not found (looked for index.jsonl in: "
        + ", ".join(c for c in candidates if c)
        + "). Pass --corpus-dir /path/to/data/runs."
    )


def find_cli(cli_value: str | None, repo_root: str) -> tuple[str | None, str]:
    """Resolve the mafiactl CLI dist entry and a node binary."""
    node = shutil.which("node")
    cli = cli_value or os.path.join(repo_root, "apps", "cli", "dist", "index.js")
    if node and os.path.isfile(cli):
        return node, cli
    return None, cli


def compact(value, depth: int = 0):
    """Recursively drop heavy persona payloads; keep everything meaningful."""
    if depth > 8:
        return value
    if isinstance(value, dict):
        out = {}
        for key, val in value.items():
            if key in (
                "persona",
                "statement",
            ):  # persona = prose payload; statement dupes `says`
                continue
            out[key] = compact(val, depth + 1)
        return out
    if isinstance(value, list):
        return [compact(v, depth + 1) for v in value]
    return value


# ------------------------------------------------------------- replay data ---


class RunReplay:
    """Builds the JSON payload one replay page plays back."""

    def __init__(self, header: dict, events: list[dict]):
        self.header = header
        self.events = events

    def seat_names(self) -> dict[str, str]:
        """player_id -> display name (ROLES_ASSIGNED first, header seats fallback)."""
        names: dict[str, str] = {}
        for ev in self.events:
            if ev.get("type") == "ROLES_ASSIGNED":
                for a in ev.get("data", {}).get("assignments") or []:
                    pid, name = a.get("playerId"), a.get("name")
                    if pid and name:
                        names[pid] = name
        if not names:
            for ev in self.events:  # fall back to names seen on any event data
                data = ev.get("data") or {}
                pid = ev.get("actor_id")
                name = data.get("playerName")
                if pid and name and pid not in names:
                    names[pid] = name
        for seat in self.header.get("seats") or []:
            pid = seat.get("player_id")
            if pid and pid not in names:
                names[pid] = (
                    f"Seat {seat.get('seat', '?')} ({seat.get('role', 'unknown')})"
                )
        return names

    def stages(self) -> list[dict]:
        """Group events into replay stages at phase boundaries."""
        stage_of: list[int] = []
        stages: list[dict] = []
        phase_class = "SETUP"
        day = 0

        def label_for(cls: str, day_num: int) -> str:
            if cls == "DAY_DISCUSSION":
                return f"Day {day_num} — Discussion & voting"
            if cls == "NIGHT_ACTIONS":
                return f"Night {day_num} — Actions"
            if cls == "MORNING_REVEAL":
                return f"Day {day_num} — Morning reveal"
            if cls == "GAME_OVER":
                return "Game over"
            return f"Day {day_num} — Setup"

        for ev in self.events:
            etype = ev.get("type", "")
            meta = ev.get("metadata") or {}
            if meta.get("dayNumber") is not None:
                day = meta.get("dayNumber")

            new_phase = None
            if etype == "PHASE_CHANGED":
                p = (ev.get("data") or {}).get("phase")
                if not p:
                    # PHASE_CHANGED without an explicit phase: the corpus
                    # carries the real phase in metadata (e.g. NIGHT_ACTIONS).
                    meta_phase = meta.get("phase")
                    p = meta_phase if meta_phase and meta_phase != "SETUP" else "SETUP"
                new_phase = p
            elif etype == "MORNING_REVEAL":
                new_phase = "MORNING_REVEAL"
            elif etype == "GAME_ENDED":
                new_phase = "GAME_OVER"

            if new_phase is not None and new_phase != phase_class:
                phase_class = new_phase

            key = (phase_class, None if phase_class == "GAME_OVER" else day)
            if not stages or stages[-1]["key"] != key:
                stages.append(
                    {
                        "key": key,
                        "label": label_for(phase_class, day),
                        "events": [],
                    }
                )
            stage_of.append(len(stages) - 1)
            stages[-1]["events"].append(ev)

        return [
            {"label": s["label"], "events": [compact(e) for e in s["events"]]}
            for s in stages
        ]

    def payload(self) -> dict:
        header = compact(self.header)
        return {
            "header": header,
            "names": self.seat_names(),
            "stages": self.stages(),
        }


# --------------------------------------------------------------- rendering ---


def metric_cell(value: float | None, n: int, low_sample: bool) -> tuple[str, float]:
    """Rendered HTML cell + sortable numeric key. Null stays null (never 0)."""
    if value is None:
        return (
            '<td class="num na" data-v="-1">n/a <span class="n">n=0</span></td>',
            -1.0,
        )
    star = (
        '<span class="low" title="low sample (n < %d)">*</span>' % LOW_SAMPLE_N
        if low_sample
        else ""
    )
    if math.isclose(value, round(value, 4)):
        shown = f"{value * 100:.1f}%" if 0 <= value <= 1 else f"{value:g}"
    else:
        shown = f"{value * 100:.1f}%" if 0 <= value <= 1 else f"{value:.3g}"
    html = (
        f'<td class="num" data-v="{value:.6f}">{shown}{star} '
        f'<span class="n">n={n}</span></td>'
    )
    return html, value


def leaderboard_rows(aggregate: list[dict]) -> tuple[str, list[str]]:
    """HTML <tr> rows + the union of roles seen in survival_by_role."""
    roles: set[str] = set()
    for row in aggregate:
        roles.update((row.get("survival_by_role") or {}).keys())
    role_order = ["MAFIA"] + sorted(r for r in roles if r != "MAFIA")
    trs = []
    for row in sorted(aggregate, key=lambda r: r.get("model", "")):
        model = row.get("model", "?")
        games = row.get("games_played", 0)
        cells = [
            f'<th class="model" data-v="{escape(model, quote=True)}">{escape(model)}</th>',
            f'<td class="num" data-v="{games}">{games} <span class="n">games</span></td>',
        ]
        for metric in (
            "win_rate",
            "survival",
            "vote_accuracy",
            "persuasion",
            "lie_rate",
        ):
            mv = row.get(metric) or {"value": None, "n": 0, "low_sample": False}
            html, _ = metric_cell(
                mv.get("value"), mv.get("n", 0), mv.get("low_sample", False)
            )
            cells.append(html)
        for role in role_order:
            mv = (row.get("survival_by_role") or {}).get(role)
            if mv is None:
                cells.append('<td class="num na" data-v="-1">—</td>')
            else:
                html, _ = metric_cell(
                    mv.get("value"), mv.get("n", 0), mv.get("low_sample", False)
                )
                cells.append(html)
        trs.append("<tr>" + "".join(cells) + "</tr>")
    return "\n".join(trs), role_order


LEADERBOARD_COLUMNS = [
    ("Model", None),
    ("Games", None),
    ("Win rate", None),
    ("Survival", None),
    ("Vote accuracy", None),
    ("Persuasion", None),
    ("Lie rate", None),
]


def render_leaderboard(rows_html: str, role_order: list[str], run_count: int) -> str:
    headers = [
        '<th class="sortable">Model</th>',
        '<th class="sortable">Games</th>',
        '<th class="sortable">Win rate</th>',
        '<th class="sortable">Survival</th>',
        '<th class="sortable">Vote accuracy</th>',
        '<th class="sortable">Persuasion</th>',
        '<th class="sortable">Lie rate</th>',
    ]
    headers += [
        f'<th class="sortable">Surv. {escape(r.title())}</th>' for r in role_order
    ]
    note = (
        f"Aggregated from layer-2 derived metrics over the {run_count} most recent runs "
        f"(site cap). <span class='low'>*</span> = low sample (n&nbsp;&lt;&nbsp;{LOW_SAMPLE_N}); "
        "n shows the sample behind each rate; n/a means no sample (never 0). "
        "Raw aggregate: <a href='_data/aggregate.jsonl'>_data/aggregate.jsonl</a>. Click any "
        "column header to sort."
    )
    return page(
        title="Leaderboard — Mafia AI Benchmark",
        body=f"""
<h1>Model Leaderboard</h1>
<p class="note">{note}</p>
<table id="board" class="board">
<thead><tr>{"".join(headers)}</tr></thead>
<tbody>
{rows_html}
</tbody>
</table>
""",
        extra_css="board",
    )


def fmt_pct(v, nd=1):
    return f"{v * 100:.{nd}f}%"


def render_index(
    runs: list[dict], total_in_corpus: int, cap: int, corpus_dir: str
) -> str:
    rows = []
    for r in runs:
        header = r["header"]
        models = sorted({s.get("model") or "?" for s in header.get("seats") or []})
        dur = ""
        started, ended = header.get("started_at"), header.get("ended_at")
        if started and ended:
            try:
                from datetime import datetime

                s = datetime.fromisoformat(started.replace("Z", "+00:00"))
                e = datetime.fromisoformat(ended.replace("Z", "+00:00"))
                dur = f"{(e - s).total_seconds() / 60:.1f}m"
            except ValueError:
                pass
        rows.append(
            "<tr>"
            f"<td>{escape((header.get('started_at') or '')[:16].replace('T', ' '))}</td>"
            f'<td><a href="runs/{r["game_id"]}.html">{escape(r["game_id"][:8])}</a></td>'
            f'<td class="win-{escape((header.get("winner") or "").lower())}">{escape(str(header.get("winner")))}</td>'
            f'<td class="num">{header.get("num_players", "?")}</td>'
            f"<td>{escape(', '.join(models))}</td>"
            f"<td>{dur}</td>"
            "</tr>"
        )
    cap_note = (
        f"Showing the most recent {len(runs)} of {total_in_corpus} runs in the corpus "
        f"(site cap = {cap} runs; regenerate with <code>python3 scripts/generate_site.py "
        f"--runs {cap}</code>)."
    )
    return page(
        title="Runs — Mafia AI Benchmark",
        body=f"""
<h1>Run Index</h1>
<p class="note">{cap_note}</p>
<p class="note">Open a run to read the full replay stage by stage — day/night phases,
votes and eliminations, with private THINK content behind a toggle.
Per-model leaderboard: <a href="leaderboard.html">leaderboard.html</a>.</p>
<table class="board">
<thead><tr>
<th>Date</th><th>Game</th><th>Winner</th><th>Players</th><th>Models</th><th>Length</th>
</tr></thead>
<tbody>
{os.linesep.join(rows)}
</tbody>
</table>
""",
        extra_css="board",
    )


def render_run_page(gid: str, payload: dict, aggregate_note: str) -> str:
    header = payload["header"]
    winner = header.get("winner", "?")
    seats = header.get("seats") or []
    seat_rows = []
    for s in seats:
        seat_rows.append(
            "<tr>"
            f"<td>{s.get('seat', '')}</td>"
            f"<td>{escape(payload['names'].get(s.get('player_id'), s.get('player_id', '')))}</td>"
            f"<td>{escape(str(s.get('provider') or ''))}</td>"
            f"<td>{escape(str(s.get('model') or '?'))}</td>"
            f"<td>{escape(str(s.get('role')))}</td>"
            f"<td>{'yes' if s.get('survived') else 'no'}</td>"
            f"<td>{'yes' if s.get('won') == 1 else ('no' if s.get('won') == 0 else '?')}</td>"
            "</tr>"
        )
    data_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace(
        "</", "<\\/"
    )
    return page(
        title=f"Run {gid[:8]} — Mafia AI Benchmark",
        body=f"""
<p><a href="../index.html">← run index</a> · <a href="../leaderboard.html">leaderboard</a></p>
<h1>Run {escape(gid[:8])}</h1>
<p class="note">Winner: <b>{escape(str(winner))}</b> · started {escape(str(header.get("started_at")))}.<br>
{aggregate_note}</p>
<table class="board seats">
<thead><tr><th>Seat</th><th>Player</th><th>Provider</th><th>Model</th><th>Role</th><th>Survived</th><th>Won</th></tr></thead>
<tbody>
{os.linesep.join(seat_rows)}
</tbody>
</table>
<div id="replay">
  <p class="replay-controls">
    <button id="prev" type="button">◀ Prev stage</button>
    <span id="stage-label"></span>
    <button id="next" type="button">Next stage ▶</button>
    <label class="think-toggle"><input type="checkbox" id="show-think"> show private THINK</label>
  </p>
  <ol id="timeline" class="timeline"></ol>
  <div id="stage"></div>
</div>
<h2>Full event log</h2>
<p class="note">Every projected event in game order. THINK content follows the same toggle.</p>
<div id="all-events" class="event-log"></div>
<script id="run-data" type="application/json">{data_json}</script>
""",
        extra_css="replay",
    )


def page(title: str, body: str, extra_css: str = "") -> str:
    links = []
    for name, label in (
        ("index.html", "Run index"),
        ("leaderboard.html", "Leaderboard"),
    ):
        links.append(f'<a href="{name}">{label}</a>')
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(title)}</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<nav>{" · ".join(links)}</nav>
{body}
<script src="site.js"></script>
</body>
</html>
"""


STYLE_CSS = """
:root { color-scheme: dark; }
body { font-family: system-ui, sans-serif; margin: 0 0 4rem; background: #111827; color: #e5e7eb; }
nav { padding: .75rem 1rem; background: #0b1220; border-bottom: 1px solid #1f2937; }
nav a, a { color: #7dd3fc; }
h1 { margin: 1rem 1rem .25rem; }
h2 { margin: 1.5rem 1rem .25rem; }
.note { margin: .25rem 1rem 1rem; color: #9ca3af; font-size: .9rem; }
.note code { color: #cbd5e1; }
table.board { border-collapse: collapse; margin: 0 1rem 2rem; width: calc(100% - 2rem); font-size: .85rem; }
table.board th, table.board td { border: 1px solid #1f2937; padding: .3rem .5rem; text-align: left; }
table.board thead th { background: #0b1220; position: sticky; top: 0; }
table.board tbody tr:hover { background: #16223a; }
td.num, th.num { text-align: right; white-space: nowrap; }
td.na { color: #6b7280; }
td .n, .n { color: #6b7280; font-size: .75rem; display: inline-block; margin-left: .25rem; }
span.low { color: #fbbf24; font-weight: 700; margin-left: .15rem; }
th.sortable { cursor: pointer; user-select: none; }
th.sortable::after { content: "⇅"; opacity: .4; margin-left: .25rem; }
th.sort-asc::after { content: "↑"; opacity: 1; }
th.sort-desc::after { content: "↓"; opacity: 1; }
td.win-town { color: #86efac; }
td.win-mafia { color: #fca5a5; }
.win-TOWN { color: #86efac; }
.win-MAFIA { color: #fca5a5; }
/* replay */
.replay-controls { margin: 0 1rem 1rem; display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
.replay-controls button { background: #1d4ed8; color: white; border: 0; padding: .4rem .8rem; border-radius: .3rem; cursor: pointer; }
.replay-controls button:disabled { background: #374151; cursor: default; }
#stage-label { font-weight: 600; }
ol.timeline { margin: 0 1rem 1rem; padding-left: 1.4rem; font-size: .85rem; color: #9ca3af; }
ol.timeline li { cursor: pointer; }
ol.timeline li.current { color: #7dd3fc; font-weight: 600; }
#stage { margin: 0 1rem 2rem; border: 1px solid #1f2937; border-radius: .4rem; padding: .5rem 1rem; background: #0b1220; }
.event { padding: .35rem 0; border-bottom: 1px solid #111827; }
.event .meta { color: #6b7280; font-size: .75rem; margin-right: .5rem; }
.event .badge { display: inline-block; font-size: .7rem; padding: 0 .35rem; border-radius: .2rem; background: #1f2937; color: #cbd5e1; margin-right: .4rem; }
.event .badge.private { background: #3b1d1d; color: #fca5a5; }
.event .badge.admin { background: #33270f; color: #fbbf24; }
.event .think { display: none; margin: .25rem 0 0 1.5rem; padding: .4rem .6rem; background: #241726; border-left: 3px solid #a855f7; color: #d8b4fe; white-space: pre-wrap; }
body.show-think .event .think { display: block; }
.event .says { margin: .15rem 0 0 1.5rem; color: #e5e7eb; }
.event .says .q { color: #9ca3af; }
.event .death { color: #fca5a5; font-weight: 600; }
.event-log { margin: 0 1rem 3rem; }
.timeline-hide { display: none; }
"""

SITE_JS = """/* Static-site behaviours: leaderboard sorting + run replay. No network calls. */
(function () {
  'use strict';

  // ------------------------------------------------ leaderboard sorting ---
  var board = document.getElementById('board');
  if (board && document.querySelector('#board th.sortable')) {
    var headers = board.querySelectorAll('th.sortable');
    var rows = function () { return Array.prototype.slice.call(board.querySelectorAll('tbody tr')); };
    var sortState = { idx: null, dir: 1 };
    headers.forEach(function (th, i) {
      th.addEventListener('click', function () {
        var dir = (sortState.idx === i) ? -sortState.dir : 1;
        sortState = { idx: i, dir: dir };
        headers.forEach(function (h) { h.classList.remove('sort-asc', 'sort-desc'); });
        th.classList.add(dir === 1 ? 'sort-asc' : 'sort-desc');
        var body = board.querySelector('tbody');
        rows().sort(function (a, b) {
          var av = parseFloat(a.cells[i].getAttribute('data-v'));
          var bv = parseFloat(b.cells[i].getAttribute('data-v'));
          if (isNaN(av)) av = -Infinity;
          if (isNaN(bv)) bv = -Infinity;
          var cmp = (av === bv)
            ? String(a.cells[0].textContent).localeCompare(String(b.cells[0].textContent))
            : av - bv;
          return cmp * dir;
        }).forEach(function (tr) { body.appendChild(tr); });
      });
    });
  }

  // ------------------------------------------------------ run replay -----
  var dataEl = document.getElementById('run-data');
  if (!dataEl) return;
  var payload = JSON.parse(dataEl.textContent);
  var stages = payload.stages || [];
  var names = payload.names || {};

  function fmtTime(ts) { return (ts || '').slice(11, 19); }

  function player(pid, fallback) {
    if (pid && names[pid]) return names[pid];
    if (fallback) return fallback;
    return pid || '?';
  }

  function describe(ev) {
    var d = ev.data || {};
    var who = player(ev.actor_id, d.playerName);
    var t = ev.type;
    if (t === 'AGENT_SAYS_BROADCASTED') return [who + ' says:', d.says];
    if (t === 'VOTE_CAST') return [who + ' votes for ' + (d.targetName || player(d.targetId)) + ':', d.says];
    if (t === 'NIGHT_ACTION_SUBMITTED') {
      if (d.result) return [who + ' investigates ' + (d.targetName || d.targetId) + ' → ' + d.result, d.reason];
      if (who === '?') return ['Mafia night action → ' + (d.targetName || d.targetId), d.reason];
      return [who + ' night action → ' + (d.targetName || d.targetId), d.reason];
    }
    if (t === 'MORNING_REVEAL') {
      var deaths = (d.deaths || []).map(function (x) { return x.name; }).join(', ');
      return [deaths ? 'Morning reveal — dead: ' + deaths : 'Morning reveal — nobody died', null];
    }
    if (t === 'PLAYER_LYNCHED') {
      var lyn = (d.deaths || [])[0];
      return [lyn ? ('Lynched: ' + lyn.name + ' — role ' + (lyn.role || '?')) : 'Player lynched', null];
    }
    if (t === 'PHASE_CHANGED') return ['Phase → ' + (d.phase || '(setup)') + (d.aliveCount != null ? ' · alive ' + d.aliveCount : ''), null];
    if (t === 'GAME_ENDED') return ['Game over — winner: ' + d.winner + ' (mafia alive ' + d.mafiaAlive + ', town alive ' + d.townAlive + ')', null];
    if (t === 'GAME_STARTED') return ['Game started with ' + d.playerCount + ' players', null];
    if (t === 'ROLES_ASSIGNED') return ['Roles assigned to ' + ((d.assignments || []).length) + ' players', null];
    if (t === 'AGENT_THINK_STARTED' || t === 'AGENT_THINK_COMPLETED') {
      return [who + ' thinks (day ' + (ev.metadata ? ev.metadata.dayNumber : '?') + ')', d.think];
    }
    if (t === 'GAME_CREATED' && d.legacyType === 'ABSTAIN') {
      return [who + ' abstains from voting', d.says];
    }
    var bits = Object.keys(d).filter(function (k) {
      return typeof d[k] === 'string' || typeof d[k] === 'number' || typeof d[k] === 'boolean';
    }).slice(0, 5).map(function (k) { return k + '=' + d[k]; });
    return [t.replace(/_/g, ' ').toLowerCase() + (bits.length ? ' — ' + bits.join(', ') : ''), d.think || null];
  }

  function eventNode(ev, withTime) {
    var wrap = document.createElement('div');
    wrap.className = 'event';
    var line = document.createElement('div');
    var meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = (withTime ? fmtTime(ev.timestamp) + ' ' : '') + '#' + (ev.metadata ? ev.metadata.sequence : '');
    line.appendChild(meta);
    var badge = document.createElement('span');
    badge.className = 'badge' + (ev.visibility === 'PRIVATE' ? ' private' : ev.visibility === 'ADMIN' ? ' admin' : '');
    badge.textContent = ev.type.replace(/_/g, ' ').toLowerCase() + (ev.visibility && ev.visibility !== 'PUBLIC' ? ' · ' + ev.visibility.toLowerCase() : '');
    line.appendChild(badge);
    var desc = describe(ev);
    var text = document.createElement('span');
    text.className = 'death';
    text.textContent = desc[0];
    line.appendChild(text);
    wrap.appendChild(line);
    if (desc[1]) {
      var q = document.createElement('div');
      q.className = 'says';
      var qm = document.createElement('span');
      qm.className = 'q';
      qm.textContent = 'SAYS: ';
      q.appendChild(qm);
      q.appendChild(document.createTextNode(desc[1]));
      wrap.appendChild(q);
    }
    var think = (ev.data || {}).think;
    if (think) {
      var th = document.createElement('div');
      th.className = 'think';
      th.textContent = 'THINK: ' + think;
      wrap.appendChild(th);
    }
    return wrap;
  }

  var stageEl = document.getElementById('stage');
  var labelEl = document.getElementById('stage-label');
  var timeline = document.getElementById('timeline');
  var allEvents = document.getElementById('all-events');
  var prevBtn = document.getElementById('prev');
  var nextBtn = document.getElementById('next');
  var thinkBox = document.getElementById('show-think');
  var cur = 0;

  // full event log (always rendered; THINK follows the toggle)
  stages.forEach(function (s) {
    s.events.forEach(function (ev) {
      allEvents.appendChild(eventNode(ev, true));
    });
  });

  stages.forEach(function (s, i) {
    var li = document.createElement('li');
    li.textContent = s.label + ' (' + s.events.length + ')';
    li.addEventListener('click', function () { show(i); });
    timeline.appendChild(li);
  });

  function show(i) {
    cur = Math.max(0, Math.min(stages.length - 1, i));
    var s = stages[cur];
    stageEl.textContent = '';
    var head = document.createElement('h3');
    head.textContent = s.label;
    stageEl.appendChild(head);
    s.events.forEach(function (ev) { stageEl.appendChild(eventNode(ev, true)); });
    labelEl.textContent = 'Stage ' + (cur + 1) + '/' + stages.length;
    prevBtn.disabled = cur === 0;
    nextBtn.disabled = cur === stages.length - 1;
    Array.prototype.forEach.call(timeline.children, function (li, j) {
      li.classList.toggle('current', j === cur);
      if (j === cur && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
    });
  }

  prevBtn.addEventListener('click', function () { show(cur - 1); });
  nextBtn.addEventListener('click', function () { show(cur + 1); });
  thinkBox.addEventListener('change', function () {
    document.body.classList.toggle('show-think', thinkBox.checked);
  });
  show(0);
})();
"""


def render_style() -> str:
    return STYLE_CSS


def render_site_js() -> str:
    return SITE_JS


# ------------------------------------------------------------------- main ---


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Emit the static Mafia AI Benchmark site from the run corpus."
    )
    ap.add_argument(
        "--runs", type=int, default=300, help="cap: most recent N runs (default 300)"
    )
    ap.add_argument(
        "--corpus-dir",
        default=None,
        help="MAF-LAYER-1 corpus dir containing index.jsonl",
    )
    ap.add_argument(
        "--metrics-dir",
        default=None,
        help="MAF-LAYER-2 derived metrics dir (default data/metrics)",
    )
    ap.add_argument("--out", default=None, help="output site dir (default site)")
    ap.add_argument(
        "--cli",
        default=None,
        help="mafiactl CLI dist path (default apps/cli/dist/index.js)",
    )
    args = ap.parse_args()

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    corpus_dir = locate_corpus(args.corpus_dir)
    metrics_dir = os.path.abspath(
        args.metrics_dir or os.path.join(repo_root, "data", "metrics")
    )
    out_dir = os.path.abspath(args.out or os.path.join(repo_root, "site"))
    node_cli = find_cli(args.cli, repo_root)

    index_entries = read_jsonl(os.path.join(corpus_dir, "index.jsonl"))
    total = len(index_entries)
    entries = [
        e
        for e in index_entries
        if os.path.isfile(os.path.join(corpus_dir, e.get("path", "")))
    ]
    entries.sort(key=lambda e: e.get("started_at") or "", reverse=True)
    if args.runs < len(entries):
        entries = entries[: args.runs]
    if not entries:
        fail(f"no run entries found under {corpus_dir}")
    if total and len(entries) < total:
        print(f"site cap: {len(entries)} of {total} runs (most recent, by started_at)")

    # ---- ensure layer-2 metrics exist for every selected run (via the CLI) --
    missing = [
        e["game_id"]
        for e in entries
        if not os.path.isfile(os.path.join(metrics_dir, e["game_id"], "metrics.jsonl"))
    ]
    if missing and node_cli is None:
        fail(
            f"{len(missing)} selected run(s) have no derived metrics and the mafiactl CLI is not built. "
            "Build it: pnpm --filter @mafia/shared build && pnpm --filter @mafia/cli build, then re-run."
        )
    node, cli_path = node_cli if node_cli else (None, None)
    if missing:
        node, cli_path = node_cli
        with tempfile.TemporaryDirectory(prefix="mafia-site-runs-") as tmp:
            capped = os.path.join(tmp, "runs")
            os.makedirs(capped)
            for e in entries:  # symlink, no data copies
                os.symlink(
                    os.path.join(corpus_dir, e["path"]), os.path.join(capped, e["path"])
                )
            print(
                f"deriving metrics for {len(entries)} run(s) via mafiactl → {metrics_dir}"
            )
            res = subprocess.run(
                [node, cli_path, "metrics", "derive", capped, "--out", metrics_dir],
                capture_output=True,
                text=True,
            )
            if res.returncode != 0:
                fail(f"mafiactl metrics derive failed:\n{res.stdout}\n{res.stderr}")
    still_missing = [
        e["game_id"]
        for e in entries
        if not os.path.isfile(os.path.join(metrics_dir, e["game_id"], "metrics.jsonl"))
    ]
    if still_missing:
        fail(
            f"metrics still missing after derive for: {', '.join(still_missing[:5])} …"
        )

    # ---- layer-2 aggregate over exactly the selected runs -------------------
    aggregate = []
    if node_cli:
        with tempfile.TemporaryDirectory(prefix="mafia-site-metrics-") as tmp:
            capped_metrics = os.path.join(tmp, "metrics")
            os.makedirs(capped_metrics)
            for e in entries:
                # symlink the metrics FILE into a real per-run dir: the
                # aggregator's recursive walk only descends real directories
                # (readdirSync Dirent.isSymbolicLink is not isDirectory).
                run_dir = os.path.join(capped_metrics, e["game_id"])
                os.makedirs(run_dir)
                os.symlink(
                    os.path.join(metrics_dir, e["game_id"], "metrics.jsonl"),
                    os.path.join(run_dir, "metrics.jsonl"),
                )
            agg_out = os.path.join(tmp, "aggregate.jsonl")
            res = subprocess.run(
                [
                    node,
                    cli_path,
                    "metrics",
                    "aggregate",
                    capped_metrics,
                    "--out",
                    agg_out,
                ],
                capture_output=True,
                text=True,
            )
            if res.returncode != 0:
                fail(f"mafiactl metrics aggregate failed:\n{res.stdout}\n{res.stderr}")
            aggregate = read_jsonl(agg_out)
    else:
        # No CLI but every metrics file exists: aggregate with the same pooled
        # semantics the layer-2 aggregator uses (metric = pooled ratio, low sample n<5).
        aggregate = aggregate_in_python(entries, metrics_dir)
    if not aggregate:
        fail(
            "layer-2 aggregate produced zero model rows — refusing to emit an empty leaderboard"
        )

    # ---- read run payloads --------------------------------------------------
    runs = []
    for e in entries:
        path = os.path.join(corpus_dir, e["path"])
        lines = read_jsonl(path)
        if not lines:
            print(f"warning: empty run file {e['path']}", file=sys.stderr)
            continue
        header, events = lines[0], lines[1:]
        runs.append(
            {
                "game_id": e["game_id"],
                "path": e["path"],
                "header": header,
                "events": events,
            }
        )

    # ---- emit --------------------------------------------------------------
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(os.path.join(out_dir, "runs"), exist_ok=True)
    os.makedirs(os.path.join(out_dir, "_data"), exist_ok=True)

    with open(
        os.path.join(out_dir, "aggregate.jsonl.tmp"), "w", encoding="utf-8"
    ) as fh:
        for row in aggregate:
            fh.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    os.replace(
        os.path.join(out_dir, "aggregate.jsonl.tmp"),
        os.path.join(out_dir, "_data", "aggregate.jsonl"),
    )

    with open(os.path.join(out_dir, "style.css"), "w", encoding="utf-8") as fh:
        fh.write(render_style())
    with open(os.path.join(out_dir, "site.js"), "w", encoding="utf-8") as fh:
        fh.write(render_site_js())

    rows_html, role_order = leaderboard_rows(aggregate)
    with open(os.path.join(out_dir, "leaderboard.html"), "w", encoding="utf-8") as fh:
        fh.write(render_leaderboard(rows_html, role_order, len(runs)))

    with open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(render_index(runs, total, args.runs, corpus_dir))

    for r in runs:
        payload = RunReplay(r["header"], r["events"]).payload()
        with open(
            os.path.join(out_dir, "runs", r["game_id"] + ".html"), "w", encoding="utf-8"
        ) as fh:
            fh.write(render_run_page(r["game_id"], payload, ""))

    models = len(aggregate)
    print(
        f"site emitted: {len(runs)} run pages + index + leaderboard "
        f"({models} models) → {out_dir}"
    )


def aggregate_in_python(entries: list[dict], metrics_dir: str) -> list[dict]:
    """Fallback aggregation (same pooled semantics as apps/cli metrics aggregate)."""
    seats: dict[str, list[dict]] = {}
    for e in entries:
        rec = read_jsonl(os.path.join(metrics_dir, e["game_id"], "metrics.jsonl"))
        for p in (rec[0].get("per_player") if rec else []) or []:
            if not p.get("model"):
                continue
            seats.setdefault(p["model"], []).append(
                {
                    "won": p.get("won"),
                    "survived": p.get("survived", False),
                    "role": p.get("role", "?"),
                    "votes_cast": p.get("votes_cast", 0),
                    "votes_correct": p.get("votes_correct", 0),
                    "speeches": p.get("speeches", 0),
                    "followers_gained": p.get("followers_gained", 0),
                    "pairs": p.get("think_says_pairs", 0),
                    "lies": p.get("think_says_lies", 0),
                    "game_id": e["game_id"],
                }
            )

    def metric(num: int, den: int) -> dict:
        return {
            "value": (num / den) if den else None,
            "n": den,
            "low_sample": den < LOW_SAMPLE_N,
        }

    out = []
    for model in sorted(seats):
        rows = seats[model]
        decided = [r for r in rows if r["won"] is not None]
        roles: dict[str, list[dict]] = {}
        for r in rows:
            roles.setdefault(r["role"], []).append(r)
        role_order = ["MAFIA"] + sorted(r for r in roles if r != "MAFIA")
        survival_by_role = {
            role: metric(sum(1 for r in roles[role] if r["survived"]), len(roles[role]))
            for role in role_order
        }
        out.append(
            {
                "model": model,
                "games_played": len({r["game_id"] for r in rows}),
                "win_rate": metric(
                    sum(1 for r in decided if r["won"] == 1), len(decided)
                ),
                "survival": metric(sum(1 for r in rows if r["survived"]), len(rows)),
                "survival_by_role": survival_by_role,
                "vote_accuracy": metric(
                    sum(r["votes_correct"] for r in rows),
                    sum(r["votes_cast"] for r in rows),
                ),
                "persuasion": metric(
                    sum(r["followers_gained"] for r in rows),
                    sum(r["speeches"] for r in rows),
                ),
                "lie_rate": metric(
                    sum(r["lies"] for r in rows), sum(r["pairs"] for r in rows)
                ),
            }
        )
    return out


if __name__ == "__main__":
    main()
