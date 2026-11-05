#!/usr/bin/env python3
"""Adds a project "Sequence tests" to an account in the development database: one
board per situation the activation bars must handle, each with a note saying what
you should see. Running it again puts the boards back as they were.

    python3 scripts/seed_sequence_tests.py you@example.com

Reads DATABASE_URL from .env (the one docker-compose.yml uses) and needs psql.
Reload the app afterwards (Cmd+R).
"""

import glob
import json
import os
import re
import shutil
import subprocess
import sys

PROJECT_ID = "5e9e0000-0000-4000-8000-000000000000"
GAP = 260  # between lifelines
LIFELINE_W = 140


def lifelines(names, h):
    return [{"id": n, "kind": "lifeline", "x": i * GAP, "y": 0, "w": LIFELINE_W, "h": h, "text": n, "color": "white"} for i, n in enumerate(names)]


def msg(i, frm, to, y, text="", ret=False):
    """A message `frm` → `to` at height y; ret: dashed with an open arrow (a reply)."""
    e = {"id": f"m{i}", "from": frm, "to": to, "style": "straight", "messageY": y}
    if text:
        e["label"] = text
    if ret:
        e.update({"pattern": "dashed", "endCap": "open"})
    return e


def note(text, count):
    return {"id": "note", "kind": "comment", "x": count * GAP + 40, "y": 0, "w": 300, "h": 200, "text": text, "color": "yellow"}


def board(names, h, messages, expect):
    edges = [msg(i + 1, *m) for i, m in enumerate(messages)]
    return {"kind": "flow", "data": {"nodes": lifelines(names, h) + [note(expect, len(names))], "edges": edges, "camera": {"x": -80, "y": -60, "zoom": 1}, "diagram": "sequence"}}


BOARDS = [
    (
        "1 · Call inside a call, and a callback",
        board(
            ["A", "B", "C"],
            460,
            [("A", "B", 100, "start"), ("B", "C", 140, "ask"), ("C", "A", 220, "callback"), ("A", "B", 260, "again"), ("B", "A", 340, "done", True)],
            "A: a bar from 'start' down, and a second bar on top of it from 'callback'.\n"
            "B: a long bar from 'start', and a short one on top of it from 'again' to 'done'.\n"
            "C: a bar from 'ask' to just past 'callback'.\n"
            "'done' leaves from B's top bar and arrives at A's top bar.",
        ),
    ),
    (
        "2 · Simple call and return",
        board(
            ["A", "B"],
            300,
            [("A", "B", 100, "request"), ("B", "A", 200, "response", True)],
            "A: one bar from 'request' down.\nB: one bar from 'request' to 'response'.\nNo nesting anywhere.",
        ),
    ),
    (
        "3 · A chain with returns",
        board(
            ["A", "B", "C", "D"],
            420,
            [("A", "B", 100, "1"), ("B", "C", 140, "2"), ("C", "D", 180, "3"), ("D", "C", 220, "3 ok", True), ("C", "B", 260, "2 ok", True), ("B", "A", 300, "1 ok", True)],
            "A staircase: each bar ends at its own return.\nB: 1 to '1 ok'. C: 2 to '2 ok'. D: 3 to '3 ok'.\nNo bar on top of another.",
        ),
    ),
    (
        "4 · Three calls deep into one lifeline",
        board(
            ["A", "B"],
            440,
            [("A", "B", 100, "outer"), ("A", "B", 150, "middle"), ("A", "B", 200, "inner"), ("B", "A", 250, "inner ok", True), ("B", "A", 300, "middle ok", True), ("B", "A", 350, "outer ok", True)],
            "B: three bars stacked, each a bit more to the right.\n"
            "'inner ok' leaves the rightmost bar, 'outer ok' the leftmost.\nEach return ends its own bar.",
        ),
    ),
    (
        "5 · Overlapping calls (not nested)",
        board(
            ["A", "B", "C"],
            380,
            [("A", "B", 100, "from A"), ("C", "B", 150, "from C"), ("B", "A", 200, "to A", True), ("B", "C", 260, "to C", True)],
            "B: a bar from 'from A' to 'to A', and one on top of it from 'from C' to 'to C', sticking out below the first.\n"
            "A and C: each their own bar from their first message down.",
        ),
    ),
    (
        "6 · Calls without a return",
        board(
            ["A", "B", "C"],
            380,
            [("A", "B", 100, "go"), ("B", "C", 160, "go on"), ("C", "C", 220, "work")],
            "B: a bar from 'go' to just past 'go on'.\nC: a bar from 'go on' to just past its self-message 'work'.\nA: a bar from 'go' down.",
        ),
    ),
    (
        "7 · Async messages that answer nothing",
        board(
            ["A", "B", "C"],
            340,
            [("A", "B", 100, "notify", True), ("A", "C", 180, "call"), ("C", "A", 240, "reply", True)],
            "'notify' is dashed and answers nothing: B gets no bar.\nC: a bar from 'call' to 'reply'.\nA: a bar from 'notify' down.",
        ),
    ),
    (
        "8 · Self-calls",
        board(
            ["A", "B"],
            380,
            [("A", "B", 100, "handle"), ("B", "B", 150, "validate"), ("B", "B", 210, "save"), ("B", "A", 290, "ok", True)],
            "B: one bar from 'handle' to 'ok'.\nThe two self-messages loop out from the right side of that bar.",
        ),
    ),
]


