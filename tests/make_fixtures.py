"""Made-up data for the UI test: one JSON file per role in tests/fixtures/, filtered the way
the database rules filter it (the real rules are tested in rls-test.sql). Nothing here comes
from real files; every name and amount is invented.  python3 tests/make_fixtures.py"""
import json
import random
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

TODAY = date(2026, 11, 13)          # a Friday: the payroll ask for the period ending Nov 8 is open
NOW = datetime(2026, 11, 13, 14, 0, tzinfo=timezone.utc).isoformat()
rnd = random.Random(7)
OUT = Path(__file__).parent / "fixtures"
IDS = {"kevin": "11111111-1111-1111-1111-111111111111", "nick": "22222222-2222-2222-2222-222222222222", "pete": "33333333-3333-3333-3333-333333333333"}
HIDDEN = {"Cabin", "Campground Fee", "Kitchen Tips"}
d = lambda n: (TODAY + timedelta(days=n)).isoformat()

CATS = [("Food, Burgers", "Food", "income", 400), ("Food, Entrees", "Food", "income", 300), ("Beer & Wine", "Beer & Liquor", "income", 250),
        ("Liquor", "Beer & Liquor", "income", 180), ("Merchandise", "Store taxable", "income", 60), ("Grocery", "Grocery", "income", 40),
        ("Fuel", "Gasoline", "income", 90), ("Cabin", "Cabins", "camplife", 120), ("Campground Fee", "Campground", "camplife", 80),
        ("Kitchen Tips", "Tips", "tips", 30), ("Gift Card", "Gift cards", "gift_card", 10)]
db = {"members": [{"user_id": IDS[r], "display_name": r.title(), "role": r} for r in IDS]}
db["sales_categories"] = [{"category": c, "line": l, "treatment": t, "sort": i} for i, (c, l, t, _) in enumerate(CATS)]
sales = []
for n in range(1, 760):
    day = TODAY - timedelta(days=n)
    season = 1.8 if 5 <= day.month <= 9 else 0.8
    weekend = 1.4 if day.weekday() >= 4 else 1.0
    for c, l, t, base in CATS:
        if rnd.random() < 0.15 and t != "income":
            continue
        sales.append({"day": day.isoformat(), "location": "Jack Pine Lodge", "category": c, "net_sales": round(base * season * weekend * rnd.uniform(.6, 1.3), 2), "as_of": NOW})
db["sales_daily"] = sales
items = {"Food, Burgers": ["Pine Burger", "Cheeseburger", "Kids Burger"], "Food, Entrees": ["Walleye Dinner", "Pasty"], "Beer & Wine": ["Draft", "House Red"],
         "Liquor": ["Old Fashioned", "Well Drink"], "Merchandise": ["T-shirt", "Hat"], "Grocery": ["Ice", "Milk"], "Fuel": ["Unleaded"],
         "Cabin": ["Cabin rent"], "Campground Fee": ["Site fee"], "Kitchen Tips": ["Tip"], "Gift Card": [""]}
months = sorted({s["day"][:7] for s in sales})
db["sales_items_monthly"] = [{"month": m, "location": "Jack Pine Lodge", "category": c, "item": it, "net_sales": round(rnd.uniform(200, 4000), 2), "as_of": NOW}
                             for m in months for c, its in items.items() for it in its]
PEOPLE = [("tmA", "Alex Rivers", "Server"), ("tmB", "Bo Pines", "Cook"), ("tmC", "Cam Lake", "Bartender"), ("tmD", "Dee Fern", "Dishwasher"),
          ("tmE", "Eli Stone", "Cook"), ("tmF", "Fay Birch", "Server")]
cards = []
for n in range(0, 15):
    day = TODAY - timedelta(days=n)
    for tm, name, job in PEOPLE:
        if rnd.random() < 0.3:
            continue
        start = datetime(day.year, day.month, day.day, rnd.choice([10, 11, 15, 16]), rnd.choice([0, 15, 30, 45]))
        h = round(rnd.uniform(5, 9), 2)
        out = start + timedelta(hours=h)
        cards.append({"shift_id": f"s{n}{tm}", "tm": tm, "name": name, "job": job, "in_at": start.isoformat(), "out_at": out.isoformat() if n else None,
                      "hours": h if n else None, "auto": False, "flag": None, "flag_text": None, "as_of": NOW})
