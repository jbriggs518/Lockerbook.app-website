#!/usr/bin/env python3
"""Builds the lockerbook.app static site (D-038).

    pip3 install markdown pillow      # pillow is optional (only for real app screenshots)
    python3 website/build.py

Pages: home, press, support, help (from docs/user-manual), privacy + terms (from docs/legal).
Output goes to website/ (committed; publish.sh copies it to the public GitHub Pages repo).

Real app screenshots: if marketing/app-store/screenshots/raw/iphone-6.9/NN-<screen>.png exist,
the feature showcase uses them; otherwise it shows the built-in illustrations.
"""
from __future__ import annotations

import html
import re
import shutil
from pathlib import Path

import markdown

SITE = Path(__file__).resolve().parent
ROOT = SITE.parent
MANUAL = ROOT / "docs" / "user-manual"
LEGAL = ROOT / "docs" / "legal"
RAW_SHOTS = ROOT / "marketing" / "app-store" / "screenshots" / "raw" / "iphone-6.9"
BRAND_SRC = ROOT / "marketing" / "brand" / "maxpreps"
EMAIL = "contact@lockerbook.app"
YEAR = 2026

# Flip to True only after MaxPreps' written permission (Xport Enabled agreement accepted). Same rule as
# AppConfig.maxPrepsLogosLicensed in the app. When False the site shows the name as text only.
MAXPREPS_LOGOS = False

NAV = [
    ("Sports", "/#sports"), ("Features", "/#features"), ("MaxPreps", "/#maxpreps"),
    ("Privacy", "/#privacy"), ("Pricing", "/#pricing"), ("FAQ", "/#faq"), ("Help", "/help/"),
]

E = html.escape

# (name, status, summary) — keep in sync with SportCatalog (docs/internal/15-sport-modules.md).
SPORTS = [
    ("Soccer", "available", "Goals, assists, shots, saves, cards, subs and minutes with a live clock."),
    ("Baseball", "preview", "Plate appearances, runs, RBIs, steals, pitching lines and fielding."),
    ("Softball", "preview", "Plate appearances, runs, RBIs, steals, pitching lines and fielding."),
    ("Basketball", "preview", "Makes and misses by type, rebounds, assists, steals, blocks, turnovers."),
    ("Football", "preview", "Scoring plays, rushing, passing and receiving yards, defense, punting."),
    ("Volleyball", "preview", "Rally scoring by set with kills, aces, blocks, digs and errors."),
    ("Lacrosse", "preview", "Goals, assists, ground balls, faceoffs, draw controls and saves."),
    ("Ice Hockey", "preview", "Goals, assists, shots, power-play goals, faceoffs, PIM and saves."),
    ("Field Hockey", "preview", "Goals, assists, shots, penalty corners, cards and saves."),
    ("Wrestling", "preview", "Dual-meet team score by bout result, plus takedowns and escapes."),
    ("Tennis", "preview", "Dual-match score by line with singles and doubles records."),
    ("Bowling", "preview", "Pinfall per bowler per game, Baker totals, strikes and spares."),
    ("Track & Field", "soon", "Events, marks and places for dual and invitational meets."),
    ("Cross Country", "soon", "Finish order, times and team scoring."),
    ("Swimming & Diving", "soon", "Events, times and places for swim and dive meets."),
]
STATUS_LABEL = {"available": "Available", "preview": "Preview", "soon": "Coming soon"}
MAXPREPS_SPORTS = {"Soccer", "Baseball", "Softball", "Basketball", "Football", "Volleyball",
                   "Lacrosse", "Ice Hockey", "Field Hockey"}

