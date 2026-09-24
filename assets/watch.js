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
//   overlay         Int64           no        1 = the coach turned on the scoreboard overlay (D-055).
//                                             Missing or anything else = 0. Adds no data: the score
//                                             bug is drawn from the fields above and the latest line.
//
//   D-056 extras (celebrations, momentum, score chart, final card, Player of the Game):
//   sport           String          no        Sport.rawValue: "soccer", "football", "iceHockey"…
//                                             Picks the words ("GOAL!", "TOUCHDOWN!", "runs").
//   tally           String List     no        "ours|theirs" POINTS after each entry of `lines`, same
//                                             order and same length (raw points, even in set sports).
//   periodScores    String List     no        "label|ours|theirs" per started period, in order,
//                                             e.g. "1st Half|1|0". Label = the app's period name.
//   gameSecond      Int64           no        Cumulative game seconds now (same count as each line's
//                                             clock); -1 = no clock, not started, or final.
//   playerOfGame    String          no        The coach's pick as a jersey label, e.g. "#10"; "" = none.
//
//   D-057 win chance and season notes (doc 22). Only when the coach switched them on for the team:
//   winChance       Int64           no        0–100 = teamName's chance to win (1–99 while live);
//                                             -1 = not shown. Shown only while status is inProgress.
//   winChanceTrail  String List     no        "x|pct" earlier estimates, oldest first. x = game second
//                                             (clock sports) or play number; drawn as a small line.
//   notes           String List     no        Up to 3 team-level season notes, each < 90 characters,
//                                             e.g. "Harbor Point is 6–1 this season when leading at half."
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
//   sport missing/unknown ....... generic words ("SCORE!", "points").
//   tally missing, or not the
//     same length as lines ...... no running score: no momentum lines, chart, chime-by-point or
//                                 running score on the final card (celebrations still follow
//                                 the scoreboard numbers).
//   periodScores missing ........ the final card has no score-by-period table; plays say "P2".
//   gameSecond missing or < 0 ... no "No goals in 12 minutes" line.
//   playerOfGame missing, blank,
//     or not "#" + 1–4 letters/
//     digits .................... not shown. Anything that isn't a jersey label is dropped, so a
//                                 name can never appear here even if a publisher got it wrong.
//   winChance missing, < 0,
//     > 100, or not live ........ no win-chance card.
//   winChanceTrail bad entries .. dropped; fewer than 2 good points = no trail line.
//   notes missing ............... no season notes; more than 3, or one over 120 characters, are dropped.
//   overlay missing or not 1 .... no score bug on the normal page; an overlay-mode page
//                                 (?overlay=1) stays fully transparent and shows nothing.
//   more than one record matches
//     the code .................. the most recently updated one wins.
//
// POLLING: 5s while inProgress, 15s while scheduled, 60s once final. Paused entirely while the
// tab is hidden (refetched immediately on return). Network/CloudKit failures back off
// 5s -> 10s -> 20s -> 40s -> 60s and keep the last good snapshot on screen.
//
// OVERLAY MODE (?g=CODE&overlay=1, D-055): a Browser Source for OBS, vMix or Wirecast. The page
// background is transparent and only the score bug is drawn, bottom-left, and only while the
// record's overlay field is 1. Same polling and backoff; a code that isn't found yet keeps being
// polled at the "scheduled" rate (nobody is at the keyboard to retype it). Nothing is remembered
// in localStorage in this mode.
// =====================================================================================