cards = [c for c in cards if c["out_at"] or c["in_at"][:10] == TODAY.isoformat()]
cards[5].update(auto=True, hours=24.0, out_at=(datetime.fromisoformat(cards[5]["in_at"]) + timedelta(hours=24)).isoformat(), flag="auto_clock_out")
cards[9].update(hours=15.2, out_at=(datetime.fromisoformat(cards[9]["in_at"]) + timedelta(hours=15.2)).isoformat(), flag="long_shift")
db["timecards"] = cards
db["drawer_shifts"] = [{"id": f"d{n}", "date": d(-n), "state": "CLOSED", "closed_by": rnd.choice(["Alex Rivers", "Cam Lake"]), "start_cash": 200,
                        "cash_in": round(rnd.uniform(150, 600), 2), "paid_in": 0, "paid_out": round(rnd.uniform(0, 60), 2), "expected": 500, "counted": 500 + (12.5 if n == 1 else 0),
                        "over_short": 12.5 if n == 1 else 0, "as_of": NOW} for n in range(1, 32)]
db["payroll_hours"] = [{"payslip_id": f"p{k}{tm}", "pay_type": "Hourly", "employee": name, "pay_date": d(-14 * k + 5), "period_begin": d(-14 * k - 18),
                        "period_end": d(-14 * k - 5), "hours": round(rnd.uniform(40, 80), 2), "as_of": NOW} for k in range(0, 14) for tm, name, _ in PEOPLE]
db["camplife_days"] = [{"date": TODAY.isoformat(), "arrivals": [{"name": "Guest One", "site": "12", "nights": 2, "balance": 0}, {"name": "Guest Two", "site": "C3", "nights": 1, "balance": 45.5}],
                        "departures": [{"name": "Guest Three", "site": "7", "balance": 0}], "owing": [{"name": "Guest Two", "site": "C3", "amount": 45.5}], "note": "All six reports in.", "as_of": NOW}]
db["camplife_balances"] = [{"date": TODAY.isoformat(), "advance_deposit_balance": 12345.67, "future_reservation_total": 23456.78, "future_reservation_balance": 11111.11, "as_of": NOW}]
db["golf_spend"] = [{"month": f"2026-{m:02d}", "measure": ms, "label": lb, "amount": round(rnd.uniform(500, 6000), 2), "items": rnd.randint(2, 20), "as_of": NOW}
                    for m in range(1, 12) for ms, lb in (("golf_uncoded", "Golf spend uncoded in the bank feed"), ("golf_to_expense", "Of which proposed to expense accounts"))]
db["attention_items"] = [{"audience": "kevin", "key": "cards-duplicates", "label": "possible double charges", "count": 2, "level": "crit", "link": "quickbooks", "as_of": NOW},
                         {"audience": "kevin", "key": "cards-held", "label": "charges held for you", "count": 3, "level": "warn", "link": "feed", "as_of": NOW},
                         {"audience": "nick", "key": "cards-held", "label": "of your charges held for Kevin", "count": 2, "level": "warn", "link": "charges", "as_of": NOW}]
mon = (TODAY - timedelta(days=TODAY.weekday() + 7)).isoformat()
by_day = [{"day": (date.fromisoformat(mon) + timedelta(days=i)).isoformat(), "net_sales": round(rnd.uniform(500, 1800), 2)} for i in range(7)]
sales_obj = {"this_week": round(sum(x["net_sales"] for x in by_day), 2), "last_week": 6100.0, "same_week_last_year": 5900.0, "by_day": by_day}
db["briefs"] = [{"week_start": mon, "audience": "kevin", "written_at": NOW, "data": {"week_start": mon, "week_end": (date.fromisoformat(mon) + timedelta(days=6)).isoformat(),
                 "summary": "Sales up on last year. Labor steady. Three decisions wait.", "sales": sales_obj, "labor": {"hours": 312.5, "flags": ["Bo Pines over 40 h"]},
                 "cash": {"checking": 45678.9, "cash_drawer": 812.0, "square_clearing": 120.5, "undeposited_funds": 0}, "bank_items_waiting": 41,
                 "bills_due": {"count": 3, "total": 1890.0}, "decisions_waiting": 3, "off_pattern": ["Saturday 45% above its 4-week average"],
                 "close": {"month": "October 2026", "done": 5, "total": 9, "next": "CampLife revenue"}, "source_notes": ["Made-up test brief."]}},
                {"week_start": mon, "audience": "gm", "written_at": NOW, "data": {"week_start": mon, "summary": "Sales up on last year. Labor steady.", "sales": sales_obj,
                 "labor": {"hours": 312.5, "flags": ["Bo Pines over 40 h"]}, "off_pattern": ["Saturday 45% above its 4-week average"]}}]