FAQ = [
    ("Which sports can I score?",
     "Fifteen. Soccer has the complete scoring screen. Baseball, softball, basketball, football, volleyball, "
     "lacrosse, ice hockey, field hockey, wrestling, tennis and bowling use the stat-sheet scorekeeper (preview). "
     "Track & field, cross country and swimming & diving are coming soon."),
    ("Is it only for high schools?",
     "No. School (varsity, JV, freshman), college and club/travel teams all use Lockerbook, with game formats for each level. "
     "MaxPreps tools appear for high school teams, because MaxPreps covers U.S. high schools."),
    ("How does the MaxPreps upload work?",
     "Answer “yes” when Lockerbook asks if your team posts to MaxPreps. After a game, Lockerbook makes the MaxPreps stats file. "
     "Open the game on MaxPreps, choose Enter Stats, and import the file. It has jersey numbers and stats, not names. "
     "MaxPreps doesn't offer automatic syncing to partner apps, so this one upload is the fastest path."),
    ("Which sports have a MaxPreps stats file?",
     "Soccer today. Baseball, softball, basketball, football, volleyball, lacrosse, ice hockey and field hockey turn on as "
     "each sport's field list is confirmed with MaxPreps. Until then, Lockerbook gives you an entry sheet in MaxPreps' order."),
    ("Do I need an account?",
     "No. There's nothing to sign up for. Your teams, rosters and games live on your iPhone or iPad."),
    ("What does Lockerbook know about my players?",
     "Only what a scorebook needs: name, jersey number, position and graduation year. It never asks for contact "
     "information, birthdays or photos, and it has no ad networks, trackers or analytics."),
    ("Can two people keep stats at the same time?",
     "Not yet. One scorekeeper enters the game. Staff syncing and live viewing for families are next on the roadmap."),
    ("Does it work without internet?",
     "Yes. Scoring, box scores and exports all work offline."),
    ("What does it cost?",
     "Lockerbook is free during the beta. At launch we'll offer one-sport, all-sports and school/club plans."),
    ("Is there an Android version?",
     "Not right now. Lockerbook is built for iPhone and iPad."),
]


# MARK: - Page shell

def page(title: str, description: str, body: str, current: str = "", body_class: str = "") -> str:
    nav = "".join(
        f'<a href="{href}"{" aria-current=" + chr(34) + "page" + chr(34) if href == current else ""}>{label}</a>'
        for label, href in NAV
    )
    full_title = "Lockerbook — The scorebook for every sport" if title == "Lockerbook" else f"{title} · Lockerbook"
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{E(full_title)}</title>
<meta name="description" content="{E(description)}">
<meta name="theme-color" content="#070d19">
<meta property="og:type" content="website">
<meta property="og:title" content="{E(full_title)}">
<meta property="og:description" content="{E(description)}">
<meta property="og:image" content="https://lockerbook.app/assets/icon-512.png">
<link rel="icon" href="/assets/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="stylesheet" href="/assets/style.css">
<script src="/assets/site.js" defer></script>
</head>
<body class="{body_class}">
<a class="skip" href="#main">Skip to content</a>
<header class="topbar">
  <div class="wrap bar">
    <a class="brand" href="/"><img src="/assets/favicon-32.png" alt="" width="28" height="28"><span>Lockerbook</span></a>
    <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>
    <nav id="site-nav" class="nav" aria-label="Main">{nav}<a class="nav-cta" href="mailto:{EMAIL}?subject=Lockerbook%20beta">Join the beta</a></nav>
  </div>
</header>
<main id="main">
{body}
</main>
<footer class="footer">
  <div class="wrap footer-grid">
    <div>
      <a class="brand" href="/"><img src="/assets/favicon-32.png" alt="" width="28" height="28"><span>Lockerbook</span></a>
      <p class="muted">The scorebook for every sport. School, college, club &amp; travel.</p>
    </div>
    <nav aria-label="App">
      <h2>App</h2>
      <a href="/#sports">Sports</a><a href="/#features">Features</a><a href="/#maxpreps">MaxPreps</a><a href="/#pricing">Pricing</a>
    </nav>
    <nav aria-label="Help">
      <h2>Help</h2>
      <a href="/help/">User guide</a><a href="/support/">Support</a><a href="mailto:{EMAIL}?subject=Lockerbook%20bug%20report">Report a bug</a><a href="/press/">Press</a>
    </nav>
    <nav aria-label="Legal">
      <h2>Legal</h2>
      <a href="/privacy/">Privacy Policy</a><a href="/terms/">Terms of Use</a><a href="mailto:{EMAIL}">{EMAIL}</a>
    </nav>
  </div>
  <div class="wrap fineprint">
    <span>© {YEAR} Vermonster's Pro Shop</span>
    <span>MaxPreps is a trademark of its owner. Lockerbook is not affiliated with or endorsed by MaxPreps. iPhone and iPad are trademarks of Apple Inc.</span>
  </div>
