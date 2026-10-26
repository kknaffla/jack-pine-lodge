"""Headless UI test with made-up data, at phone (390 px) and desktop widths, for each role.
Setup once:  python3 -m venv .venv-test && .venv-test/bin/pip install playwright && .venv-test/bin/python -m playwright install chromium
Run:         python3 tests/make_fixtures.py && .venv-test/bin/python tests/ui_test.py
             (make_fixtures.py writes made-up data to tests/fixtures/, gitignored)
Screenshots go to tests/out/. Exits non-zero on any JS error, sideways scroll or failed check."""
import base64
import http.server
import json
import sys
import threading
from functools import partial
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SITE, FIX, OUT = ROOT / "site", ROOT / "tests" / "fixtures", ROOT / "tests" / "out"
OUT.mkdir(exist_ok=True)
CONFIG = "window.APP_CONFIG={SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'x',TIME_ZONE:'America/Detroit',PAY_FIRST_END:'2026-11-08'};"
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
fails, errors = [], []


def check(ok, label):
    print(("PASS " if ok else "FAIL ") + label)
    if not ok:
        fails.append(label)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8125), partial(Quiet, directory=str(SITE)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:8125/"


def open_page(b, role, vp, logged_in):
    ctx = b.new_context(viewport=vp, device_scale_factor=2)
    p = ctx.new_page()
    tag = f"{role}-{vp['width']}"
    p.on("pageerror", lambda e: errors.append(f"{tag}: {e}"))
    p.on("console", lambda m: errors.append(f"{tag} console: {m.text}") if m.type == "error" else None)
    mock = (FIX / f"{role}.json").read_text()
    body = f"window.__FIX__={mock};window.__LOGGED_IN__={'true' if logged_in else 'false'};" + (ROOT / "tests" / "mock-supabase.js").read_text()
    p.route("**/supabase.min.js", lambda r: r.fulfill(content_type="text/javascript", body=body))
    p.route("**/config.js*", lambda r: r.fulfill(content_type="text/javascript", body=CONFIG))
    p.clock.install(time="2026-11-13T14:00:00Z")
    p.goto(BASE)
    p.wait_for_timeout(300)
    return ctx, p


def visit(p, route, name):
    p.evaluate(f"location.hash = '#/{route}'")
    p.wait_for_timeout(250)
    p.screenshot(path=str(OUT / f"{name}.png"), full_page=True)
    w = p.evaluate("document.documentElement.scrollWidth")
    vw = p.viewport_size["width"]
    check(w <= vw, f"{name}: no sideways scroll ({w} <= {vw})")


def writes(p, table):
    return p.evaluate(f"(window.__WRITES__||[]).filter(w => w.table === '{table}')")


with sync_playwright() as pw:
    b = pw.chromium.launch()
    for vp in ({"width": 390, "height": 844}, {"width": 1280, "height": 900}):
        W = vp["width"]
        # ---------------- Nick
        ctx, p = open_page(b, "nick", vp, logged_in=(W > 400))
        if W < 400:
            p.screenshot(path=str(OUT / "nick-390-login.png"))
            p.fill("input[name=email]", "nick@example.com"); p.fill("input[name=pw]", "x"); p.click("button[type=submit]")
            p.wait_for_timeout(400)
        visit(p, "", f"nick-{W}-today")
        check(p.locator(".tile").count() == 5, f"nick {W}: five tiles on Today")
        check(p.locator("text=CampLife").count() > 0, f"nick {W}: CampLife card")
        check(p.locator("text=Advance deposits").count() == 0, f"nick {W}: no CampLife balances")
        p.click("[data-tile=sales]"); p.wait_for_timeout(150)
        check(p.locator("text=Last 30 days").count() > 0, f"nick {W}: sales drill opens")
        p.click("[data-tile=cash]"); p.wait_for_timeout(150)
        check(p.locator("text=Over/short, 30 days").count() > 0, f"nick {W}: cash drill opens")
        p.screenshot(path=str(OUT / f"nick-{W}-today-drill.png"), full_page=True)
        p.click("[data-close-item=drawer]"); p.wait_for_timeout(200)
        check(len(writes(p, "daily_close")) == 1, f"nick {W}: close step saves")
        p.fill("#addTask input[name=title]", "Test task"); p.click("#addTask button"); p.wait_for_timeout(200)
        check(any(w["payload"].get("who") == "nick" for w in writes(p, "tasks")), f"nick {W}: task added as his own")
        visit(p, "timecards", f"nick-{W}-timecards")
        check(p.locator("[data-fix]").count() >= 1, f"nick {W}: odd card offers Fix")
        p.locator("[data-fix]").first.click(); p.wait_for_timeout(150)
        p.fill("[data-fixform] input[name=note]", "left at 8:30"); p.click("[data-fixform] button[type=submit]"); p.wait_for_timeout(250)
        check(len(writes(p, "timecard_fixes")) == 1, f"nick {W}: fix request saved")
        p.click("[data-sbuild]"); p.wait_for_timeout(250)
        sw = writes(p, "schedule_weeks")
        check(len(sw) == 1 and len(sw[0]["payload"]["shifts"]) > 0, f"nick {W}: schedule drafted from last week")
        p.screenshot(path=str(OUT / f"nick-{W}-schedule.png"), full_page=True)
        p.click("[data-sstatus=ready]"); p.wait_for_timeout(200)
        check(writes(p, "schedule_weeks")[-1]["payload"]["status"] == "ready", f"nick {W}: schedule marked ready")
        visit(p, "payroll", f"nick-{W}-payroll")
        p.fill("#payForm input[name=hours]", "31.5"); p.fill("#payForm input[name=pieces]", "42")
        p.set_input_files("#payForm input[name=photo]", files=[{"name": "board.png", "mimeType": "image/png", "buffer": PNG}]); p.wait_for_timeout(500)
        p.check("#payForm input[name=erased]"); p.click("#payForm button[type=submit]"); p.wait_for_timeout(300)
        pw_ = writes(p, "payroll_asks")
        check(len(pw_) == 1 and pw_[0]["payload"]["angel_hours"] == 31.5 and pw_[0]["payload"]["photo_path"], f"nick {W}: payroll ask sent with photo")
        check(not any(k in json.dumps(pw_) for k in ("rate", "amount", "gross")), f"nick {W}: payroll ask holds no pay")
        p.screenshot(path=str(OUT / f"nick-{W}-payroll-sent.png"), full_page=True)
        visit(p, "charges", f"nick-{W}-charges")
        check(p.locator(".crow").count() > 0, f"nick {W}: charges listed")
        p.click("[data-tab=open]"); p.wait_for_timeout(150)
        row = p.locator(".crow [data-ok]").first
        rid = row.get_attribute("data-ok")
        p.select_option(f"select[data-f=account][data-id='{rid}']", "Food Purchases"); p.wait_for_timeout(150)
        p.select_option(f"select[data-f=cls][data-id='{rid}']", "Restaurant & Bar"); p.wait_for_timeout(150)
        p.click(f"[data-ok='{rid}']"); p.wait_for_timeout(250)
        aw = writes(p, "charge_answers")
        check(any(w["payload"].get("status") == "ok" and w["payload"].get("who") == "nick" for w in aw), f"nick {W}: charge approved as nick")
        visit(p, "performance", f"nick-{W}-performance")
        check(p.locator("text=Sales by tax line").count() > 0, f"nick {W}: performance tax lines")
        check(p.locator("text=CampLife payments").count() == 0 and p.locator("td:text-is('Tips')").count() == 0, f"nick {W}: no CampLife or tips lines")
        p.click("[data-range=year]"); p.wait_for_timeout(200)
        p.locator("[data-line]").first.click(); p.wait_for_timeout(150)
        p.locator("[data-cat]").first.click(); p.wait_for_timeout(150)
        check(p.locator("text=items,").count() > 0, f"nick {W}: drill to items")
        p.screenshot(path=str(OUT / f"nick-{W}-performance-items.png"), full_page=True)
        visit(p, "golf", f"nick-{W}-golf")
        visit(p, "cards", f"nick-{W}-cards-redirect")
        check(p.locator("h1:text-is('Today'), h1").first.inner_text() != "Cards review", f"nick {W}: Cards review not offered")
        visit(p, "more", f"nick-{W}-more")
        ctx.close()
        # ---------------- Pete
        ctx, p = open_page(b, "pete", vp, logged_in=True)
        visit(p, "", f"pete-{W}-charges")
        check(p.locator("h1").first.inner_text() == "Card charges", f"pete {W}: lands on Charges")
        check(p.locator(".tabbar a, .topnav a").count() > 0, f"pete {W}: nav shown")
        visit(p, "today", f"pete-{W}-today-redirect")
        check(p.locator("h1").first.inner_text() == "Card charges", f"pete {W}: Today not offered")
        visit(p, "golf", f"pete-{W}-golf")
        check(p.locator("text=Golf course spend").count() > 0, f"pete {W}: golf spend")
        ctx.close()
        # ---------------- Kevin
        ctx, p = open_page(b, "kevin", vp, logged_in=True)
        visit(p, "", f"kevin-{W}-home")
        check(p.locator(".tile").count() == 6, f"kevin {W}: six tiles on Home")
        check(p.locator("text=Monday brief").count() > 0, f"kevin {W}: brief on Home")
        check(p.locator("text=waiting on Nick").count() > 0, f"kevin {W}: payroll status shows waiting")
        visit(p, "today", f"kevin-{W}-desk")
        visit(p, "cards", f"kevin-{W}-cards")
        check(p.locator("text=Card alerts").count() > 0, f"kevin {W}: card alerts")
        p.click("[data-tab=all]"); p.wait_for_timeout(200)
        hand = p.locator("select[data-hand]").first
        hid = hand.get_attribute("data-hand"); hand.select_option("nick"); p.wait_for_timeout(250)
        check(any(w["payload"].get("handed_to") == "nick" for w in writes(p, "charges")), f"kevin {W}: hands a charge to Nick")
        p.click("[data-holder=nick]"); p.wait_for_timeout(200)
        p.screenshot(path=str(OUT / f"kevin-{W}-cards-nick.png"), full_page=True)
        visit(p, "timecards", f"kevin-{W}-timecards")
        p.locator("[data-fixset=applied]").first.click(); p.wait_for_timeout(250)
        check(any(w["payload"].get("status") == "applied" for w in writes(p, "timecard_fixes")), f"kevin {W}: marks a fix done in Square")
        visit(p, "performance", f"kevin-{W}-performance")
        check(p.locator("text=Not sales").count() > 0, f"kevin {W}: CampLife and tips shown as not sales")
        visit(p, "payroll", f"kevin-{W}-payroll")
        visit(p, "golf", f"kevin-{W}-golf")
        visit(p, "backup", f"kevin-{W}-backup")
        visit(p, "more", f"kevin-{W}-more")
        p.click("[data-theme-pick=dark]"); p.wait_for_timeout(150)
        visit(p, "", f"kevin-{W}-home-dark")
        ctx.close()
    b.close()
srv.shutdown()
print("errors:", errors)
print(f"{len(fails)} failed")
sys.exit(1 if fails or errors else 0)