def database_url():
    if os.environ.get("DATABASE_URL"):
        url = os.environ["DATABASE_URL"]
    else:
        env = open(os.path.join(os.path.dirname(__file__), "..", ".env")).read()
        m = re.search(r"^DATABASE_URL=(.+)$", env, re.M)
        url = m.group(1).strip() if m else "postgres://flow:flow@localhost:5432/flow"
    # .env is written for Docker; from this computer it is localhost
    return url.replace("host.docker.internal", "localhost")


def psql():
    found = shutil.which("psql") or next(iter(sorted(glob.glob("/opt/homebrew/opt/postgresql*/bin/psql"), reverse=True)), None)
    if not found:
        sys.exit("psql not found: install PostgreSQL's client (brew install libpq)")
    return found


def lit(s):
    return "'" + s.replace("'", "''") + "'"


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    email = sys.argv[1].strip().lower()
    user = f"(SELECT id FROM users WHERE email = {lit(email)})"
    sql = [
        "\\set ON_ERROR_STOP on",
        "BEGIN;",
        f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM users WHERE email = {lit(email)}) THEN RAISE EXCEPTION 'no account for {email}'; END IF; END $$;",
        f"DELETE FROM projects WHERE id = {lit(PROJECT_ID)};",
        f"INSERT INTO projects (id, owner_id, name, description) VALUES ({lit(PROJECT_ID)}, {user}, 'Sequence tests', 'Activation bars: one board per situation, with a note on what to expect.');",
        f"INSERT INTO project_members (project_id, user_id, role, sidebar_order) VALUES ({lit(PROJECT_ID)}, {user}, 'owner', 0);",
    ]
    for i, (name, content) in enumerate(BOARDS, 1):
        doc_id = f"5e9e0000-0000-4000-8000-{i:012d}"
        sql.append(
            f"INSERT INTO documents (id, project_id, folder_id, sort_order, name, kind, content) "
            f"VALUES ({lit(doc_id)}, {lit(PROJECT_ID)}, NULL, {i}, {lit(name)}, 'flow', {lit(json.dumps(content))}::jsonb);"
        )
    sql.append("COMMIT;")
    subprocess.run([psql(), database_url(), "-q"], input="\n".join(sql), text=True, check=True)
    print(f"'Sequence tests' with {len(BOARDS)} boards added for {email}. Reload Flow (Cmd+R).")


if __name__ == "__main__":
    main()