</footer>
</body>
</html>
"""


def md(text: str) -> str:
    # GitHub renders a list right after a paragraph line; Python-Markdown needs a blank line first.
    item = re.compile(r"^\s*(?:[-*+]|\d+\.)\s")
    out: list = []
    for line in text.splitlines():
        if item.match(line) and out and out[-1].strip() and not item.match(out[-1]) \
                and not out[-1].startswith((" ", "\t")):
            out.append("")
        out.append(line)
    return markdown.markdown("\n".join(out), extensions=["tables", "toc", "sane_lists"])


def write(rel: str, content: str) -> None:
    path = SITE / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    print("wrote", path.relative_to(ROOT))


def first_heading(text: str) -> str:
    m = re.search(r"^#\s+(.+)$", text, re.M)
    return m.group(1).strip() if m else "Lockerbook"


def maxpreps_mark(cls: str = "mp-mark") -> str:
    if MAXPREPS_LOGOS:
        return f'<img class="{cls}" src="/assets/brand/maxpreps-logo.png" alt="MaxPreps" height="40">'
    return f'<span class="{cls} mp-text">MaxPreps</span>'


def sync_brand_assets() -> None:
    dest = SITE / "assets" / "brand"
    if MAXPREPS_LOGOS and BRAND_SRC.exists():
        dest.mkdir(parents=True, exist_ok=True)
        for f in BRAND_SRC.glob("*.png"):
            shutil.copy2(f, dest / f.name)
    elif dest.exists():
        shutil.rmtree(dest)


# MARK: - Illustrations (used until real screenshots exist)

def phone(inner: str, label: str) -> str:
    return f'<div class="phone" role="img" aria-label="{E(label)}"><div class="screen">{inner}</div></div>'


def mock_scoring() -> str:
    buttons = ["Goal", "Shot Saved", "Shot Off Target", "Corner", "Steal", "Foul", "Yellow", "Sub", "Change GK"]
    grid = "".join(f'<span class="k{" k-score" if b == "Goal" else ""}">{b}</span>' for b in buttons)
    plays = [("58:12", "Shot: Hit Post/Bar – #7 S. Delacroix"), ("56:30", "Yellow card – Cedar Falls #5"),
             ("44:30", "<b>GOAL – #10 L. Ferreira (PK)</b>"), ("22:15", "<b>GOAL – Cedar Falls #14, assist #8</b>")]
    log = "".join(f'<li><time>{t}</time>{p}</li>' for t, p in plays)
    return phone(f"""
<div class="m-title">vs Cedar Falls</div>
<div class="m-board"><div><strong>2</strong><small>Harbor Point</small></div><em>–</em><div><strong>1</strong><small>Cedar Falls</small></div></div>
<div class="m-clock">2nd Half · 21:48</div>
<div class="m-label">Harbor Point</div>
<div class="m-keys">{grid}</div>
<div class="m-label">Play-by-play</div>
<ul class="m-log">{log}</ul>""", "Soccer scoring screen with scoreboard, buttons and play-by-play")


def mock_boxscore() -> str:
    rows = [("1", "M. Lindqvist", "0", "0", "0", "0"), ("7", "S. Delacroix", "1", "1", "3", "2"),
            ("9", "E. Hollis", "1", "1", "2", "2"), ("10", "L. Ferreira", "0", "0", "2", "1"),
            ("12", "G. Tanaka", "1", "0", "1", "1"), ("13", "I. Morgan", "0", "0", "0", "0")]
    body = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return phone(f"""
<div class="m-title">Box Score</div>
<div class="m-board small"><div><strong>3</strong><small>Harbor Point</small></div><em>–</em><div><strong>1</strong><small>North Summit</small></div></div>
<div class="m-label">Players</div>
<table class="m-table"><thead><tr><th>#</th><th>Player</th><th>G</th><th>A</th><th>SH</th><th>SOG</th></tr></thead><tbody>{body}</tbody></table>
<div class="m-label">Goalkeepers</div>
<table class="m-table"><thead><tr><th>#</th><th>Keeper</th><th>MIN</th><th>SV</th><th>GA</th><th>DEC</th></tr></thead>
<tbody><tr><td>1</td><td>M. Lindqvist</td><td>45</td><td>1</td><td>0</td><td>W</td></tr><tr><td>00</td><td>T. Okafor</td><td>35</td><td>2</td><td>1</td><td>–</td></tr></tbody></table>""",
                 "Box score with player and goalkeeper tables")


def mock_maxpreps() -> str:
    file_lines = ["Jersey|Goals|Assists|Shots|ShotsOnGoal|…", "7|1|1|3|2|…", "9|1|1|2|2|…", "12|1|0|1|1|…"]
    pre = "\n".join(file_lines)
    return phone(f"""