db["kevin_docs"] = [{"key": "tiles", "at": NOW, "data": {"checking": 45678.9, "bank": 52345.12, "cash_drawer": 812.0, "square_clearing": 120.5, "undeposited": 0}},
                    {"key": "alerts", "at": NOW, "data": {"duplicates": [{"qbo": "901", "date": d(-9), "amount": 54.12, "desc": "HARDWARE STORE", "account": "Repairs and Maintenance", "coded": "yes", "candidates": []}],
                                                          "ambiguous": [{"qbo": "902", "date": d(-6), "amount": 19.99, "desc": "ONLINE ORDER", "account": "", "coded": "", "candidates": []}]}},
                    {"key": "statements", "at": NOW, "data": {"Card 1111 Oct": {"card": "Card ending 1111", "through": "2026-10-31", "status": "ok", "ok": True}}},
                    {"key": "jobs", "at": NOW, "data": {"jack-pine-timecards-check": {"task": "jack-pine-timecards-check", "name": "Morning refresh (6:15)", "ok": True, "finished": NOW}}}]
ACCTS = ["Food Purchases", "Bar Purchases", "Restaurant Supplies", "Merchandise & Grocery -COGS", "Gasoline Purchases", "Repairs and Maintenance", "Office Supplies",
         "Automobile Expense", "Advertising and Promotion", "Meals and Entertainment", "Travel Expense", "Telephone Expense", "Personal Property",
         "Construction in Progress - Golf Course", "Uncategorized - To Be Coded", "Utilities", "Insurance Expense"]
db["app_lists"] = [{"key": "accounts", "data": ACCTS, "at": NOW}, {"key": "vehicles", "data": ["Truck A", "Truck B", "Car C"], "at": NOW},
                   {"key": "settings", "data": {"cap_threshold_cents": 50000}, "at": NOW}]
VENDORS = ["HARDWARE STORE", "FOOD SUPPLIER", "GAS STATION", "OFFICE SHOP", "ONLINE ORDER", "BOAT PARTS", "SEED AND SOD", "DINER"]
charges = []
holders = [("nick", "1021"), ("pete", "1047"), ("kevin", "1005"), ("janet", "1834"), (None, "")]
for i in range(140):
    h, card = holders[i % 5]
    act = rnd.choice(["POST"] * 6 + ["ASK", "AMAZON", "TRANSFER", "MATCH"])
    c = {"id": f"c{i:03d}", "src": "Card " + card if card else rnd.choice(["Checking", "Shared Store"]), "card": card, "holder": h, "handed_to": None, "handoff_at": None,
         "date": d(-rnd.randint(1, 90)), "descr": rnd.choice(VENDORS) + f" #{i}", "payee": "", "suggest": "", "amt_cents": -rnd.randint(500, 90000), "action": act,
         "account": rnd.choice(ACCTS[:8] + [""]), "cls": rnd.choice(["Restaurant & Bar", "Cabins", "Jackpine9", ""]), "golf": False, "conf": rnd.randint(1, 3),
         "question": "What was this for?" if act == "ASK" else None, "tool_note": "Usually supplies" if i % 7 == 0 else None, "qbo": f"7{i}" if i % 9 == 0 else None,
         "qbo_coding": "Repairs and Maintenance [Overhead]" if i % 9 == 0 else None, "posted_at": NOW if i % 11 == 0 else None,
         "held_text": "Kevin is reviewing this one" if i % 13 == 0 else None, "holder_answer": None, "active": True, "as_of": NOW, "updated_at": NOW, "updated_by": None}
    charges.append(c)
