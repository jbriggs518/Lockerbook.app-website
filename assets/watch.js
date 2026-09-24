// lockerbook.app — public "watch this game live" page. Vanilla JS, no framework, no build step,
// no third-party script, font, analytics or tracker. The only stored value is one localStorage key
// ("lockerbook.watch.code") holding the last share code typed on this device.
//
// =====================================================================================
// CLOUDKIT RECORD CONTRACT — the iOS app is written against this. Do not change silently.
// =====================================================================================
//
// Database : CloudKit PUBLIC database of the container in the page config
//            (built by build.py from LIVE_CLOUDKIT; container "iCloud.app.lockerbook.lockerbook").
// Read as  : unauthenticated web request with a public API token. Fans never sign in.
//            The record type "LiveGame" must have Security Role **_world: Read** in the
//            CloudKit Dashboard, and the "code" field must be marked QUERYABLE.
// Written  : only by the coach's device, only while the coach has live sharing switched on.
//            The device deletes (or finalises) the record when sharing is switched off.
//
// Record type: LiveGame
// recordName : anything. This page never shows it. Recommended: the share code, so a
//              re-publish overwrites in place instead of creating duplicates.
//
//   FIELD           CLOUDKIT TYPE   REQUIRED  MEANING
//   code            String          yes       Share code shown in the app, e.g. "HAWK-4821".
//                                             Uppercase A–Z, digits and "-" only. Must be QUERYABLE.
//   teamName        String          no        The scorekeeping team's name.
//   opponentName    String          no        The opponent's name.
//   ourScore        Int64           no        Score for teamName.
//   opponentScore   Int64           no        Score for opponentName.
//   periodLabel     String          no        Free text, e.g. "2nd Half", "Q3", "Set 4", "Top 6".
//   clockSecond     Int64           no        Seconds on the game clock as the coach's app shows it
//                                             (counting down or up — the page only formats it).
//   status          String          no        "scheduled" | "inProgress" | "final" (exact spelling).
//   lines           String List     no        Play-by-play, CHRONOLOGICAL, OLDEST FIRST.
//                                             Each entry: "period|clockSecond|side|text"
//                                               period      integer period index, 1-based
//                                               clockSecond integer seconds, or "" if no clock
//                                               side        "us" | "opponent" (also accepted:
//                                                           "them", "home", "away", "" = neutral)
//                                               text        the play. JERSEY NUMBERS ONLY.
//                                             Publish at most ~200 lines; this page shows 200.
//   updatedAt       Timestamp       no        When the snapshot was built on the coach's device.
//                                             CloudKit Web Services returns this as milliseconds
//                                             since 1970 (a number), not an ISO string.
//
// PRIVACY — these are product promises, enforced on the publishing side and assumed here:
//   * "text" and every other string must contain JERSEY NUMBERS ONLY — never an athlete name,
//     never contact information, and nothing about an opposing athlete beyond a jersey number.
//   * This page reads ONLY the fields listed above. Any other field present on the record is
//     ignored and never rendered (see readFields() — it is an allowlist, on purpose).
//   * Everything from CloudKit is written to the DOM with textContent. No innerHTML, ever.
//
// MISSING / MALFORMED FIELDS — exactly what this page does:
//   code missing/blank .......... the record is treated as not found ("code not found" state).
//   teamName missing/blank ...... shown as "Home".
//   opponentName missing/blank .. shown as "Away".
//   ourScore / opponentScore .... missing, null or not a number -> 0.
//   periodLabel missing/blank ... the period line is left empty (no placeholder text).
//   clockSecond missing, null,
//     not a number, or negative . the clock shows an em dash and no time is implied.
//   status missing or not one of
//     the three exact values .... treated as "inProgress", so the page keeps polling and never
//                                 wrongly announces a final score.
//   lines missing or empty ...... play-by-play shows "No plays yet."
//   a line with fewer than 4
//     "|" parts ................. the whole raw string becomes the text; period, clock and side
//                                 are unknown (no time shown, neutral styling). Extra "|" stay in
//                                 the text: the string is split into at most 4 parts.
//   a line with a non-numeric
//     period or clockSecond ..... that part is dropped, the text is still shown.
//   updatedAt missing/invalid ... falls back to the record's CloudKit system "modified" timestamp;
//                                 if that is missing too, the "last updated" line reads
//                                 "Waiting for the first update."
//   more than one record matches
//     the code .................. the most recently updated one wins.
//
// POLLING: 5s while inProgress, 15s while scheduled, 60s once final. Paused entirely while the
// tab is hidden (refetched immediately on return). Network/CloudKit failures back off
// 5s -> 10s -> 20s -> 40s -> 60s and keep the last good snapshot on screen.
// =====================================================================================