<div class="m-title">MaxPreps &amp; Export</div>
<div class="m-mp">{maxpreps_mark("m-mp-mark")}<b>Your stats, ready for MaxPreps</b><small>Share the file, then import it under the game's Enter Stats.</small></div>
<div class="m-row">⬆︎ Share MaxPreps Stats File</div>
<pre class="m-file">{E(pre)}</pre>
<div class="m-note">Jersey numbers and stats only. No names.</div>
<div class="m-row">⎙ Share / Print Entry Sheet</div>
<div class="m-row">▦ Share Box Score (CSV)</div>""", "MaxPreps export screen with the stats file preview")


def mock_basketball() -> str:
    groups = [("Shooting", ["2PT Made", "2PT Miss", "3PT Made", "3PT Miss", "FT Made", "FT Miss"]),
              ("Hustle", ["Off. Rebound", "Def. Rebound", "Assist", "Steal", "Block", "Charge Taken"])]
    html_groups = ""
    for title, keys in groups:
        keys_html = "".join(f'<span class="k{" k-score" if "Made" in k else ""}">{k}</span>' for k in keys)
        html_groups += f'<div class="m-label">{title}</div><div class="m-keys">{keys_html}</div>'
    return phone(f"""
<div class="m-title">vs Cedar Falls · Basketball</div>
<div class="m-board"><div><strong>41</strong><small>Harbor Point</small></div><em>–</em><div><strong>36</strong><small>Cedar Falls</small></div></div>
<div class="m-clock">Q3 · 3:50</div>
{html_groups}
<div class="m-label">Cedar Falls</div>
<div class="m-keys"><span class="k k-opp">+1 Free Throw</span><span class="k k-opp">+2 Basket</span><span class="k k-opp">+3 Basket</span></div>""",
                 "Basketball stat sheet with shooting and hustle buttons")


def mock_team() -> str:
    games = [("Fri, Sep 18 · 6:00 PM", "vs Ridgeview", "Home"), ("Tue, Sep 22 · 4:30 PM", "at Pine Hollow", "Away"),
             ("Fri, Sep 25 · Time TBA", "vs Westbrook", "Home")]
    rows = "".join(f'<li><b>{o}</b><small>{d} · {h}</small></li>' for d, o, h in games)
    roster = [("1", "Maya Lindqvist", "GK"), ("2", "Ava Moreno", "CB · RB"), ("7", "Sofia Delacroix", "RW · RM"),
              ("9", "Emma Hollis", "ST"), ("10", "Lucia Ferreira", "CAM · CF")]
    rrows = "".join(f'<li><span class="num">#{n}</span><b>{p}</b><small>{pos}</small></li>' for n, p, pos in roster)
    return phone(f"""
<div class="m-title">Harbor Point Herons</div>
<div class="m-row m-accent">＋ Add Games · Import Schedule…</div>
<div class="m-label">Upcoming</div>
<ul class="m-list">{rows}</ul>
<div class="m-label">Roster (18)</div>
<ul class="m-list roster">{rrows}</ul>""", "Team screen with upcoming schedule and roster")


SHOWCASE = [
    ("score", "Score", "scoring", mock_scoring,
     "Keep the book in two taps.",
     ["Big buttons for both teams, grouped the way coaches think", "A clock that keeps running when the phone locks",
      "Undo anytime, and long-press any play to delete it", "Optional opponent jersey numbers for their scorers"]),
    ("sports", "Every sport", "basketball", mock_basketball,
     "One scorebook for 15 sports.",
     ["Soccer's complete pad plus a stat sheet for 11 more sports", "Innings, quarters, periods, sets and meets, with or without a clock",
      "Yards, pins and penalty minutes entered as numbers", "Rally scoring and sets won for volleyball"]),
    ("box", "Box score", "boxscore", mock_boxscore,
     "A real box score, as you go.",
     ["Player, goalie and pitching tables with team totals", "Score by period, and play-by-play for the whole game",
      "Head coaches correct stats with a PIN, and every change is logged", "Spreadsheet export for your staff"]),
    ("maxpreps", "MaxPreps", "export", mock_maxpreps,
     "Stats ready for MaxPreps.",
     ["One question per team: do you post to MaxPreps?", "A stats file in MaxPreps' import format after every game",
      "Jersey numbers and stats only, never names", "A printable entry sheet in MaxPreps' order"]),
    ("team", "Schedule & roster", "team", mock_team,
     "Set up the season in minutes.",
     ["Import your roster from a spreadsheet or pasted cells", "Subscribe to your school's calendar link or import a CSV",
      "Try a sample team before you enter your own", "MaxPreps roster file for high school teams"]),
]


def screen_image(screen: str) -> str | None:
    """Copies a real iPhone screenshot into the site if one exists and returns its URL."""
    matches = sorted(RAW_SHOTS.glob(f"*-{screen}.png")) if RAW_SHOTS.exists() else []
    if not matches:
        return None
    dest = SITE / "assets" / "screens" / f"{screen}.png"
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        from PIL import Image
        with Image.open(matches[0]) as im:
            im = im.convert("RGB")
            im.thumbnail((600, 1300))
            im.save(dest, optimize=True)
    except ImportError:
        shutil.copy2(matches[0], dest)
    return f"/assets/screens/{screen}.png"


def showcase_html() -> str:
    tabs, panels = "", ""
    for i, (key, label, screen, mock, headline, bullets) in enumerate(SHOWCASE):
        selected = "true" if i == 0 else "false"
        hidden = "" if i == 0 else " hidden"
        tabs += (f'<button role="tab" id="tab-{key}" aria-controls="panel-{key}" aria-selected="{selected}"'
                 f' tabindex="{0 if i == 0 else -1}">{label}</button>')
        img = screen_image(screen)
        visual = (f'<div class="phone real"><img src="{img}" alt="{E(headline)}" loading="lazy"></div>'
                  if img else mock())
        items = "".join(f"<li>{E(b)}</li>" for b in bullets)
        panels += f"""
