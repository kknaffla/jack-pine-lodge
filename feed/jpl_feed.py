#!/usr/bin/env python3
"""Jack Pine Lodge app feed. Runs on Kevin's Mac after the morning run; standard library only.

    python3 feed/jpl_feed.py push      files the morning run produced  -> the app
    python3 feed/jpl_feed.py export    answers entered in the app      -> files the bookkeeping tool reads
    python3 feed/jpl_feed.py backup    everything people entered here  -> dated folder in the OneDrive backup folder
    python3 feed/jpl_feed.py check     read every input and print counts; no network, writes nothing

Never calls QuickBooks or Square. Signs in as the app's "feed" login (role feed): it can write the
feed tables and read everyone's answers, nothing else (see supabase/schema.sql). Settings come from
feed/feed.env (gitignored; see feed/feed.env.example). Pay amounts and rates never leave this Mac:
rows with money keys are refused before upload.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
NOW = datetime.now(timezone.utc).isoformat(timespec="seconds")
CARDS = {"nick": ("1021", "3843"), "pete": ("1047", "3861"), "kevin": ("1005", "5823"), "janet": ("1834", "1853")}
CODE_ACTIONS = ("POST", "ASK", "AMAZON")
PAY_KEYS = re.compile(r"(rate|wage|gross|net_pay|amount|salary|tips?|pay_amount|earnings)$", re.I)


# ------------------------------------------------------------------ settings
def settings() -> dict:
    env = {}
    for p in (HERE / "feed.env", Path.home() / ".config" / "jack-pine-lodge" / "feed.env"):
        if p.exists():
            for line in p.read_text().splitlines():
                m = re.match(r"\s*([A-Z_]+)\s*=\s*(.*?)\s*$", line)
                if m and not line.lstrip().startswith("#"):
                    env[m.group(1)] = m.group(2).strip("'\"")
            break
    env.update({k: v for k, v in os.environ.items() if k.startswith(("JPL_", "SUPABASE_", "FEED_"))})
    env.setdefault("BOOKKEEPING", str(Path.home() / "Bookkeeping"))
    for k in ("BOOKKEEPING", "BACKUP_DIR"):
        if env.get(k):
            env[k] = os.path.expanduser(env[k])
    return env


def bk(env, *parts) -> Path:
    return Path(env["BOOKKEEPING"]).joinpath(*parts)


def read_json(path: Path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return default


# ------------------------------------------------------------------ Supabase (REST, as the feed login)
class Api:
    def __init__(self, env):
        for k in ("SUPABASE_URL", "SUPABASE_KEY", "FEED_EMAIL", "FEED_PASSWORD"):
            if not env.get(k):
                sys.exit(f"feed.env is missing {k} (see feed/feed.env.example)")
        if env["SUPABASE_KEY"].startswith("sb_secret_") or "service_role" in _jwt_role(env["SUPABASE_KEY"]):
            sys.exit("SUPABASE_KEY must be the publishable key, never the secret / service_role key")
        self.url = env["SUPABASE_URL"].rstrip("/")
        self.key = env["SUPABASE_KEY"]
        tok = self._req("POST", "/auth/v1/token?grant_type=password", {"email": env["FEED_EMAIL"], "password": env["FEED_PASSWORD"]}, auth=False)
        self.token = tok["access_token"]
        self.uid = tok["user"]["id"]
        me = self.get("members", {"select": "role", "user_id": "eq." + self.uid})
        if not me or me[0]["role"] != "feed":
            sys.exit("This login is not the app's feed account (members.role must be 'feed'). Refusing to run with more rights than it needs.")

    def _req(self, method, path, body=None, auth=True, headers=None, raw=False):
        h = {"apikey": self.key, "Content-Type": "application/json"}
        if auth:
            h["Authorization"] = "Bearer " + self.token
        h.update(headers or {})
        data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
        req = urllib.request.Request(self.url + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                out = r.read()
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path.split('?')[0]} -> {e.code} {e.read().decode(errors='replace')[:300]}") from None
        if raw:
            return out
        return json.loads(out) if out else None

    def get(self, table, params=None):
        out, start = [], 0
        while True:
            q = urllib.parse.urlencode(params or {})
            rows = self._req("GET", f"/rest/v1/{table}?{q}", headers={"Range-Unit": "items", "Range": f"{start}-{start + 999}"})
            out += rows
            if len(rows) < 1000:
                return out
            start += 1000

    def upsert(self, table, rows, on_conflict):
        for i in range(0, len(rows), 500):
            self._req("POST", f"/rest/v1/{table}?on_conflict={on_conflict}", rows[i:i + 500],
                      headers={"Prefer": "resolution=merge-duplicates,return=minimal"})

    def insert(self, table, rows):
        self._req("POST", f"/rest/v1/{table}", rows, headers={"Prefer": "return=minimal"})

    def patch(self, table, filters, body):
        self._req("PATCH", f"/rest/v1/{table}?{urllib.parse.urlencode(filters)}", body, headers={"Prefer": "return=minimal"})

    def delete(self, table, filters):
        self._req("DELETE", f"/rest/v1/{table}?{urllib.parse.urlencode(filters)}", headers={"Prefer": "return=minimal"})

    def download(self, bucket, path):
        return self._req("GET", f"/storage/v1/object/authenticated/{bucket}/{urllib.parse.quote(path)}", raw=True)

    def list_objects(self, bucket):
        out, offset = [], 0
        while True:
            rows = self._req("POST", f"/storage/v1/object/list/{bucket}", {"prefix": "", "limit": 100, "offset": offset, "sortBy": {"column": "name", "order": "asc"}})
            folders = [r["name"] for r in rows if r.get("id") is None]
            out += [r["name"] for r in rows if r.get("id")]
            for f in folders:
                sub = self._req("POST", f"/storage/v1/object/list/{bucket}", {"prefix": f + "/", "limit": 1000, "offset": 0})
                out += [f + "/" + r["name"] for r in sub if r.get("id")]
            if len(rows) < 100:
                return out
            offset += 100

    def log(self, kind, ok, summary):
        try:
            self.insert("feed_runs", [{"kind": kind, "ok": ok, "summary": summary[:500]}])
        except RuntimeError as e:
            print("could not log the run:", e, file=sys.stderr)


def _jwt_role(key: str) -> str:
    """The payload of a legacy JWT key (anon or service_role); '' for the new sb_publishable_ keys."""
    try:
        import base64
        part = key.split(".")[1]
        return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)).decode()
    except (IndexError, ValueError):
        return ""


def no_pay(rows, what):
    """Refuse to upload anything that looks like pay (the app never stores pay amounts or rates)."""
    for r in rows:
        bad = [k for k in r if PAY_KEYS.search(k)]
        if bad:
            raise SystemExit(f"{what}: refusing to upload pay fields {bad}")
    return rows


# ------------------------------------------------------------------ small YAML readers (PyYAML if present)
def load_yaml(path: Path):
    try:
        import yaml  # the bookkeeping venv has it
        return yaml.safe_load(path.read_text())
    except ImportError:
        return None


def square_categories(env) -> list:
    path = bk(env, "config", "square_mapping.yaml")
    y = load_yaml(path)
    cats = (y or {}).get("categories") if y else None
    if cats is None:   # simple line parser for: "Name": {treatment: income, line: Food}
        cats = {}
        for m in re.finditer(r'^\s*"([^"]+)":\s*\{([^}]*)\}', path.read_text(), re.M):
            cats[m.group(1)] = dict(re.findall(r"(\w+):\s*([^,]+?)\s*(?:,|$)", m.group(2)))
    out = []
    for i, (name, rule) in enumerate(cats.items()):
        t = rule.get("treatment", "income")
        line = rule.get("line") or {"camplife": rule.get("class", "CampLife"), "tips": "Tips", "gift_card": "Gift cards"}.get(t, name)
        out.append({"category": name, "line": line, "treatment": t, "sort": i})
    return out


def feed_config(env) -> dict:
    path = bk(env, "config", "feed.yaml")
    y = load_yaml(path)
    if y is not None:
        return {"owner_ids": y.get("owner_ids", []), "vehicles": [v["name"] for v in y.get("vehicles", [])], "cap": int(y.get("capitalization_threshold", 50000))}
    text = path.read_text()
    owners = re.search(r"^owner_ids:\s*\[(.*?)\]", text, re.M)
    return {"owner_ids": [s.strip() for s in owners.group(1).split(",")] if owners else [],
            "vehicles": re.findall(r'-\s*\{name:\s*"([^"]+)"', text),
            "cap": int((re.search(r"^capitalization_threshold:\s*(\d+)", text, re.M) or [0, 50000])[1])}


# ------------------------------------------------------------------ build: card charges
HELD_TEXT = [  # the wording a cardholder sees (same as the card-charges pages); Kevin sees the tool's reason
    (r"^differs from Kevin", "Kevin is reviewing this one"), (r"^possible duplicate", "May be a double charge: checking the statement"),
    (r"^under the", "Under the asset line: Kevin will recode it as an expense"), (r"^capital", "Asset: waiting for Kevin to OK it"),
    (r"^limited deductibility", "Meal: waiting for Kevin to OK it"), (r"^account not in QuickBooks", "Account not in QuickBooks: Kevin will pick one"),
    (r"^no class chosen", "Needs a class: pick one and approve again"), (r"^two QuickBooks entries", "May be a double charge: checking"),
    (r"^changed in QuickBooks", "Changed in QuickBooks since it was read: Kevin is checking"),
    (r"^(no reconciled-through|dated on or before)", "Waiting for Kevin (statement check)")]


def held_text(reason):
    for rx, text in HELD_TEXT:
        if re.search(rx, reason or ""):
            return text
    return "Waiting for Kevin"


def holder_of(card):
    for who, cards in CARDS.items():
        if card and card in cards:
            return who
    return None


def coding_text(account, cls):
    return (account or "not coded") + (f" [{cls}]" if cls else (", no class" if account else ""))


def build_charges(env, existing: dict) -> tuple[list, list]:
    """Rows for charges and charge_kevin from the worklist, QuickBooks-added rows, answers, posting status
    and the posted lists. existing = {id: {handed_to, handoff_at}} already in the app (Kevin's hand-offs win)."""
    items = read_json(bk(env, "data", "feed", "review_items.json"), [])
    have = {i["id"] for i in items}
    links = {}
    for who in CARDS:
        added = read_json(bk(env, "data", "feed", "added", f"rows_{who}.json"), {}) or {}
        for r in added.get("rows", []):
            if r["id"] not in have:
                items.append(dict(r, qbo_coding=coding_text(r.get("account"), r.get("cls"))))
                have.add(r["id"])
        links.update(added.get("links", {}))
    answers = {}
    for p in glob.glob(str(bk(env, "data", "feed", "answers", "items", "*.json"))):
        d = read_json(Path(p), {}) or {}
        d = d.get("data") if isinstance(d.get("data"), dict) and "status" in d["data"] else d
        answers[Path(p).stem] = d
    status = read_json(bk(env, "data", "feed", "status", "all.json"), {}) or {}
    posted, held, held_rc, linked = status.get("posted", {}), status.get("held", {}), status.get("held_recode", {}), status.get("linked", {})
    charges, kev = [], []
    for it in items:
        i = it["id"]
        a = answers.get(i) or {}
        who = (a.get("who") or "").strip().lower()
        page_hand = "nick" if who.startswith("nick") else "pete" if who.startswith("pete") else None
        ex = existing.get(i) or {}
        lk = linked.get(i) or links.get(i)
        reason = held.get(i) or held_rc.get(i)
        hand = ex.get("handed_to") if ex.get("handoff_at") else page_hand
        holder = holder_of(it.get("card"))
        resp = hand or (holder if holder in ("nick", "pete") else "kevin")   # who codes the row, as on the pages
        ans = {k: a.get(k) for k in ("status", "account", "cls", "note", "vehicle", "at", "by") if a.get(k) is not None} if a else None
        charges.append({
            "id": i, "src": it.get("src"), "card": it.get("card") or "", "holder": holder,
            "handed_to": hand, "handoff_at": ex.get("handoff_at"),
            "date": it.get("date"), "descr": it.get("desc"), "payee": it.get("payee") or "", "suggest": it.get("suggest") or "",
            "amt_cents": it.get("amt"), "action": it.get("action"), "account": it.get("account") or "", "cls": it.get("cls") or "",
            "golf": bool(it.get("golf")), "conf": it.get("conf"), "question": it.get("q") or None, "tool_note": it.get("note") or None,
            "qbo": (lk or {}).get("qbo") or it.get("qbo"), "qbo_coding": coding_text((lk or {}).get("account"), (lk or {}).get("cls")) if lk else it.get("qbo_coding"),
            "posted_at": (posted.get(i) or {}).get("posted_at"), "held_text": held_text(reason) if reason else None,
            "holder_answer": ans if resp != "kevin" else None, "active": True, "as_of": NOW})
        kevin_answer = ans if resp == "kevin" else (dict(a["owner_pick"], status="ok") if a.get("owner_pick") else None)
        if reason or kevin_answer:
            kev.append({"charge_id": i, "held_reason": reason, "kevin_answer": kevin_answer, "as_of": NOW})
    for who in ("kevin", "nick", "pete", "janet"):
        for r in read_json(bk(env, "data", "feed", f"posted_{who}.json"), []) or []:
            charges.append({"id": "p-" + str(r["id"]), "src": r.get("src"), "card": "", "holder": who, "handed_to": None, "handoff_at": None,
                            "date": r.get("date"), "descr": r.get("desc"), "payee": "", "suggest": "", "amt_cents": r.get("amt"), "action": "POSTED",
                            "account": r.get("account") or "", "cls": r.get("cls") or "", "golf": False, "conf": None, "question": None, "tool_note": None,
                            "qbo": r.get("qbo_id"), "qbo_coding": None, "posted_at": None, "held_text": None, "holder_answer": None, "active": True, "as_of": NOW})
    return charges, kev


def build_golf(env) -> list:
    """Golf course spend by month, totals only: the same rule as the Performance page's golf file."""
    items = read_json(bk(env, "data", "feed", "review_items.json"), [])
    if isinstance(items, dict):
        items = next((v for v in items.values() if isinstance(v, list)), [])
    year = str(date.today().year)
    sel = [i for i in items if str(i.get("date", "")).startswith(year) and (i.get("golf") or str(i.get("account", "")).startswith("Construction in Progress"))
           and i.get("action") not in ("TRANSFER", "MATCH", "EXCLUDE")]
    out = {}
    for i in sel:
        m = i["date"][:7]
        for measure, label, keep in (("golf_uncoded", "Golf spend uncoded in the bank feed", True),
                                     ("golf_to_expense", "Of which proposed to expense accounts", str(i.get("account", "")).startswith(("Repairs and Maintenance", "Automobile")))):
            if not keep:
                continue
            r = out.setdefault((m, measure), {"month": m, "measure": measure, "label": label, "amount": 0.0, "items": 0, "as_of": NOW})
            r["amount"] = round(r["amount"] - (i.get("amt") or 0) / 100, 2)
            r["items"] += 1
    return list(out.values())


# ------------------------------------------------------------------ build: CampLife
def newest(env, kind):
    days = sorted(glob.glob(str(bk(env, "data", "camplife", "*", "days", f"{kind}_*.json"))))
    if days:
        return Path(days[-1])
    months = sorted(glob.glob(str(bk(env, "data", "camplife", "20*", f"{kind}.json"))))
    return Path(months[-1]) if months else None


def money_num(v):
    try:
        return round(float(str(v).replace("$", "").replace(",", "")), 2)
    except (TypeError, ValueError):
        return None


def build_camplife(env):
    arr_p, dep_p, act_p = newest(env, "arrivals"), newest(env, "departures"), newest(env, "daily_activity")
    arr = read_json(arr_p, {}) if arr_p else {}
    dep = read_json(dep_p, {}) if dep_p else {}
    act = read_json(act_p, {}) if act_p else {}
    stamps = [m.group(1) for m in (re.search(r"(\d{4}-\d{2}-\d{2})", str(p)) for p in (arr_p, dep_p, act_p) if p) if m]
    day = max(stamps) if stamps else date.today().isoformat()
    owing = [{"name": g.get("guest"), "site": g.get("site"), "amount": money_num(g.get("balance"))} for g in (arr.get("owing") or []) + (dep.get("owing") or [])]
    missing = [k for k, p in (("arrivals", arr_p), ("departures", dep_p), ("daily activity", act_p)) if not p or day not in str(p)]
    row = {"date": day,
           "arrivals": [{"name": g.get("guest"), "site": g.get("site"), "nights": g.get("nights"), "balance": money_num(g.get("balance"))} for g in arr.get("rows") or []],
           "departures": [{"name": g.get("guest"), "site": g.get("site"), "balance": money_num(g.get("balance"))} for g in dep.get("rows") or []],
           "owing": owing, "note": ("No " + ", ".join(missing) + " report for this day." if missing else "All reports in."), "as_of": NOW}
    bal = {"date": day, "advance_deposit_balance": money_num(act.get("advance_deposit_balance")), "future_reservation_total": money_num(act.get("future_reservation_total")),
           "future_reservation_balance": money_num(act.get("future_reservation_balance")), "as_of": NOW} if act else None
    return row, bal


# ------------------------------------------------------------------ build: files the Claude runs save (data/feed/app/in)
def inbox(env, name):
    return read_json(bk(env, "data", "feed", "app", "in", name))


def is_jack_pine(loc):
    return "jack pine" in str(loc or "").lower()


def build_inbox(env) -> dict:
    out = {}
    rows = inbox(env, "square_day_cat.json")
    if rows:
        out["sales_daily"] = [{"day": r["day"], "location": r["location"], "category": r.get("category") or "Uncategorized", "net_sales": round(float(r["net_sales"]), 2), "as_of": r.get("as_of") or NOW}
                              for r in rows if is_jack_pine(r.get("location")) and r.get("day")]
    rows = inbox(env, "square_mix.json")
    if rows:
        agg = {}
        for r in rows:
            if not is_jack_pine(r.get("location")):
                continue
            k = (r["month"], r["location"], r.get("category") or "Uncategorized", r.get("item") or "")
            agg[k] = round(agg.get(k, 0) + float(r["net_sales"]), 2)
        out["sales_items_monthly"] = [{"month": k[0], "location": k[1], "category": k[2], "item": k[3], "net_sales": v, "as_of": NOW} for k, v in agg.items()]
    rows = inbox(env, "payroll_lines.json")
    if rows:
        agg = {}
        for r in rows:
            if r.get("hours") is None:
                continue
            k = (str(r["payslip_id"]), r.get("pay_type") or "")
            a = agg.setdefault(k, {"payslip_id": k[0], "pay_type": k[1], "employee": r.get("employee"), "pay_date": r.get("pay_date"),
                                   "period_begin": r.get("period_begin"), "period_end": r.get("period_end"), "hours": 0.0, "as_of": r.get("as_of") or NOW})
            a["hours"] = round(a["hours"] + float(r["hours"]), 2)
        out["payroll_hours"] = no_pay(list(agg.values()), "payroll hours")
    doc = inbox(env, "drawers.json")
    if doc and doc.get("shifts") is not None:
        n = {}
        shifts = []
        for s in sorted(doc["shifts"], key=lambda s: (s.get("date") or "")):
            n[s["date"]] = n.get(s["date"], 0) + 1
            shifts.append({"id": f"{s['date']}-{n[s['date']]}", "date": s["date"], "state": s.get("state"), "closed_by": s.get("by"), "start_cash": s.get("start"),
                           "cash_in": s.get("cash_in"), "paid_in": s.get("paid_in"), "paid_out": s.get("paid_out"), "expected": s.get("expected"),
                           "counted": s.get("counted"), "over_short": s.get("over_short"), "as_of": doc.get("at") or NOW})
        out["drawer_shifts"] = shifts
    doc = inbox(env, "timeclock.json")
    if doc and doc.get("cards") is not None:
        flags = {f["shift_id"]: f for f in doc.get("flags", []) if f.get("shift_id")}
        out["timecards"] = no_pay([{"shift_id": c["id"], "tm": c.get("tm"), "name": c.get("name"), "job": c.get("job"), "in_at": c.get("in_at"), "out_at": c.get("out_at"),
                                    "hours": c.get("hours"), "auto": bool(c.get("auto")), "flag": (flags.get(c["id"]) or {}).get("kind"),
                                    "flag_text": (flags.get(c["id"]) or {}).get("text"), "as_of": doc.get("as_of") or NOW} for c in doc["cards"] if c.get("id")], "timecards")
    doc = inbox(env, "tiles.json")
    if doc:
        out["tiles"] = {"key": "tiles", "data": doc.get("values", doc), "at": doc.get("at") or NOW}
    briefs = []
    for name, aud in (("brief.json", "kevin"), ("brief_gm.json", "gm")):
        d = inbox(env, name)
        if d and (d.get("week_start") or d.get("date")):
            if aud == "gm":
                d = {k: v for k, v in d.items() if k not in ("cash", "bank_items_waiting", "bills_due", "decisions_waiting", "close")}
            briefs.append({"week_start": d.get("week_start") or d.get("date"), "audience": aud, "written_at": d.get("written_at") or NOW, "data": d})
    if briefs:
        out["briefs"] = briefs
    tasks = inbox(env, "tasks_launchpad.json")
    if tasks is not None:
        out["launchpad_tasks"] = tasks if isinstance(tasks, list) else list(tasks.values())
    return out


def run_attention(env, who=None):
    py = bk(env, ".venv", "bin", "python")
    cmd = [str(py) if py.exists() else sys.executable, "-m", "jpl", "attention"] + (["--for", who] if who else [])
    try:
        r = subprocess.run(cmd, cwd=str(bk(env)), capture_output=True, text=True, timeout=120)
        return json.loads(r.stdout) if r.returncode == 0 else None
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None


def build_all(env, existing_charges) -> dict:
    out = build_inbox(env)
    out["charges"], out["charge_kevin"] = build_charges(env, existing_charges)
    out["golf_spend"] = build_golf(env)
    out["camplife_days"], out["camplife_balances"] = build_camplife(env)
    out["sales_categories"] = square_categories(env)
    cfg = feed_config(env)
    accts = read_json(bk(env, "data", "feed", "accounts.json"), []) or []
    keep = {"Expense", "Cost of Goods Sold", "Other Expense", "Fixed Asset", "Other Current Asset", "Other Current Liability", "Long Term Liability", "Credit Card", "Bank", "Other Asset"}
    names = sorted({a["name"] for a in accts if a.get("type") in keep} | {"Construction in Progress - Golf Course"})
    out["app_lists"] = [{"key": "accounts", "data": names, "at": NOW}, {"key": "vehicles", "data": cfg["vehicles"], "at": NOW},
                        {"key": "settings", "data": {"cap_threshold_cents": cfg["cap"]}, "at": NOW}]
    docs = [{"key": "alerts", "data": read_json(bk(env, "data", "feed", "added", "alerts.json"), {}) or {}, "at": NOW},
            {"key": "statements", "data": read_json(bk(env, "data", "feed", "statements", "index.json"), {}) or {}, "at": NOW},
            {"key": "jobs", "data": {Path(p).stem: read_json(Path(p), {}) for p in glob.glob(str(bk(env, "data", "status", "*.json")))}, "at": NOW}]
    if out.get("tiles"):
        docs.append(out.pop("tiles"))
    out["kevin_docs"] = docs
    att = []
    for aud, who in (("kevin", None), ("nick", "nick")):
        d = run_attention(env, who)
        if d is None:
            continue
        att += [{"audience": aud, "key": it.get("key") or it["label"][:40], "label": it["label"], "count": it.get("count"), "level": it.get("level") if it.get("level") in ("crit", "warn", "wait", "good") else "wait",
                 "link": it.get("link"), "as_of": d.get("at") or NOW} for it in d.get("items", []) if it.get("label")]
    out["attention_items"] = att
    return out


# ------------------------------------------------------------------ commands
def cmd_check(env, args):
    data = build_all(env, {})
    for k, v in data.items():
        n = len(v) if isinstance(v, list) else (1 if v else 0)
        print(f"{k:22} {n}")
    for name in ("square_day_cat.json", "square_mix.json", "payroll_lines.json", "drawers.json", "timeclock.json", "tiles.json", "brief.json", "brief_gm.json", "tasks_launchpad.json"):
        p = bk(env, "data", "feed", "app", "in", name)
        print(f"  in/{name:22} {'found, ' + datetime.fromtimestamp(p.stat().st_mtime).strftime('%b %d %H:%M') if p.exists() else 'missing'}")
    if args.out:
        Path(args.out).mkdir(parents=True, exist_ok=True)
        for k, v in data.items():
            (Path(args.out) / f"{k}.json").write_text(json.dumps(v, indent=1, default=str))
        print("payloads written to", args.out)


def cmd_push(env, args):
    api = Api(env)
    existing = {r["id"]: r for r in api.get("charges", {"select": "id,handed_to,handoff_at,active"})}
    data = build_all(env, existing)
    done = []
    try:
        for table, key in (("sales_categories", "category"), ("sales_daily", "day,location,category"), ("sales_items_monthly", "month,location,category,item"),
                           ("payroll_hours", "payslip_id,pay_type"), ("golf_spend", "month,measure"), ("app_lists", "key"), ("kevin_docs", "key"),
                           ("briefs", "week_start,audience")):
            rows = data.get(table)
            if rows:
                api.upsert(table, rows, key)
                done.append(f"{table} {len(rows)}")
        if data.get("camplife_days"):
            api.upsert("camplife_days", [data["camplife_days"]], "date")
            done.append("camplife 1")
        if data.get("camplife_balances"):
            api.upsert("camplife_balances", [data["camplife_balances"]], "date")
        if data.get("drawer_shifts") is not None:
            shifts = data["drawer_shifts"]
            if shifts:
                api.delete("drawer_shifts", {"date": "gte." + min(s["date"] for s in shifts)})
                api.upsert("drawer_shifts", shifts, "id")
            done.append(f"drawer shifts {len(shifts)}")
        if data.get("timecards") is not None:
            cards = data["timecards"]
            if cards:
                api.upsert("timecards", cards, "shift_id")
                keep = ",".join('"' + c["shift_id"].replace('"', "") + '"' for c in cards)
                api.delete("timecards", {"shift_id": f"not.in.({keep})"})
            done.append(f"timecards {len(cards)}")
        if data["attention_items"]:
            api.delete("attention_items", {"audience": "in.(kevin,nick)"})
            api.upsert("attention_items", data["attention_items"], "audience,key")
            done.append(f"attention {len(data['attention_items'])}")
        charges = data["charges"]
        api.upsert("charges", charges, "id")
        gone = [i for i, r in existing.items() if r.get("active") and i not in {c["id"] for c in charges}]
        for i in range(0, len(gone), 200):
            api.patch("charges", {"id": "in.(" + ",".join('"' + g + '"' for g in gone[i:i + 200]) + ")"}, {"active": False})
        api.delete("charge_kevin", {"charge_id": "neq.__none__"})
        if data["charge_kevin"]:
            api.upsert("charge_kevin", data["charge_kevin"], "charge_id")
        done.append(f"charges {len(charges)} ({len(gone)} gone)")
        if data.get("launchpad_tasks") is not None:
            have = {t["id"]: t for t in api.get("tasks", {"select": "id,status", "source": "eq.launch pad"})}
            new, closed = [], 0
            for t in data["launchpad_tasks"]:
                who = str(t.get("who") or "kevin").strip().lower()
                if who not in ("kevin", "nick", "pete"):
                    who = "kevin"
                tid = "lp-" + str(t["id"])
                if tid not in have:
                    new.append({"id": tid, "title": str(t.get("title") or "(untitled)")[:200], "detail": (t.get("detail") or "")[:1000], "status": "done" if t.get("status") == "done" else "open",
                                "link": t.get("link") or "", "who": who, "source": "launch pad", "created": t.get("created") or NOW, "done_at": t.get("done_at")})
                elif t.get("status") == "done" and have[tid]["status"] != "done":
                    api.patch("tasks", {"id": "eq." + tid}, {"status": "done", "done_at": t.get("done_at") or NOW})
                    closed += 1
            if new:
                api.insert("tasks", new)
            done.append(f"launch pad tasks +{len(new)} done {closed}")
    except (RuntimeError, SystemExit) as e:
        api.log("push", False, f"failed after {', '.join(done) or 'nothing'}: {e}")
        raise
    summary = "; ".join(done)
    api.log("push", True, summary)
    print("pushed:", summary)


def cmd_export(env, args):
    """App answers -> data/feed/app/answers/<who>/items/<id>.json (the page-export shape `jpl feed-answers` reads);
    fixes, payroll asks, schedule, tasks and daily close -> data/feed/app/out/*.json."""
    api = Api(env)
    cfg = feed_config(env)
    owner = (cfg["owner_ids"] or ["kevin-app"])[0]
    answers = api.get("charge_answers", {"select": "*"})
    handed = {c["id"]: c for c in api.get("charges", {"select": "id,handed_to,handoff_at", "handoff_at": "not.is.null"})}
    root = bk(env, "data", "feed", "app", "answers")
    per = {"kevin": {}, "nick": {}, "pete": {}}
    for a in answers:
        doc = {"status": a["status"], "account": a.get("account") or "", "cls": a.get("cls") or "", "golf": bool(a.get("golf")), "note": a.get("note") or "",
               "vehicle": a.get("vehicle") or "", "at": a.get("updated_at"), "by": owner if a["who"] == "kevin" else "app:" + a["who"]}
        per[a["who"]][a["charge_id"]] = doc
    for cid, c in handed.items():   # Kevin's hand-offs travel as 'who' on his answers, as on his review page
        doc = per["kevin"].setdefault(cid, {"status": "open", "account": "", "cls": "", "at": c["handoff_at"], "by": owner})
        doc["who"] = (c.get("handed_to") or "kevin").title()
    for who, docs in per.items():
        folder = root / who / "items"
        folder.mkdir(parents=True, exist_ok=True)
        for old in folder.glob("*.json"):
            old.unlink()
        for cid, doc in docs.items():
            (folder / f"{cid}.json").write_text(json.dumps(doc, indent=1))
    out = bk(env, "data", "feed", "app", "out")
    out.mkdir(parents=True, exist_ok=True)
    since = (date.today() - timedelta(days=60)).isoformat()
    exports = {
        "timecard_fixes.json": api.get("timecard_fixes", {"select": "*", "created_at": "gte." + since, "order": "created_at.desc"}),
        "payroll_asks.json": api.get("payroll_asks", {"select": "*", "order": "period_end.desc"}),
        "schedule_weeks.json": api.get("schedule_weeks", {"select": "*", "week_of": "gte." + since}),
        "tasks.json": api.get("tasks", {"select": "*", "order": "created"}),
        "daily_close.json": api.get("daily_close", {"select": "*", "date": "gte." + since}),
    }
    for name, rows in exports.items():
        (out / name).write_text(json.dumps(rows, indent=1))
    pend = sum(1 for f in exports["timecard_fixes.json"] if f["status"] == "pending")
    summary = (f"answers kevin {len(per['kevin'])}, nick {len(per['nick'])}, pete {len(per['pete'])}; fixes pending {pend}; "
               f"payroll asks {len(exports['payroll_asks.json'])}; schedules {len(exports['schedule_weeks.json'])}; tasks {len(exports['tasks.json'])}")
    api.log("export", True, summary)
    print("exported:", summary)
    print("answers folders:", " ".join(str(root / w) for w in per))


BACKUP_TABLES = ["charge_answers", "charge_setup_notes", "timecard_fixes", "schedule_weeks", "payroll_asks", "daily_close", "tasks",
                 "charges", "charge_kevin", "briefs", "camplife_days", "camplife_balances", "drawer_shifts", "timecards", "payroll_hours",
                 "golf_spend", "attention_items", "kevin_docs", "app_lists", "sales_categories", "feed_runs", "sales_items_monthly", "sales_daily"]


def cmd_backup(env, args):
    dest_root = env.get("BACKUP_DIR")
    if not dest_root:
        sys.exit("feed.env is missing BACKUP_DIR (the OneDrive backup folder Kevin chose)")
    api = Api(env)
    dest = Path(dest_root).expanduser() / date.today().isoformat()
    (dest / "photos").mkdir(parents=True, exist_ok=True)
    counts = {}
    for t in BACKUP_TABLES:
        rows = api.get(t, {"select": "*"})
        (dest / f"{t}.json").write_text(json.dumps(rows, separators=(",", ":")))
        counts[t] = len(rows)
    photos = 0
    for path in api.list_objects("payroll-photos"):
        target = dest / "photos" / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(api.download("payroll-photos", path))
        photos += 1
    (dest / "manifest.json").write_text(json.dumps({"app": "jack-pine-lodge", "at": NOW, "rows": counts, "photos": photos}, indent=1))
    size = sum(f.stat().st_size for f in dest.rglob("*") if f.is_file())
    summary = f"{sum(counts.values())} rows in {len(counts)} tables, {photos} photos, {size / 1e6:.1f} MB -> {dest}"
    api.log("backup", True, summary)
    print("backup:", summary)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["push", "export", "backup", "check"])
    ap.add_argument("--out", help="check: also write the payloads here (keep it outside the repo: it is real data)")
    args = ap.parse_args()
    env = settings()
    if args.out and Path(args.out).resolve().is_relative_to(HERE.parent):
        sys.exit("--out must be outside the repo (the payloads are real data)")
    {"push": cmd_push, "export": cmd_export, "backup": cmd_backup, "check": cmd_check}[args.command](env, args)


if __name__ == "__main__":
    main()