(function () {
  "use strict";

  var root = document.getElementById("watch");
  if (!root) return;

  // ---- config (inlined by build.py as JSON, so there is no inline executable script) ----
  var CONFIG = { container: "", environment: "production", apiToken: "" };
  try {
    var el = document.getElementById("live-config");
    if (el) CONFIG = JSON.parse(el.textContent) || CONFIG;
  } catch (e) { /* keep defaults; the page falls back to the "not switched on" state */ }

  var CONFIGURED = !!(CONFIG.apiToken && CONFIG.container);

  var STORAGE_KEY = "lockerbook.watch.code";
  var MAX_LINES = 200;
  var INTERVAL = { inProgress: 5000, scheduled: 15000, final: 60000 };
  var BACKOFF = [5000, 10000, 20000, 40000, 60000];

  // ---- elements ----
  var $ = function (id) { return document.getElementById(id); };
  var form = $("w-form");
  var input = $("w-code");
  var intro = $("w-intro");
  var offline = $("w-offline");
  var game = $("w-game");
  var board = $("w-board");
  var notice = $("w-notice");
  var noticeTitle = $("w-notice-title");
  var noticeBody = $("w-notice-body");
  var conn = $("w-conn");
  var connText = $("w-conn-text");
  var badge = $("w-badge");
  var ourName = $("w-our-name");
  var ourScore = $("w-our-score");
  var oppName = $("w-opp-name");
  var oppScore = $("w-opp-score");
  var period = $("w-period");
  var clock = $("w-clock");
  var plays = $("w-plays");
  var playsEmpty = $("w-plays-empty");
  var updated = $("w-updated");
  var again = $("w-again");
  var change = $("w-change");

  // ---- state ----
  var code = "";
  var timer = null;
  var ticker = null;
  var failures = 0;
  var lastSnapshot = null;
  var lastUpdatedMs = 0;
  var inFlight = null;

  // ---- small helpers ----
  function text(node, value) { if (node) node.textContent = value; }
  function show(node, visible) { if (node) node.hidden = !visible; }

  function normalizeCode(raw) {
    return String(raw || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24);
  }

  function num(value) {
    if (value === null || value === undefined || value === "") return null;
    var n = typeof value === "number" ? value : Number(value);
    return isFinite(n) ? n : null;
  }

  function str(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  function formatClock(seconds) {
    if (seconds === null || seconds < 0) return "—";
    var s = Math.floor(seconds);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    var mm = h > 0 && m < 10 ? "0" + m : String(m);
    var ss = sec < 10 ? "0" + sec : String(sec);
    return h > 0 ? h + ":" + mm + ":" + ss : mm + ":" + ss;
  }

  function ago(ms) {
    if (!ms) return "";
    var secs = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (secs < 5) return "just now";
    if (secs < 60) return secs + " seconds ago";
    var mins = Math.round(secs / 60);
    if (mins === 1) return "1 minute ago";
    if (mins < 60) return mins + " minutes ago";
    var hrs = Math.round(mins / 60);
    return hrs === 1 ? "1 hour ago" : hrs + " hours ago";
  }

  // ---- CloudKit ----
  function endpoint() {
    return "https://api.apple-cloudkit.com/database/1/" +
      encodeURIComponent(CONFIG.container) + "/" +
      encodeURIComponent(CONFIG.environment || "production") +
      "/public/records/query?ckAPIToken=" + encodeURIComponent(CONFIG.apiToken);
  }

  function queryBody(shareCode) {
    return JSON.stringify({
      query: {
        recordType: "LiveGame",
        filterBy: [{
          fieldName: "code",
          comparator: "EQUALS",
          fieldValue: { value: shareCode, type: "STRING" }
        }]
      },
      resultsLimit: 5
    });
  }

  // CloudKit Web Services wraps every value as {value: ..., type: "..."}.
  function field(fields, name) {
    var f = fields && fields[name];
    if (!f) return null;
    return f.value === undefined ? null : f.value;
  }

  // Allowlist. Anything not named here never reaches the DOM.
  function readFields(record) {
    var f = record && record.fields ? record.fields : {};
    var status = str(field(f, "status"));
    if (status !== "scheduled" && status !== "inProgress" && status !== "final") status = "inProgress";

    var stamp = num(field(f, "updatedAt"));
    if (stamp === null && record && record.modified) stamp = num(record.modified.timestamp);

    var rawLines = field(f, "lines");
    if (!Array.isArray(rawLines)) rawLines = [];

    return {
      code: str(field(f, "code")),
      teamName: str(field(f, "teamName")) || "Home",
      opponentName: str(field(f, "opponentName")) || "Away",
      ourScore: num(field(f, "ourScore")) || 0,
      opponentScore: num(field(f, "opponentScore")) || 0,
      periodLabel: str(field(f, "periodLabel")),
      clockSecond: num(field(f, "clockSecond")),
      status: status,
      lines: rawLines.map(parseLine).filter(function (l) { return l.text !== ""; }),
      updatedAt: stamp
    };
  }

  function parseLine(raw) {
    var s = str(raw);
    var parts = s.split("|");
    if (parts.length < 4) return { period: null, clockSecond: null, side: "", text: s };
    var head = parts.slice(0, 3);
    var body = parts.slice(3).join("|");   // extra pipes stay in the text
    var side = str(head[2]).toLowerCase();
    if (side === "them" || side === "away") side = "opponent";
    if (side === "home") side = "us";
    if (side !== "us" && side !== "opponent") side = "";
    return {
      period: num(head[0]),
      clockSecond: num(head[1]),
      side: side,
      text: str(body)
    };
  }

  // ---- rendering ----
  function setConnection(kind, label) {
    if (!conn) return;
    conn.setAttribute("data-state", kind);
    text(connText, label);
  }

  function showNotice(title, body) {
    text(noticeTitle, title);
    text(noticeBody, body);
    show(notice, true);
  }

  function render(snap) {
    lastSnapshot = snap;
    lastUpdatedMs = snap.updatedAt || 0;

    text(ourName, snap.teamName);
    text(oppName, snap.opponentName);
    text(ourScore, String(snap.ourScore));
    text(oppScore, String(snap.opponentScore));
    text(period, snap.periodLabel);
    text(clock, snap.status === "final" ? "—" : formatClock(snap.clockSecond));

    var label = snap.status === "final" ? "Final"
      : snap.status === "scheduled" ? "Not started" : "Live";
    text(badge, label);
    badge.setAttribute("data-status", snap.status);
    if (board) board.setAttribute("data-status", snap.status);
    game.setAttribute("data-status", snap.status);

    renderPlays(snap);
    show(game, true);
    show(intro, false);
    show(notice, false);
    show(change, true);

    if (snap.status === "scheduled" && snap.lines.length === 0) {
      text(playsEmpty, "This game hasn't started yet. The score and plays appear here as soon as the scorekeeper begins.");
    } else {
      text(playsEmpty, "No plays yet.");
    }
    tick();
  }

  function renderPlays(snap) {
    plays.textContent = "";
    var list = snap.lines.slice(-MAX_LINES).reverse();   // contract: published oldest first
    show(playsEmpty, list.length === 0);
    for (var i = 0; i < list.length; i++) {
      var line = list[i];
      var li = document.createElement("li");
      li.className = "play";
      li.setAttribute("data-side", line.side || "neutral");

      var when = document.createElement("span");
      when.className = "play-when";
      var bits = [];
      if (line.period !== null) bits.push("P" + line.period);
      if (line.clockSecond !== null && line.clockSecond >= 0) bits.push(formatClock(line.clockSecond));
      when.textContent = bits.join(" · ");
      li.appendChild(when);

      var body = document.createElement("span");
      body.className = "play-text";
      body.textContent = line.text;          // textContent only — never innerHTML
      li.appendChild(body);

      if (line.side) {
        var who = document.createElement("span");
        who.className = "play-who";
        who.textContent = line.side === "us" ? snap.teamName : snap.opponentName;
        li.appendChild(who);
      }
      plays.appendChild(li);
    }
  }

  function tick() {
    if (!lastSnapshot) return;
    if (!lastUpdatedMs) {
      text(updated, "Waiting for the first update.");
      return;
    }
    text(updated, "Last updated " + ago(lastUpdatedMs) + ".");
  }

  // ---- polling ----
  function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }

  function schedule() {
    clearTimer();
    if (!code || document.hidden) return;
    var wait;
    if (failures > 0) {
      wait = BACKOFF[Math.min(failures - 1, BACKOFF.length - 1)];
    } else {
      var status = lastSnapshot ? lastSnapshot.status : "inProgress";
      wait = INTERVAL[status] || INTERVAL.inProgress;
    }
    timer = setTimeout(poll, wait);
  }

  function poll() {
    if (!code || !CONFIGURED || inFlight) return;
    if (!lastSnapshot) setConnection("connecting", "Connecting…");

    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var guard = setTimeout(function () { if (controller) controller.abort(); }, 15000);
    inFlight = true;

    fetch(endpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: queryBody(code),
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    }).then(function (data) {
      clearTimeout(guard);
      inFlight = null;
      failures = 0;
      handle(data);
      schedule();
    }).catch(function () {
      clearTimeout(guard);
      inFlight = null;
      failures += 1;
      if (lastSnapshot) {
        setConnection("retry", "Reconnecting…");
      } else if (failures >= 2) {
        setConnection("retry", "Reconnecting…");
        showNotice("We can't reach the scoreboard right now.",
          "Check your connection. This page keeps trying on its own — you don't need to reload it.");
      }
      schedule();
    });
  }

  function handle(data) {
    if (data && data.serverErrorCode) {
      setConnection("retry", "Unavailable");
      showNotice("Live view is unavailable.",
        "The scoreboard service turned this request down. Please try again in a few minutes.");
      return;
    }
    var records = (data && Array.isArray(data.records)) ? data.records : [];
    var snaps = [];
    for (var i = 0; i < records.length; i++) {
      if (records[i] && records[i].serverErrorCode) continue;
      var snap = readFields(records[i]);
      if (snap.code) snaps.push(snap);         // no code -> treated as not found
    }
    if (snaps.length === 0) {
      notFound();
      return;
    }
    snaps.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    render(snaps[0]);

    if (snaps[0].status === "final") setConnection("final", "Final");
    else if (snaps[0].status === "scheduled") setConnection("waiting", "Waiting to start");
    else setConnection("live", "Live");
  }

  function notFound() {
    lastSnapshot = null;
    show(game, false);
    show(intro, false);
    show(change, true);
    setConnection("idle", "Not connected");
    showNotice("We couldn't find a game with that code.",
      "Double-check the code with the coach or scorekeeper. Codes are only live while the game is being shared, " +
      "and they stop working once the coach turns sharing off.");
    clearTimer();
    code = "";
  }

  // ---- entry points ----
  function start(newCode, remember) {
    code = normalizeCode(newCode);
    if (!code) return;
    if (input) input.value = code;
    if (remember) {
      try { localStorage.setItem(STORAGE_KEY, code); } catch (e) { /* private browsing */ }
    }
    try {
      var url = window.location.pathname + "?g=" + encodeURIComponent(code);
      window.history.replaceState(null, "", url);
    } catch (e) { /* file:// and old browsers */ }
    failures = 0;
    lastSnapshot = null;
    show(notice, false);
    show(game, false);
    setConnection("connecting", "Connecting…");
    clearTimer();
    poll();
  }

  function reset() {
    clearTimer();
    code = "";
    lastSnapshot = null;
    show(game, false);
    show(notice, false);
    show(intro, true);
    show(change, false);
    setConnection("idle", "Not connected");
    try { window.history.replaceState(null, "", window.location.pathname); } catch (e) {}
    if (input) { input.value = ""; input.focus(); }
  }

  if (form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!CONFIGURED) return;
      var value = normalizeCode(input ? input.value : "");
      if (!value) { if (input) input.focus(); return; }
      start(value, true);
    });
  }
  if (input) {
    input.addEventListener("input", function () {
      var caretAtEnd = input.selectionStart === input.value.length;
      var cleaned = normalizeCode(input.value);
      if (cleaned !== input.value) {
        input.value = cleaned;
        if (caretAtEnd) input.setSelectionRange(cleaned.length, cleaned.length);
      }
    });
  }
  if (again) {
    again.addEventListener("click", function () {
      if (code) { failures = 0; poll(); } else if (input && input.value) { start(input.value, true); }
    });
  }
  if (change) {
    change.addEventListener("click", function (event) { event.preventDefault(); reset(); });
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      clearTimer();
      if (code) setConnection("paused", "Paused");
    } else if (code) {
      failures = 0;
      poll();
    }
  });

  // ---- boot ----
  if (!CONFIGURED) {
    show(offline, true);
    show(intro, false);
    show(form, false);
    setConnection("idle", "Not switched on");
    return;
  }

  ticker = setInterval(tick, 1000);
  setConnection("idle", "Not connected");

  var params = new URLSearchParams(window.location.search);
  var fromUrl = normalizeCode(params.get("g") || params.get("code") || "");
  var remembered = "";
  try { remembered = normalizeCode(localStorage.getItem(STORAGE_KEY) || ""); } catch (e) {}

  if (fromUrl) {
    start(fromUrl, true);
  } else if (remembered && input) {
    input.value = remembered;
  }
})();