<div class="panel" role="tabpanel" id="panel-{key}" aria-labelledby="tab-{key}"{hidden}>
  <div class="panel-copy"><h3>{E(headline)}</h3><ul class="ticks">{items}</ul></div>
  <div class="panel-visual">{visual}</div>
</div>"""
    note = "" if any(screen_image(s[2]) for s in SHOWCASE) else '<p class="fine">Illustrations of the app with fictional teams.</p>'
    return f'<div class="tabs" role="tablist" aria-label="Features">{tabs}</div>{panels}{note}'


def sports_html() -> str:
    tiles = ""
    for name, status, summary in SPORTS:
        mp = '<span class="chip chip-mp">MaxPreps</span>' if name in MAXPREPS_SPORTS else ""
        tiles += f"""<li class="sport s-{status}">
  <div class="sport-head"><h3>{E(name)}</h3><span class="chip chip-{status}">{STATUS_LABEL[status]}</span></div>
  <p>{E(summary)}</p>{mp}
</li>"""
    return f'<ul class="sports">{tiles}</ul>'


def faq_html() -> str:
    return "".join(f"<details><summary>{E(q)}</summary><p>{E(a)}</p></details>" for q, a in FAQ)


def home() -> str:
    return f"""
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">Every stat. Every sport. One book.</p>
      <h1>The scorebook for <span class="hl">every sport.</span></h1>
      <p class="lede">Lockerbook keeps the book for 15 sports on iPhone and iPad. Tap in the game, get a full box score, and create your MaxPreps stats file, while your players' information stays with your staff.</p>
      <div class="actions">
        <a class="btn btn-primary" href="mailto:{EMAIL}?subject=Lockerbook%20beta">Join the TestFlight beta</a>
        <a class="btn btn-ghost" href="#sports">See all 15 sports</a>
      </div>
      <ul class="facts">
        <li>Free during the beta</li><li>iPhone &amp; iPad</li><li>School · College · Club &amp; Travel</li>
      </ul>
    </div>
    <div class="hero-visual">{mock_scoring()}</div>
  </div>
</section>

<section id="sports" class="band">
  <div class="wrap">
    <p class="eyebrow">15 sports</p>
    <h2>One app for the whole athletic department.</h2>
    <p class="lede">Soccer has the complete scoring screen. Eleven more sports use the stat-sheet scorekeeper in preview, and meet sports are next.</p>
    {sports_html()}
  </div>
</section>

<section id="features">
  <div class="wrap">
    <p class="eyebrow">Features</p>
    <h2>Fast on the sideline. Detailed in the stats.</h2>
    {showcase_html()}
  </div>
</section>