(function () {
  "use strict";

  // Overlay mode is decided before the page draws, so the site's header and footer never flash
  // into a broadcast. This file is therefore loaded without "defer"; the rest waits for the DOM.
  var OVERLAY = false;
  try { OVERLAY = new URLSearchParams(window.location.search).get("overlay") === "1"; } catch (e) {}
  if (OVERLAY) document.documentElement.classList.add("lb-overlay");

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main);
  else main();

  function main() {
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
    // Score bug (D-055): at the top of the scoreboard card, or alone in overlay mode.
    var bug = $("w-bug");
    var bugOurName = $("w-bug-our-name");
    var bugOurScore = $("w-bug-our-score");
    var bugOppName = $("w-bug-opp-name");
    var bugOppScore = $("w-bug-opp-score");
    var bugTime = $("w-bug-time");
    var bugPeriod = $("w-bug-period");
    var bugClock = $("w-bug-clock");
    var bugTicker = $("w-bug-ticker");
    var bugLast = $("w-bug-last");
    var stage = null;
    // D-056 extras.
    var celebration = $("w-celebrate");
    var celebrationWordEl = $("w-celebrate-word");
    var celebrationTeamEl = $("w-celebrate-team");
    var celebrationBits = $("w-celebrate-bits");
    var announcer = $("w-announce");
    var potg = $("w-potg");
    var potgNum = $("w-potg-num");
    var soundButton = $("w-sound");
    var soundLabel = $("w-sound-label");
    var shareButton = $("w-share");
    var shareButtonLabel = $("w-share-label");
    var shareNote = $("w-share-note");
    var momentum = $("w-momentum");
    var momentumHead = $("w-momentum-head");
    var momentumList = $("w-momentum-lines");
    var flowWrap = $("w-flow-wrap");
    var flow = $("w-flow");
    var flowUs = $("w-flow-us");
    var flowThem = $("w-flow-them");
    var flowStart = $("w-flow-start");
    var flowEnd = $("w-flow-end");
    var finalCard = $("w-final");
    var finalResult = $("w-final-result");
    var finalOurName = $("w-final-our-name");
    var finalOppName = $("w-final-opp-name");
    var finalOurScore = $("w-final-our-score");
    var finalOppScore = $("w-final-opp-score");
    var finalTableWrap = $("w-final-table-wrap");
    var finalTable = $("w-final-table");
    var finalPlaysWrap = $("w-final-plays-wrap");
    var finalPlays = $("w-final-plays");
    var finalPotg = $("w-final-potg");
    var finalPotgNum = $("w-final-potg-num");
    // D-057 win chance + season notes.
    var insight = $("w-insight");
    var wp = $("w-wp");
    var wpLine = $("w-wp-line");
    var wpUs = $("w-wp-us");
    var wpBar = $("w-wp-bar");
    var wpUsName = $("w-wp-us-name");
    var wpThemName = $("w-wp-them-name");
    var wpTrail = $("w-wp-trail");
    var notesWrap = $("w-notes-wrap");
    var notesList = $("w-notes");

    // ---- state ----
    var code = "";
    var timer = null;
    var ticker = null;
    var failures = 0;
    var lastSnapshot = null;
    var lastUpdatedMs = 0;
    var inFlight = null;
    var bugLastText = "";

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
      var rawTally = field(f, "tally");
      if (!Array.isArray(rawTally) || rawTally.length !== rawLines.length) rawTally = null;

      var periodScores = [];
      var rawPeriods = field(f, "periodScores");
      if (Array.isArray(rawPeriods)) {
        for (var i = 0; i < rawPeriods.length; i++) {
          var parts = str(rawPeriods[i]).split("|");
          if (parts.length < 3) { periodScores = []; break; }
          var theirs = num(parts.pop()), ours = num(parts.pop());
          if (ours === null || theirs === null) { periodScores = []; break; }
          periodScores.push({ label: str(parts.join(" ")), ours: ours, theirs: theirs });
        }
      }

      var gameSecond = num(field(f, "gameSecond"));
      if (gameSecond !== null && gameSecond < 0) gameSecond = null;
      var pick = str(field(f, "playerOfGame"));
      if (!/^#[A-Za-z0-9]{1,4}$/.test(pick)) pick = "";   // a jersey label or nothing

      return {
        code: str(field(f, "code")),
        teamName: str(field(f, "teamName")) || "Home",
        opponentName: str(field(f, "opponentName")) || "Away",
        ourScore: num(field(f, "ourScore")) || 0,
        opponentScore: num(field(f, "opponentScore")) || 0,
        periodLabel: str(field(f, "periodLabel")),
        clockSecond: num(field(f, "clockSecond")),
        status: status,
        lines: rawLines.map(function (raw, i) { return parseLine(raw, rawTally ? rawTally[i] : null); })
          .filter(function (l) { return l.text !== ""; }),
        updatedAt: stamp,
        overlay: num(field(f, "overlay")) === 1,     // anything but 1 = the coach hasn't allowed it
        sport: str(field(f, "sport")),
        periodScores: periodScores,
        gameSecond: gameSecond,
        playerOfGame: pick,
        winChance: readChance(f, status),
        notes: readNotes(field(f, "notes")),
        truncated: rawLines.length >= MAX_LINES      // the app keeps the newest 200: the start is gone
      };
    }

    function readChance(f, status) {
      var pct = num(field(f, "winChance"));
      if (status !== "inProgress" || pct === null || pct < 0 || pct > 100) return null;
      var trail = [];
      var raw = field(f, "winChanceTrail");
      if (Array.isArray(raw)) {
        raw.forEach(function (entry) {
          var parts = str(entry).split("|");
          var x = parts.length === 2 ? num(parts[0]) : null;
          var y = parts.length === 2 ? num(parts[1]) : null;
          if (x !== null && y !== null && y >= 0 && y <= 100) trail.push({ x: x, y: y });
        });
      }
      return { pct: Math.round(pct), trail: trail };
    }

    function readNotes(raw) {
      if (!Array.isArray(raw)) return [];
      return raw.map(str).filter(function (n) { return n !== "" && n.length <= 120; }).slice(0, 3);
    }

    function parseTally(raw) {
      var parts = str(raw).split("|");
      var ours = parts.length === 2 ? num(parts[0]) : null;
      var theirs = parts.length === 2 ? num(parts[1]) : null;
      return ours === null || theirs === null ? { ours: null, theirs: null } : { ours: ours, theirs: theirs };
    }

    function parseLine(raw, tally) {
      var t = parseTally(tally);
      var s = str(raw);
      var parts = s.split("|");
      if (parts.length < 4) return { period: null, clockSecond: null, side: "", text: s, ours: t.ours, theirs: t.theirs };
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
        text: str(body),
        ours: t.ours,
        theirs: t.theirs
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
      var prev = lastSnapshot;
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
      renderBug(snap);
      renderExtras(prev, snap);
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

    // The broadcast-style score bug: team, score | score, team, period + clock, latest play.
    // Drawn only when the record says the coach turned the overlay on.
    function renderBug(snap) {
      var allowed = !!(snap && snap.overlay);
      show(bug, allowed);
      if (stage) show(stage, allowed);
      if (!allowed || !bug) return;

      text(bugOurName, snap.teamName);
      text(bugOppName, snap.opponentName);
      text(bugOurScore, String(snap.ourScore));
      text(bugOppScore, String(snap.opponentScore));

      var isFinal = snap.status === "final";
      var hasClock = !isFinal && snap.clockSecond !== null && snap.clockSecond >= 0;   // clockless sports: period only
      text(bugPeriod, isFinal ? "FINAL" : snap.periodLabel);
      text(bugClock, hasClock ? formatClock(snap.clockSecond) : "");
      show(bugClock, hasClock);
      show(bugTime, isFinal || hasClock || snap.periodLabel !== "");
      bug.setAttribute("data-status", snap.status);

      var latest = snap.lines.length ? snap.lines[snap.lines.length - 1].text : "";   // oldest first
      show(bugTicker, latest !== "");
      if (latest !== bugLastText) {
        bugLastText = latest;
        text(bugLast, latest);                 // textContent only
        if (bugTicker && latest) {
          // Restart the slide-in for a new play (CSS turns it off for reduced motion).
          bugTicker.classList.remove("bug-new");
          void bugTicker.offsetWidth;
          bugTicker.classList.add("bug-new");
        }
      }
    }

    function hideBug() {
      show(bug, false);
      if (stage) show(stage, false);
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
        if (line.period !== null) bits.push(periodName(snap, line.period));
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

    // =================================================================================
    // D-056 — celebrations, momentum + score chart, share image, final card, sound, Player of
    // the Game. Everything here is drawn from the snapshot the page already has; nothing is sent
    // anywhere, nothing is stored, and every string reaches the DOM through textContent.
    // =================================================================================

    var REDUCED = false;
    try { REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    try {
      window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", function (m) { REDUCED = m.matches; });
    } catch (e) { /* old Safari: keep the first answer */ }

    var SVG_NS = "http://www.w3.org/2000/svg";
    var GOAL_SPORTS = { soccer: 1, lacrosse: 1, iceHockey: 1, fieldHockey: 1 };
    var SET_SPORTS = { volleyball: 1, tennis: 1 };
    // Smallest unanswered run worth a line, in points (and always at least two scoring plays).
    var RUN_MIN = { soccer: 2, iceHockey: 2, fieldHockey: 2, lacrosse: 3, baseball: 3, softball: 3,
                    basketball: 8, football: 14, volleyball: 4 };
    // Minutes without a score worth a line (clock sports only).
    var DROUGHT_MIN = { soccer: 12, lacrosse: 8, iceHockey: 10, fieldHockey: 12, basketball: 4, football: 12 };

    var celebrateTimer = null;
    var soundOn = false;          // off until the viewer turns it on; never remembered
    var audio = null;
    var iconImage = null;

    function unitNoun(sport, n) {
      if (GOAL_SPORTS[sport]) return n === 1 ? "goal" : "goals";
      if (sport === "baseball" || sport === "softball") return n === 1 ? "run" : "runs";
      return n === 1 ? "point" : "points";
    }

    function article(n) {   // "an 8–0 run", "an 11–0 run", "a 2–0 run"
      var s = String(n);
      return (s.charAt(0) === "8" || s === "11" || s === "18" || /^18\d\d$/.test(s) || /^11\d\d$/.test(s)) ? "an" : "a";
    }

    function periodName(snap, index) {
      var p = snap.periodScores[index - 1];
      return p && p.label ? p.label : "P" + index;
    }

    // Lines where the running score moved, with who scored and by how much. Lines without a
    // tally (an app from before D-056) give nothing, and every feature below then stays hidden.
    function scoringPlays(snap) {
      var out = [];
      var prev = snap.truncated ? null : { ours: 0, theirs: 0 };
      for (var i = 0; i < snap.lines.length; i++) {
        var l = snap.lines[i];
        if (l.ours === null || l.theirs === null) return [];
        if (prev && (l.ours !== prev.ours || l.theirs !== prev.theirs)) {
          var dUs = l.ours - prev.ours;
          var dThem = l.theirs - prev.theirs;
          out.push({ line: l, dUs: dUs, dThem: dThem,
                     side: dUs > 0 ? "us" : dThem > 0 ? "opponent" : "" });
        }
        prev = { ours: l.ours, theirs: l.theirs };
      }
      return out;
    }

    // ---- celebrations ----
    function celebrationWord(sport, play, setWon) {
      if (setWon) return "SET!";
      var t = play ? play.line.text.toLowerCase() : "";
      var d = play ? Math.max(play.dUs, play.dThem) : 0;
      if (GOAL_SPORTS[sport]) return "GOAL!";
      if (sport === "football") {
        if (t.indexOf("touchdown") >= 0 || / td\b/.test(" " + t)) return "TOUCHDOWN!";
        if (t.indexOf("field goal") >= 0) return "FIELD GOAL!";
        if (t.indexOf("safety") >= 0) return "SAFETY!";
        return d >= 6 ? "TOUCHDOWN!" : d === 3 ? "FIELD GOAL!" : d === 2 ? "TWO POINTS!" : "EXTRA POINT!";
      }
      if (sport === "basketball") return d === 3 ? "THREE!" : d === 1 ? "FREE THROW!" : "BUCKET!";
      if (sport === "baseball" || sport === "softball") {
        if (t.indexOf("home run") >= 0 || t.indexOf("homer") >= 0) return "HOME RUN!";
        return d > 1 ? d + " RUNS SCORE!" : "RUN SCORES!";
      }
      if (t.indexOf("goal") === 0) return "GOAL!";
      return "SCORE!";
    }

    function celebrate(prev, snap, plays) {
      if (!prev || prev.code !== snap.code || !celebration) return;
      var usUp = snap.ourScore > prev.ourScore;
      var themUp = snap.opponentScore > prev.opponentScore;
      var lastPrev = prev.lines.length ? prev.lines[prev.lines.length - 1] : null;
      var newPlays = plays.filter(function (p) {
        return p.side && (!lastPrev || lastPrev.ours === null ||
          p.line.ours + p.line.theirs > lastPrev.ours + lastPrev.theirs);
      });
      var anyNewPoint = newPlays.length > 0 || usUp || themUp;
      if (anyNewPoint) chime();
      if (!usUp && !themUp) return;   // set sports: a point is a chime, a set is a celebration

      // Both changed between polls (a hidden tab, a slow phone): celebrate the latest one.
      var side = usUp && themUp ? (newPlays.length ? newPlays[newPlays.length - 1].side : "us") : (usUp ? "us" : "opponent");
      var mine = newPlays.filter(function (p) { return p.side === side; });
      var play = mine.length ? mine[mine.length - 1] : null;
      var word = celebrationWord(snap.sport, play, !!SET_SPORTS[snap.sport]);
      var team = side === "us" ? snap.teamName : snap.opponentName;

      text(celebrationWordEl, word);
      text(celebrationTeamEl, team);
      celebration.setAttribute("data-side", side);
      celebration.classList.toggle("calm", REDUCED);
      buildConfetti(!REDUCED);
      celebration.classList.remove("go");
      void celebration.offsetWidth;          // restart the animation for back-to-back scores
      celebration.classList.add("go");
      show(celebration, true);
      text(announcer, word.replace(/!$/, "") + ", " + team + ". " + snap.teamName + " " + snap.ourScore +
        ", " + snap.opponentName + " " + snap.opponentScore + ".");
      if (celebrateTimer) clearTimeout(celebrateTimer);
      celebrateTimer = setTimeout(function () {
        show(celebration, false);
        celebration.classList.remove("go");
      }, REDUCED ? 3200 : 2400);
    }

    function buildConfetti(on) {
      var box = celebrationBits;
      if (!box) return;
      box.textContent = "";
      if (!on) return;
      for (var i = 0; i < 22; i++) {
        var bit = document.createElement("i");
        var angle = (i / 22) * Math.PI * 2 + Math.random() * 0.4;
        var dist = 90 + Math.random() * 110;
        bit.style.setProperty("--dx", Math.round(Math.cos(angle) * dist * 1.6) + "px");
        bit.style.setProperty("--dy", Math.round(Math.sin(angle) * dist) + "px");
        bit.style.setProperty("--rot", Math.round(Math.random() * 540 - 270) + "deg");
        bit.style.setProperty("--delay", Math.round(Math.random() * 120) + "ms");
        bit.className = "bit bit-" + (i % 3);
        box.appendChild(bit);
      }
    }

    // ---- sound (Web Audio: a two-note chime, no file to download) ----
    function chime() {
      if (!soundOn || !audio) return;
      try {
        if (audio.state === "suspended") audio.resume();
        var t0 = audio.currentTime + 0.02;
        [[880, 0], [1318.5, 0.13]].forEach(function (n) {
          var osc = audio.createOscillator();
          var gain = audio.createGain();
          osc.type = "sine";
          osc.frequency.value = n[0];
          gain.gain.setValueAtTime(0.0001, t0 + n[1]);
          gain.gain.exponentialRampToValueAtTime(0.22, t0 + n[1] + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n[1] + 0.9);
          osc.connect(gain);
          gain.connect(audio.destination);
          osc.start(t0 + n[1]);
          osc.stop(t0 + n[1] + 0.95);
        });
      } catch (e) { /* no audio on this device: stay quiet */ }
    }

    function setSound(on) {
      soundOn = on;
      if (on && !audio) {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) { try { audio = new Ctx(); } catch (e) { audio = null; } }
      }
      if (soundButton) {
        soundButton.setAttribute("aria-pressed", on ? "true" : "false");
        text(soundLabel, on ? "Sound on" : "Sound off");
      }
      if (on) chime();   // a sample, so the viewer knows what to listen for
    }

    // ---- Player of the Game ----
    // ---- win chance + season notes (D-057) ----
    function renderInsight(snap) {
      var chance = snap.winChance;
      show(wp, !!chance);
      if (chance) {
        text(wpLine, snap.teamName + " " + chance.pct + "% to win");
        if (wpUs) wpUs.style.width = Math.max(2, Math.min(98, chance.pct)) + "%";
        if (wpBar) wpBar.setAttribute("aria-label", snap.teamName + " " + chance.pct + "% to win, " +
          snap.opponentName + " " + (100 - chance.pct) + "%");
        text(wpUsName, snap.teamName);
        text(wpThemName, snap.opponentName);
        drawTrail(chance.trail);
      }
      if (notesList) {
        notesList.textContent = "";
        snap.notes.forEach(function (n) {
          var li = document.createElement("li");
          li.textContent = n;
          notesList.appendChild(li);
        });
      }
      show(notesWrap, snap.notes.length > 0);
      show(insight, !!chance || snap.notes.length > 0);
    }

    function drawTrail(points) {
      if (!wpTrail) return;
      while (wpTrail.firstChild) wpTrail.removeChild(wpTrail.firstChild);
      show(wpTrail, points.length >= 2);
      if (points.length < 2) return;
      var W = 640, H = 80, PAD = 4;
      var x0 = points[0].x, x1 = points[points.length - 1].x;
      var span = Math.max(1, x1 - x0);
      function x(v) { return PAD + ((v - x0) / span) * (W - PAD * 2); }
      function y(v) { return H - PAD - (v / 100) * (H - PAD * 2); }
      var mid = document.createElementNS(SVG_NS, "line");
      mid.setAttribute("x1", PAD); mid.setAttribute("x2", W - PAD);
      mid.setAttribute("y1", y(50)); mid.setAttribute("y2", y(50));
      mid.setAttribute("class", "wp-mid");
      wpTrail.appendChild(mid);
      var d = "";
      points.forEach(function (p, i) { d += (i ? " L" : "M") + x(p.x).toFixed(1) + " " + y(p.y).toFixed(1); });
      var path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", "wp-path");
      wpTrail.appendChild(path);
    }

    function renderPotg(snap) {
      var has = snap.playerOfGame !== "";
      show(potg, has);
      text(potgNum, snap.playerOfGame);
    }

    // ---- momentum ----
    function momentumLines(snap, plays) {
      var out = [];
      if (snap.status !== "inProgress" || !plays.length) return out;
      var sport = snap.sport;

      // Unanswered run, counted back from the latest score (within the current set for set sports).
      var lastPeriod = plays[plays.length - 1].line.period;
      var runSide = "", runPts = 0, runPlays = 0;
      for (var i = plays.length - 1; i >= 0; i--) {
        var p = plays[i];
        if (!p.side) continue;
        if (SET_SPORTS[sport] && p.line.period !== lastPeriod) break;
        if (runSide && p.side !== runSide) break;
        runSide = p.side;
        runPts += p.side === "us" ? p.dUs : p.dThem;
        runPlays += 1;
      }
      var min = RUN_MIN[sport] || 3;
      if (runSide && runPlays >= 2 && runPts >= min) {
        var who = runSide === "us" ? snap.teamName : snap.opponentName;
        out.push(who + " on " + article(runPts) + " " + runPts + "–0 run");
      }

      // Scoreless stretch, from the game clock (cumulative seconds, like every line's clock).
      if (snap.gameSecond !== null && DROUGHT_MIN[sport]) {
        var lastScore = 0;
        var any = false;
        for (var j = plays.length - 1; j >= 0; j--) {
          if (plays[j].side && plays[j].line.clockSecond !== null) { lastScore = plays[j].line.clockSecond; any = true; break; }
        }
        var mins = Math.floor((snap.gameSecond - lastScore) / 60);
        if (mins >= DROUGHT_MIN[sport]) {
          out.push(any ? "No " + unitNoun(sport, 2) + " in " + mins + " minutes"
                       : "No " + unitNoun(sport, 2) + " yet, " + mins + " minutes in");
        }
      }

      // Lead changes, once there have been a couple.
      var leader = 0, changes = 0;
      for (var k = 0; k < plays.length; k++) {
        var l = plays[k].line;
        var now = l.ours > l.theirs ? 1 : l.ours < l.theirs ? -1 : 0;
        if (now !== 0 && leader !== 0 && now !== leader) changes += 1;
        if (now !== 0) leader = now;
      }
      if (changes >= 2 && !SET_SPORTS[sport]) out.push("The lead has changed hands " + changes + " times");
      return out;
    }

    function renderMomentum(snap, plays) {
      var lines = momentumLines(snap, plays);
      var chart = drawFlow(snap, plays);
      show(momentum, lines.length > 0 || chart);
      momentumList.textContent = "";
      lines.forEach(function (s) {
        var li = document.createElement("li");
        li.textContent = s;
        momentumList.appendChild(li);
      });
      show(momentumList, lines.length > 0);
      text(momentumHead, snap.status === "final" ? "How it went" : "Momentum");
    }

    // A small step chart of the score through the game. Clock sports: x is the game clock.
    // Others: x is each scoring play in turn. Set sports have no running total worth drawing.
    function drawFlow(snap, plays) {
      show(flowWrap, false);
      if (!flow || SET_SPORTS[snap.sport] || plays.length === 0) return false;
      while (flow.firstChild) flow.removeChild(flow.firstChild);

      var W = 640, H = 170, PAD = 8;
      var clocked = snap.gameSecond !== null || plays.every(function (p) { return p.line.clockSecond !== null; });
      if (snap.status === "final") clocked = plays.every(function (p) { return p.line.clockSecond !== null; });
      var endX = 0;
      if (clocked) {
        snap.lines.forEach(function (l) { if (l.clockSecond !== null) endX = Math.max(endX, l.clockSecond); });
        if (snap.gameSecond !== null) endX = Math.max(endX, snap.gameSecond);
      } else {
        endX = plays.length;
      }
      endX = Math.max(endX, 1);
      var top = 1;
      plays.forEach(function (p) { top = Math.max(top, p.line.ours, p.line.theirs); });
      var first = plays[0].line;
      var start = { ours: first.ours - Math.max(0, plays[0].dUs), theirs: first.theirs - Math.max(0, plays[0].dThem) };

      function x(v) { return PAD + (v / endX) * (W - PAD * 2); }
      function y(v) { return H - PAD - (v / top) * (H - PAD * 2); }

      // Period boundaries, faint, from the "Start of …" lines.
      if (clocked) {
        snap.lines.forEach(function (l) {
          if (l.period > 1 && l.clockSecond !== null && /^Start of /.test(l.text)) {
            var g = document.createElementNS(SVG_NS, "line");
            g.setAttribute("x1", x(l.clockSecond)); g.setAttribute("x2", x(l.clockSecond));
            g.setAttribute("y1", PAD); g.setAttribute("y2", H - PAD);
            g.setAttribute("class", "flow-period");
            flow.appendChild(g);
          }
        });
      }
      var base = document.createElementNS(SVG_NS, "line");
      base.setAttribute("x1", PAD); base.setAttribute("x2", W - PAD);
      base.setAttribute("y1", y(0)); base.setAttribute("y2", y(0));
      base.setAttribute("class", "flow-base");
      flow.appendChild(base);

      ["theirs", "ours"].forEach(function (key) {
        var cur = start[key];
        var d = "M" + x(0).toFixed(1) + " " + y(cur).toFixed(1);
        plays.forEach(function (p, i) {
          var px = x(clocked ? p.line.clockSecond : i + 1);
          d += " H" + px.toFixed(1) + " V" + y(p.line[key]).toFixed(1);
          cur = p.line[key];
        });
        d += " H" + x(endX).toFixed(1);
        var path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        path.setAttribute("class", key === "ours" ? "flow-us" : "flow-them");
        flow.appendChild(path);
      });

      var last = plays[plays.length - 1].line;
      flow.setAttribute("aria-label", "Score through the game. " + snap.teamName + " " + last.ours + ", " +
        snap.opponentName + " " + last.theirs + (snap.truncated ? ", starting partway through." : "."));
      text(flowUs, snap.teamName);
      text(flowThem, snap.opponentName);
      text(flowStart, !clocked ? "First score" : snap.sport === "basketball" ? "Tip-off"
        : snap.sport === "iceHockey" ? "Puck drop" : "Start");
      text(flowEnd, snap.status === "final" ? "Final" : "Now");
      show(flowWrap, true);
      return true;
    }

    // ---- final card ----
    function renderFinal(snap, plays) {
      var isFinal = snap.status === "final";
      show(finalCard, isFinal);
      if (!isFinal) return;

      text(finalOurName, snap.teamName);
      text(finalOppName, snap.opponentName);
      text(finalOurScore, String(snap.ourScore));
      text(finalOppScore, String(snap.opponentScore));
      var result = snap.ourScore > snap.opponentScore ? snap.teamName + " win"
        : snap.ourScore < snap.opponentScore ? snap.opponentName + " win" : "Tied";
      if (SET_SPORTS[snap.sport]) result += " " + Math.max(snap.ourScore, snap.opponentScore) + "–" + Math.min(snap.ourScore, snap.opponentScore);
      text(finalResult, result);

      // Score by period.
      finalTable.textContent = "";
      var hasPeriods = snap.periodScores.length > 0;
      show(finalTableWrap, hasPeriods);
      if (hasPeriods) {
        var head = document.createElement("tr");
        var corner = document.createElement("th");
        corner.scope = "col";
        corner.className = "sr-only-cell";
        corner.textContent = "Team";
        head.appendChild(corner);
        snap.periodScores.forEach(function (p) {
          var th = document.createElement("th");
          th.scope = "col";
          th.textContent = p.label;
          head.appendChild(th);
        });
        var tot = document.createElement("th");
        tot.scope = "col";
        tot.textContent = SET_SPORTS[snap.sport] ? "Sets" : "T";
        head.appendChild(tot);
        var thead = document.createElement("thead");
        thead.appendChild(head);
        finalTable.appendChild(thead);
        var body = document.createElement("tbody");
        [["us", snap.teamName, snap.ourScore], ["opponent", snap.opponentName, snap.opponentScore]].forEach(function (row) {
          var tr = document.createElement("tr");
          tr.setAttribute("data-side", row[0]);
          var th = document.createElement("th");
          th.scope = "row";
          th.textContent = row[1];
          tr.appendChild(th);
          snap.periodScores.forEach(function (p) {
            var td = document.createElement("td");
            td.textContent = String(row[0] === "us" ? p.ours : p.theirs);
            tr.appendChild(td);
          });
          var t = document.createElement("td");
          t.className = "total";
          t.textContent = String(row[2]);
          tr.appendChild(t);
          body.appendChild(tr);
        });
        finalTable.appendChild(body);
      }

      // Scoring plays, oldest first, as the game happened.
      finalPlays.textContent = "";
      var scoring = plays.filter(function (p) { return p.side; });
      if (!scoring.length && plays.length === 0) {
        // No tally (an older app): fall back to the lines that name a score.
        scoring = snap.lines.filter(function (l) { return /^(GOAL|Own goal)|\(\+\d+\)$/.test(l.text); })
          .map(function (l) { return { line: l, side: l.side }; });
      }
      show(finalPlaysWrap, scoring.length > 0 && !SET_SPORTS[snap.sport]);
      scoring.forEach(function (p) {
        var l = p.line;
        var li = document.createElement("li");
        li.setAttribute("data-side", p.side || "neutral");
        var when = document.createElement("span");
        when.className = "play-when";
        var bits = [];
        if (l.period !== null) bits.push(periodName(snap, l.period));
        if (l.clockSecond !== null && l.clockSecond >= 0) bits.push(formatClock(l.clockSecond));
        when.textContent = bits.join(" · ");
        var what = document.createElement("span");
        what.className = "play-text";
        what.textContent = l.text;
        li.appendChild(when);
        li.appendChild(what);
        if (l.ours !== null && l.ours !== undefined) {
          var sc = document.createElement("span");
          sc.className = "final-running";
          sc.textContent = l.ours + "–" + l.theirs;
          li.appendChild(sc);
        }
        finalPlays.appendChild(li);
      });

      show(finalPotg, snap.playerOfGame !== "");
      text(finalPotgNum, snap.playerOfGame);
    }

    // ---- share the score: a PNG made on this device ----
    function fitText(ctx, value, max) {
      var s = value;
      if (ctx.measureText(s).width <= max) return s;
      while (s.length > 1 && ctx.measureText(s + "…").width > max) s = s.slice(0, -1);
      return s + "…";
    }

    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function shareCanvas(snap) {
      var W = 1200, H = 630;
      var c = document.createElement("canvas");
      c.width = W; c.height = H;
      var ctx = c.getContext("2d");
      var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

      var bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#14233e");
      bg.addColorStop(1, "#070d19");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#22b36c";
      ctx.fillRect(0, 0, W, 8);

      // Status pill.
      var isFinal = snap.status === "final";
      var status = isFinal ? "FINAL" : snap.status === "scheduled" ? "NOT STARTED" : "LIVE";
      var detail = "";
      if (!isFinal && snap.status === "inProgress") {
        detail = snap.periodLabel;
        if (snap.clockSecond !== null && snap.clockSecond >= 0) detail += (detail ? "  ·  " : "") + formatClock(snap.clockSecond);
      }
      ctx.font = "800 26px " + FONT;
      var pillW = ctx.measureText(status).width + 44;
      ctx.fillStyle = isFinal ? "#1f3050" : "#22b36c";
      roundRect(ctx, 64, 56, pillW, 50, 25);
      ctx.fill();
      ctx.fillStyle = isFinal ? "#e9eef7" : "#03140b";
      ctx.textBaseline = "middle";
      ctx.fillText(status, 86, 82);
      if (detail) {
        ctx.font = "700 28px " + FONT;
        ctx.fillStyle = "#9aa9c3";
        ctx.fillText(fitText(ctx, detail, W - 64 - pillW - 100), 64 + pillW + 22, 82);
      }

      // Teams and scores.
      ctx.textAlign = "center";
      [[W * 0.27, snap.teamName, snap.ourScore], [W * 0.73, snap.opponentName, snap.opponentScore]].forEach(function (s) {
        ctx.font = "700 40px " + FONT;
        ctx.fillStyle = "#9aa9c3";
        ctx.fillText(fitText(ctx, s[1], 470), s[0], 196);
        ctx.font = "800 190px " + FONT;
        ctx.fillStyle = "#ffffff";
        ctx.fillText(String(s[2]), s[0], 340);
      });
      ctx.font = "800 90px " + FONT;
      ctx.fillStyle = "#1f3050";
      ctx.fillText("–", W / 2, 330);

      if (isFinal && snap.playerOfGame) {
        ctx.font = "700 30px " + FONT;
        ctx.fillStyle = "#f2c14e";
        ctx.fillText("★ Player of the Game " + snap.playerOfGame, W / 2, 470);
      }

      // The small Lockerbook mark.
      ctx.textAlign = "left";
      var markX = 64;
      if (iconImage && iconImage.complete && iconImage.naturalWidth) {
        ctx.save();
        roundRect(ctx, 64, 530, 52, 52, 12);
        ctx.clip();
        ctx.drawImage(iconImage, 64, 530, 52, 52);
        ctx.restore();
        markX = 132;
      }
      ctx.font = "800 28px " + FONT;
      ctx.fillStyle = "#e9eef7";
      ctx.fillText("Lockerbook", markX, 547);
      ctx.font = "500 20px " + FONT;
      ctx.fillStyle = "#9aa9c3";
      ctx.fillText("Every stat. Every sport. One book.", markX, 574);
      ctx.textAlign = "right";
      ctx.font = "700 26px " + FONT;
      ctx.fillStyle = "#5fd39a";
      ctx.fillText("lockerbook.app", W - 64, 556);
      return c;
    }

    // Synchronous, so the share sheet opens inside the tap (Safari needs that).
    function canvasBlob(c) {
      var url = c.toDataURL("image/png");
      var bin = atob(url.split(",")[1]);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: "image/png" });
    }

    function shareScore() {
      var snap = lastSnapshot;
      if (!snap) return;
      var blob;
      try { blob = canvasBlob(shareCanvas(snap)); } catch (e) {
        text(shareNote, "This browser couldn't make the image.");
        return;
      }
      var name = "lockerbook-score.png";
      // The code and link stay out on purpose: a picture posted publicly shouldn't hand
      // strangers the family link.
      var caption = snap.teamName + " " + snap.ourScore + ", " + snap.opponentName + " " + snap.opponentScore +
        (snap.status === "final" ? " (Final)" : "") + " — kept with Lockerbook, lockerbook.app";
      var file = null;
      try { file = new File([blob], name, { type: "image/png" }); } catch (e) {}
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], text: caption }).catch(function () { /* closed the sheet */ });
        text(shareNote, "");
        return;
      }
      var href = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = href;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(href); }, 4000);
      text(shareNote, "Saved " + name + ". Text it or post it from your photos or downloads.");
    }

    function renderExtras(prev, snap) {
      if (OVERLAY) return;
      var plays = scoringPlays(snap);
      celebrate(prev, snap, plays);
      renderPotg(snap);
      renderInsight(snap);
      renderMomentum(snap, plays);
      renderFinal(snap, plays);
      text(shareButtonLabel, snap.status === "final" ? "Share the final" : "Share the score");
    }

    function hideExtras() {
      show(celebration, false);
      show(momentum, false);
      show(finalCard, false);
      show(potg, false);
      show(insight, false);
      text(shareNote, "");
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
      hideBug();
      hideExtras();
      if (OVERLAY) {
        // A Browser Source has nobody to retype the code: stay transparent and keep asking, in
        // case the coach switches the link on (or back on) later.
        clearTimer();
        if (code && !document.hidden) timer = setTimeout(poll, INTERVAL.scheduled);
        return;
      }
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
      if (!OVERLAY) {
        try {
          var url = window.location.pathname + "?g=" + encodeURIComponent(code);
          window.history.replaceState(null, "", url);
        } catch (e) { /* file:// and old browsers */ }
      }
      failures = 0;
      lastSnapshot = null;
      bugLastText = "";
      hideBug();
      hideExtras();
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
      hideBug();
      hideExtras();
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

    if (soundButton) soundButton.addEventListener("click", function () { setSound(!soundOn); });
    if (shareButton) shareButton.addEventListener("click", shareScore);

    // ---- boot ----
    if (OVERLAY && bug) {
      // Only the bug is drawn: move it out of the page into its own stage on <body>; the CSS for
      // html.lb-overlay hides everything else and makes the background transparent.
      stage = document.createElement("div");
      stage.className = "bug-stage";
      stage.hidden = true;
      stage.appendChild(bug);
      document.body.appendChild(stage);
    }

    if (!CONFIGURED) {
      show(offline, true);
      show(intro, false);
      show(form, false);
      setConnection("idle", "Not switched on");
      return;
    }

    ticker = setInterval(tick, 1000);
    if (!OVERLAY) {
      iconImage = new Image();              // same origin; drawn small on the share image
      iconImage.src = "/assets/icon-512.png";
    }
    setConnection("idle", "Not connected");

    var params = new URLSearchParams(window.location.search);
    var fromUrl = normalizeCode(params.get("g") || params.get("code") || "");
    var remembered = "";
    try { remembered = normalizeCode(localStorage.getItem(STORAGE_KEY) || ""); } catch (e) {}

    if (fromUrl) {
      start(fromUrl, !OVERLAY);
    } else if (remembered && input && !OVERLAY) {
      input.value = remembered;
    }
  }
})();