charges[2]["handed_to"] = "nick"; charges[7]["handed_to"] = "pete"; charges[12]["handed_to"] = "nick"
charges += [{"id": f"p-{i}", "src": "Card 1021" if i % 2 else "Card 1047", "card": "1021" if i % 2 else "1047", "holder": "nick" if i % 2 else "pete", "handed_to": None,
             "date": d(-rnd.randint(100, 300)), "descr": rnd.choice(VENDORS), "amt_cents": -rnd.randint(500, 20000), "action": "POSTED", "account": "Food Purchases",
             "cls": "Restaurant & Bar", "golf": False, "posted_at": NOW, "active": True, "as_of": NOW} for i in range(20)]
db["charges"] = charges
db["charge_kevin"] = [{"charge_id": c["id"], "held_reason": "differs from Kevin's earlier pick", "kevin_answer": None, "as_of": NOW} for c in charges[:40] if c.get("held_text")]
db["charge_answers"] = [{"charge_id": "c000", "who": "nick", "status": "ok", "account": "Food Purchases", "cls": "Restaurant & Bar", "golf": False, "note": "", "vehicle": None, "updated_at": NOW, "updated_by": IDS["nick"]},
                        {"charge_id": "c002", "who": "kevin", "status": "edited", "account": "Office Supplies", "cls": "Overhead", "golf": False, "note": "", "vehicle": None, "updated_at": NOW, "updated_by": IDS["kevin"]}]
db["charge_setup_notes"] = [{"key": "extra", "text": "Made-up setup note.", "updated_at": NOW}]
db["timecard_fixes"] = [{"id": "f0000000-0000-4000-a000-000000000001", "shift_id": cards[5]["shift_id"], "tm": cards[5]["tm"], "name": cards[5]["name"], "in_at": cards[5]["in_at"],
                         "out_old": cards[5]["out_at"], "out_new": cards[5]["in_at"][:10] + "T20:30:00", "hours_old": 24, "status": "pending", "note": "", "created_by": IDS["nick"], "created_at": NOW}]
db["schedule_weeks"] = []
db["payroll_asks"] = []
db["daily_close"] = []
db["tasks"] = [{"id": "t1", "title": "Order propane", "detail": "", "status": "open", "link": "", "who": "nick", "source": "app", "created": NOW, "done_at": None},
               {"id": "t2", "title": "Fix the dock light", "detail": "before Friday", "status": "done", "link": "", "who": "nick", "source": "launch pad", "created": NOW, "done_at": NOW},
               {"id": "t3", "title": "Call the insurance agent", "detail": "", "status": "open", "link": "", "who": "kevin", "source": "app", "created": NOW, "done_at": None}]
db["feed_runs"] = [{"id": 2, "at": NOW, "kind": "push", "ok": True, "summary": "made-up run"}]


def can_see_charge(c, role):
    return c["action"] in ("POST", "ASK", "AMAZON", "POSTED") and (c["holder"] == role or c.get("handed_to") == role)


def for_role(role):
    if role == "kevin":
        return db
    out = {k: [] for k in db}
    out["members"] = [m for m in db["members"] if m["role"] == role]
    out["charges"] = [c for c in db["charges"] if can_see_charge(c, role)]
    seen = {c["id"] for c in out["charges"]}
    out["charge_answers"] = [a for a in db["charge_answers"] if a["who"] == role and a["charge_id"] in seen]
    out["golf_spend"] = db["golf_spend"]
    out["app_lists"] = db["app_lists"]
    if role == "nick":
        for k in ("drawer_shifts", "timecards", "payroll_hours", "camplife_days", "timecard_fixes", "schedule_weeks", "payroll_asks", "daily_close"):
            out[k] = db[k]
        for k in ("sales_daily", "sales_items_monthly", "sales_categories"):
            out[k] = [r for r in db[k] if r["category"] not in HIDDEN]
        out["attention_items"] = [a for a in db["attention_items"] if a["audience"] == "nick"]
        out["briefs"] = [b for b in db["briefs"] if b["audience"] == "gm"]
        out["tasks"] = [t for t in db["tasks"] if t["who"] == "nick"]
    return out


OUT.mkdir(exist_ok=True)
for role in IDS:
    (OUT / f"{role}.json").write_text(json.dumps({"me": IDS[role], "today": TODAY.isoformat(), "db": for_role(role)}, separators=(",", ":")))
print("fixtures:", ", ".join(f"{r} {sum(len(v) for v in for_role(r).values())} rows" for r in IDS))