<section id="maxpreps" class="band band-mp">
  <div class="wrap mp-grid">
    <div>
      <p class="eyebrow">MaxPreps-ready</p>
      <h2>From final whistle to {maxpreps_mark("mp-inline")} in a minute.</h2>
      <p class="lede">Lockerbook creates the stats file MaxPreps imports, so high school teams skip retyping the box score.</p>
      <ol class="steps">
        <li><b>Answer once.</b> “Will this team post stats to MaxPreps?” Yes turns on the MaxPreps tools for that team.</li>
        <li><b>Keep the book.</b> Lockerbook tracks the stats MaxPreps asks for in your sport.</li>
        <li><b>Share the file.</b> After the game, send the stats file to the computer you use for MaxPreps.</li>
        <li><b>Import and publish.</b> On MaxPreps, open the game, choose Enter Stats, and import the file.</li>
      </ol>
      <p class="fine">Stats files contain jersey numbers and stats, never names. Soccer is ready now. Baseball, softball, basketball, football, volleyball, lacrosse, ice hockey and field hockey turn on as their field lists are confirmed with MaxPreps.</p>
    </div>
    <div class="mp-card">
      <div class="mp-card-head">{maxpreps_mark()}<span>Stats file</span></div>
      <pre>Jersey|Goals|Assists|Shots|ShotsOnGoal
7|1|1|3|2
9|1|1|2|2
12|1|0|1|1
1|0|0|0|0</pre>
      <p>One line per athlete, matched by jersey number.</p>
    </div>
  </div>
</section>

<section id="levels">
  <div class="wrap">
    <p class="eyebrow">Every level</p>
    <h2>Built for school, college, club &amp; travel.</h2>
    <div class="cards three">
      <article class="card"><h3>School</h3><p>Varsity, JV and freshman formats that follow NFHS play, plus MaxPreps stats files, streaming reminders for postseason games, and head-coach corrections.</p></article>
      <article class="card"><h3>College</h3><p>NCAA-style halves, quarters and periods, and longer innings. The same box scores, spreadsheet exports and staff-only data.</p></article>
      <article class="card"><h3>Club &amp; Travel</h3><p>Shorter games, youth quarters and travel formats. Player names stay hidden from invited viewers by default for youth teams.</p></article>
    </div>
  </div>
</section>

<section id="privacy" class="band">
  <div class="wrap">
    <p class="eyebrow">Privacy</p>
    <h2>Your roster never leaves the locker room.</h2>
    <div class="cards four">
      <article class="card"><h3>No servers holding rosters</h3><p>Teams, rosters and stats live on your device, encrypted when it's locked.</p></article>
      <article class="card"><h3>No ads or trackers</h3><p>No ad networks, analytics or tracking, and nothing to sign up for.</p></article>
      <article class="card"><h3>Numbers, not names</h3><p>Public views, broadcast overlays and MaxPreps files use jersey numbers.</p></article>
      <article class="card"><h3>Locked to your staff</h3><p>An optional Face ID lock, a privacy screen in the app switcher, and a head-coach PIN.</p></article>
    </div>
    <p class="more"><a href="/privacy/">Read the privacy policy →</a></p>
  </div>
</section>

<section id="pricing">
  <div class="wrap">
    <p class="eyebrow">Pricing</p>
    <h2>Free during the beta.</h2>
    <p class="lede">Join the TestFlight beta and keep the book for real games this season. Plans arrive at launch.</p>
    <div class="cards three pricing">
      <article class="card"><h3>One Sport</h3><p class="price">At launch</p><ul class="ticks"><li>Every level of one sport</li><li>Box scores and exports</li><li>MaxPreps stats files</li></ul></article>
      <article class="card featured"><span class="chip chip-available">Most flexible</span><h3>All Sports</h3><p class="price">At launch</p><ul class="ticks"><li>All 15 sports</li><li>Great for multi-sport coaches</li><li>Everything in One Sport</li></ul></article>
      <article class="card"><h3>School &amp; Club</h3><p class="price">Contact us</p><ul class="ticks"><li>Every team in your program</li><li>One invoice</li><li>Data privacy agreement</li></ul></article>
    </div>
    <p class="more"><a href="mailto:{EMAIL}?subject=School%20licensing%20-%20Lockerbook">Ask about school &amp; club licensing →</a></p>
  </div>
</section>

<section id="faq" class="band">
  <div class="wrap narrow">
    <p class="eyebrow">FAQ</p>
    <h2>Questions coaches ask.</h2>
    <div class="faq">{faq_html()}</div>
  </div>
</section>

<section class="cta">
  <div class="wrap">
    <h2>Ready for game day?</h2>
    <p class="lede">Join the beta, bring your roster, and keep the book for your next game.</p>
    <a class="btn btn-primary" href="mailto:{EMAIL}?subject=Lockerbook%20beta">Join the TestFlight beta</a>
  </div>
</section>
"""


SUPPORT = f"""
<div class="doc">
  <div class="wrap narrow">
    <h1>Support</h1>
    <p class="updated">We're a small team and read every message.</p>
    <p class="contact">Email <a href="mailto:{EMAIL}?subject=Lockerbook%20Support">{EMAIL}</a></p>
    <p>You can also tap <strong>Settings → Contact Support</strong> in the app. In the TestFlight beta, take a screenshot and use <strong>Send Beta Feedback</strong>.</p>
    <p>Please include your sport, your device (iPhone or iPad), the app version from <strong>Settings → About</strong>, and what you were doing. <strong>Don't send player names or rosters</strong>. Jersey numbers are enough for us to help.</p>

    <h2>Quick answers</h2>
    <h3>I tapped the wrong player.</h3>
    <p>Tap <strong>Undo</strong>, or long-press the play and choose <strong>Delete</strong>. In soccer, the head coach can also use <strong>Edit Stats</strong> after the game.</p>
    <h3>How do I send stats to MaxPreps?</h3>
    <p>Answer <strong>Yes</strong> to “Will this team post stats to MaxPreps?” Then open the game → ••• → <strong>MaxPreps &amp; Export</strong> → <strong>Share MaxPreps Stats File</strong>, and import it on MaxPreps under the game's <strong>Enter Stats</strong>. Jersey numbers must match your MaxPreps roster exactly. <a href="/help/05-maxpreps.html">Full steps</a>.</p>
    <h3>How do I score a sport other than soccer?</h3>
    <p>Turn the sport on in <strong>Settings → Your Sports</strong>, add a team, and start a game. Tap a stat, then the player. <a href="/help/14-other-sports.html">Scoring other sports</a>.</p>
    <h3>Does it work without internet?</h3>
    <p>Yes. Scoring, box scores and exports all work offline.</p>
    <h3>How do I delete my data?</h3>
    <p>Delete a team from its screen, or use <strong>Settings → Delete All Lockerbook Data</strong>. Your data is only on your device.</p>

    <h2>User guide</h2>
    <p>Step-by-step help for every screen is in the <a href="/help/">Lockerbook guide</a>.</p>

    <h2>Schools and licensing</h2>
    <p>Email <a href="mailto:{EMAIL}?subject=School%20licensing%20-%20Lockerbook">{EMAIL}</a> with “School licensing” in the subject.</p>
  </div>
</div>
"""


PRESS = f"""
<div class="doc">
  <div class="wrap narrow">
    <h1>Press</h1>
    <p class="updated">Fact sheet, description and assets for Lockerbook.</p>

    <div class="press-head">
      <img src="/assets/icon-512.png" alt="Lockerbook app icon" width="120" height="120">
      <div>
        <p><strong>Lockerbook</strong> is the scorebook for every sport. It lets one scorekeeper keep the book on iPhone or iPad for school, college and club/travel teams, with full box scores, a MaxPreps stats file for high school teams, and student-athlete information that stays with the coaching staff.</p>
        <p class="eyebrow">Every stat. Every sport. One book.</p>
        <p><a class="btn btn-ghost" href="/assets/icon-512.png" download>Download app icon (PNG)</a></p>
      </div>
    </div>

    <h2>Fact sheet</h2>
    <table>
      <tbody>
        <tr><th>Tagline</th><td>Every stat. Every sport. One book.</td></tr>
        <tr><th>Developer</th><td>Vermonster's Pro Shop</td></tr>
        <tr><th>Platforms</th><td>iPhone and iPad (iOS/iPadOS 26 or later)</td></tr>
        <tr><th>Sports</th><td>Soccer; baseball, softball, basketball, football, volleyball, lacrosse, ice hockey, field hockey, wrestling, tennis and bowling (preview); track &amp; field, cross country and swimming &amp; diving (coming soon)</td></tr>
        <tr><th>Levels</th><td>High school (varsity, JV, freshman), college, club and travel</td></tr>
        <tr><th>Status</th><td>TestFlight beta, fall 2026</td></tr>
        <tr><th>Price</th><td>Free during the beta. One-sport, all-sports and school/club plans at launch.</td></tr>
        <tr><th>Privacy</th><td>No accounts, ad networks or tracking. Team data stays on the device.</td></tr>
        <tr><th>Website</th><td><a href="https://lockerbook.app">lockerbook.app</a></td></tr>
        <tr><th>Press contact</th><td><a href="mailto:{EMAIL}?subject=Press%20-%20Lockerbook">{EMAIL}</a></td></tr>
      </tbody>
    </table>

    <h2>Short description</h2>
    <p>Lockerbook is the scorebook for every sport: fast on the sideline, detailed in the stats, private to the team, and ready for MaxPreps.</p>

    <h2>Long description</h2>
    <p>Lockerbook replaces the paper scorebook for coaches and scorekeepers across 15 sports. A scorekeeper records each play with one or two taps. Lockerbook builds the box score as the game goes, including minutes and goalkeeper decisions in soccer, at-bats and pitching lines in baseball and softball, and makes and misses in basketball. For high school teams, Lockerbook creates the stats file MaxPreps imports, carrying jersey numbers rather than names. Lockerbook keeps only what a scorebook needs (name, jersey number, position and graduation year), stores it on the device, and has no ad networks or tracking.</p>

    <h2>Key features</h2>
    <ul>
      <li>15 sports: a complete soccer pad and a stat-sheet scorekeeper for 11 more</li>
      <li>Game formats for high school, college, club and travel play</li>
      <li>Box scores, a printable entry sheet and spreadsheet export</li>
      <li>MaxPreps stats file for high school teams</li>
      <li>Roster and schedule import, sample team, head-coach corrections with an audit log</li>
      <li>Face ID lock, privacy screen, jersey-numbers-only public outputs</li>
    </ul>
    <p class="fine">Please use screenshots with the fictional sample teams only. Never publish real student rosters.</p>
  </div>
</div>
"""


def build() -> None:
    sync_brand_assets()
    write("index.html", page("Lockerbook",
                             "Every stat. Every sport. One book. The scorebook for every sport: keep the book on iPhone and iPad, get a full box score, and create your MaxPreps stats file. School, college, club & travel.",
                             home(), "/", "home"))
    write("support/index.html", page("Support", "Get help with Lockerbook. Email contact@lockerbook.app.", SUPPORT))
    write("press/index.html", page("Press", "Lockerbook fact sheet, description and app icon.", PRESS))

    for src, rel, desc in [
        (LEGAL / "privacy-policy.md", "privacy/index.html", "How Lockerbook handles team and athlete information."),
        (LEGAL / "terms-of-use.md", "terms/index.html", "Terms of use for Lockerbook."),
    ]:
        text = src.read_text()
        body = md(text).replace("<p><em>Last updated", '<p class="updated"><em>Last updated', 1)
        write(rel, page(first_heading(text), desc, f'<div class="doc"><div class="wrap narrow">{body}</div></div>'))

    # User manual → /help/
    readme = (MANUAL / "README.md").read_text()
    pages = sorted(MANUAL.glob("[0-9][0-9]-*.md"))
    toc = "".join(f'<li><a href="{p.stem}.html">{E(first_heading(p.read_text()))}</a></li>' for p in pages)
    intro = md(re.sub(r"^\d+\.\s+\[.*$", "", readme, flags=re.M))
    write("help/index.html", page("Help", "The Lockerbook user guide.",
                                  f'<div class="doc"><div class="wrap narrow">{intro}<ol class="toc">{toc}</ol></div></div>',
                                  "/help/"))
    for i, p in enumerate(pages):
        text = re.sub(r"\]\((\d\d-[a-z0-9-]+)\.md(#[^)]*)?\)", lambda m: f"]({m.group(1)}.html{m.group(2) or ''})", p.read_text())
        prev_link = f'<a href="{pages[i-1].stem}.html">← {E(first_heading(pages[i-1].read_text()))}</a>' if i else "<span></span>"
        next_link = (f'<a href="{pages[i+1].stem}.html">{E(first_heading(pages[i+1].read_text()))} →</a>'
                     if i + 1 < len(pages) else "<span></span>")
        pager = f'<nav class="pager" aria-label="Guide pages">{prev_link}<a href="/help/">All topics</a>{next_link}</nav>'
        write(f"help/{p.stem}.html", page(first_heading(text), f"Lockerbook guide: {first_heading(text)}.",
                                          f'<div class="doc"><div class="wrap narrow">{md(text)}{pager}</div></div>', "/help/"))


if __name__ == "__main__":
    build()
