/*
 * PizzaPal Bot (version 2): chat flow, pricing, address lookup, payment and usability logging.
 * Load order: js/config.js, js/addresses.js, then this file.
 *
 * Page options (add to the end of the address):
 *   ?tester   tester tools: results table, exports, valid-address list, Restart
 *   ?memory   remember the customer between orders ("Welcome back, reorder?"), off by default
 *   ?local    skip the live address service and use the built-in list of 50 addresses
 *
 * Prices and fees are near the top. The Geoapify key goes in js/config.js.
 */
(function () {
  "use strict";

  // ===========================================================================
  // Settings
  // ===========================================================================
  var CFG = window.PIZZAPAL_CONFIG || {};

  var SIZES = [
    { id: "small", label: "Small", price: 8.99 },
    { id: "medium", label: "Medium", price: 11.99 },
    { id: "large", label: "Large", price: 14.99 }
  ];
  var CRUSTS = [
    { id: "hand", label: "Hand-Tossed", surcharge: 0 },
    { id: "thin", label: "Thin & Crispy", surcharge: 0 },
    { id: "gf", label: "Gluten-Free", surcharge: 1.5 }
  ];
  var TOPPINGS = [
    "Pepperoni", "Sausage", "Bacon", "Ham", "Chicken", "Mushroom",
    "Green Pepper", "Onion", "Pineapple", "Black Olives", "Artichokes",
    "Spinach", "Tomato", "Jalapeño", "Anchovies", "Feta", "Extra Cheese"
  ];
  // Words people type for each topping (lowercase). Used when someone gives several answers in one message.
  var TOPPING_WORDS = [
    ["Pepperoni", ["pepperoni", "pepperonis"]],
    ["Sausage", ["sausage", "sausages"]],
    ["Bacon", ["bacon"]],
    ["Ham", ["ham"]],
    ["Chicken", ["chicken"]],
    ["Mushroom", ["mushroom", "mushrooms"]],
    ["Green Pepper", ["green pepper", "green peppers", "peppers", "pepper"]],
    ["Onion", ["onion", "onions"]],
    ["Pineapple", ["pineapple"]],
    ["Black Olives", ["black olives", "black olive", "olives", "olive"]],
    ["Artichokes", ["artichokes", "artichoke"]],
    ["Spinach", ["spinach"]],
    ["Tomato", ["tomato", "tomatoes"]],
    ["Jalapeño", ["jalapeño", "jalapeños", "jalapeno", "jalapenos"]],
    ["Anchovies", ["anchovies", "anchovy"]],
    ["Feta", ["feta"]],
    ["Extra Cheese", ["extra cheese", "double cheese"]]
  ];
  // Toppings marked with a star in the chat. They cost more once the included toppings are used up.
  var PREMIUM_TOPPINGS = ["Extra Cheese", "Feta", "Mushroom", "Bacon", "Chicken", "Artichokes"];
  var INCLUDED_TOPPINGS = 3;    // first 3 toppings are part of the base price
  var EXTRA_STANDARD = 0.30;    // each topping after the first 3
  var EXTRA_PREMIUM = 0.60;     // each premium topping after the first 3
  var DELIVERY_FEE = 2.99;      // flat fee
  var HST_RATE = 0.13;          // Ontario HST, charged on the pizza and the delivery fee (not on the tip)
  var TIP_OPTIONS = [0, 0.10, 0.15, 0.20];   // share of the pizza subtotal
  var SHOW_ADDRESS_PICKER = true;   // show address suggestions under the address question
  var TYPING_MS = 550;              // how long the "typing" dots show before each bot message

  // Page options
  function hasFlag(name) { return new RegExp("[?&]" + name + "(=|&|$)").test(window.location.search); }
  var TESTER = hasFlag("tester");
  var MEMORY_ON = hasFlag("memory");
  var FORCE_LOCAL = hasFlag("local");

  // ===========================================================================
  // Usability logging. One record per run, kept in the browser (localStorage).
  //   completed : 1 if the order was placed, else 0
  //   timeSec   : first tap or message -> order placed, capped at 300 (300 if not completed)
  //   errors    : red error messages, capped at 10
  //   S         : screens (steps) visited, repeats included. A question answered ahead of time
  //               (for example "large thin crust" in one message) still counts as visited.
  //   N         : different screens visited
  //   R         : fewest screens needed to finish (8)
  // On top of that each run keeps an event log: when each step started, taps vs typing,
  // error types, back/help use and how long address lookups took.
  // ===========================================================================
  var STORE_KEY = "pizzapal.results.v2";
  var CUSTOMER_KEY = "pizzapal.customer.v1";
  var REQUIRED_STEPS = 8;   // size, crust, toppings, name, street, apartment, summary, payment
  var TIME_CAP = 300;       // seconds
  var ERROR_CAP = 10;
  var EVENT_CAP = 600;
  var COUNTED_STEPS = ["size", "crust", "toppings", "name", "street", "street-confirm", "apt", "confirm", "pay"];
  var HISTORY_STEPS = ["size", "crust", "toppings", "name", "street", "apt", "confirm", "pay"];   // steps Back can return to
  var SUBSTEP_PARENT = { "street-confirm": "street", "pay-card": "pay" };
  var STEP_COLUMNS = ["size", "crust", "toppings", "name", "street", "apt", "confirm", "pay"];

  var session = null;
  var memStore = [];        // used only if the browser blocks localStorage
  var storageOK = true;
  var resultsBody = null, emptyMsg = null, exportMsg = null, storageWarn = null;

  function loadSessions() {
    if (!storageOK) return memStore;
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      storageOK = false;
      return memStore;
    }
  }

  function saveSessions(list) {
    memStore = list;
    if (!storageOK) return;
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(list));
    } catch (e) {
      storageOK = false;
    }
  }

  function distinctCount(arr) {
    var seen = {}, n = 0;
    arr.forEach(function (v) { if (!seen[v]) { seen[v] = true; n++; } });
    return n;
  }

  // Lostness L = sqrt((N/S - 1)^2 + (R/N - 1)^2). Same formula as the results spreadsheet.
  function lostness(S, N, R) {
    if (!(S > 0 && N > 0)) return null;
    return Math.sqrt(Math.pow(N / S - 1, 2) + Math.pow(R / N - 1, 2));
  }

  function newSession() {
    session = { t0: 0, visits: [], events: [], saved: false, reorder: false };
  }

  // The clock starts at the participant's first tap or message.
  function noteActivity() {
    if (session && !session.t0) session.t0 = Date.now();
  }

  function logEvent(type, data) {
    if (!session || session.events.length >= EVENT_CAP) return;
    var e = { ms: session.t0 ? Date.now() - session.t0 : 0, type: type };
    if (data) Object.keys(data).forEach(function (k) { e[k] = data[k]; });
    session.events.push(e);
  }

  // Counts a screen as visited. "how" says why: flow (shown), multi (answered ahead), memory (reorder), back.
  function countVisit(step, how) {
    if (!session || COUNTED_STEPS.indexOf(step) === -1) return;
    session.visits.push(step);
    logEvent("step", { step: step, via: how || "flow" });
    updateStats();
  }

  var history = [];             // snapshots, so Back can restore the order as it was before each question
  var lastEnteredStep = "";
  var consecutiveErrors = 0;
  var flowToken = 0;            // bumped whenever the flow is reset or goes back, so late bot messages are dropped

  function snapshot() { return JSON.parse(JSON.stringify(state)); }

  function pushHistory(step) {
    var top = history[history.length - 1];
    if (top && top.step === step) { top.snap = snapshot(); return; }
    history.push({ step: step, snap: snapshot() });
  }

  // Moves the chat to a new step, and counts the screen if it is one of the study's screens.
  function enter(step, how) {
    state.step = step;
    if (step !== lastEnteredStep) consecutiveErrors = 0;
    lastEnteredStep = step;
    if (HISTORY_STEPS.indexOf(step) > -1) pushHistory(step);
    countVisit(step, how);
    updateBar();
  }

  // Saves the run once. Runs nobody touched are ignored.
  function finishSession(completed) {
    if (!session || session.saved || !session.t0) return;
    session.saved = true;
    var endMs = Date.now() - session.t0;
    var elapsed = Math.round(endMs / 1000);
    var ev = session.events;

    var taps = 0, typed = 0, backs = 0, helps = 0, multi = 0;
    var errorKinds = {}, addrMs = [], sources = {};
    ev.forEach(function (e) {
      if (e.type === "input") { if (e.method === "tap") taps++; else typed++; }
      else if (e.type === "nav") { if (e.action === "back") backs++; else if (e.action === "help") helps++; }
      else if (e.type === "error") { errorKinds[e.kind] = (errorKinds[e.kind] || 0) + 1; }
      else if (e.type === "address") { sources[e.source] = true; if (e.ok !== false && e.ms != null) addrMs.push(e.ms); }
      else if (e.type === "multi") { multi++; }
    });

    // Time spent on each screen: from when it appeared until the next screen appeared.
    var raw = {};
    var steps = ev.filter(function (e) { return e.type === "step"; });
    steps.forEach(function (e, i) {
      var end = i + 1 < steps.length ? steps[i + 1].ms : endMs;
      var key = e.step === "street-confirm" ? "street" : e.step;
      raw[key] = (raw[key] || 0) + Math.max(0, end - e.ms) / 1000;
    });
    var stepSec = {};
    Object.keys(raw).forEach(function (k) { stepSec[k] = Math.round(raw[k] * 10) / 10; });

    var list = loadSessions().slice();
    var maxId = 0;
    list.forEach(function (r) { if (r.id > maxId) maxId = r.id; });
    list.push({
      id: maxId + 1,
      version: 2,
      completed: completed ? 1 : 0,
      timeSec: completed ? Math.min(elapsed, TIME_CAP) : TIME_CAP,
      rawSec: elapsed,
      errors: Math.min(errorCount, ERROR_CAP),
      rawErrors: errorCount,
      S: session.visits.length,
      N: distinctCount(session.visits),
      R: REQUIRED_STEPS,
      naturalness: "",
      notes: "",
      when: new Date().toISOString(),
      taps: taps,
      typed: typed,
      backs: backs,
      helps: helps,
      multi: multi,
      errorKinds: errorKinds,
      addressSources: Object.keys(sources).join("+"),
      addressMs: addrMs.length ? Math.round(addrMs.reduce(function (a, b) { return a + b; }, 0) / addrMs.length) : "",
      memory: MEMORY_ON ? (session.reorder ? "reorder" : "on") : "off",
      stepSec: stepSec,
      events: ev
    });
    saveSessions(list);
    renderResults();
  }

  function updateStats() {
    var el = document.getElementById("testStats");
    if (!el || !session) return;
    var v = session.visits;
    el.textContent = "Current run: bot turns " + turnCount + " · errors " + errorCount +
      " · invalid addresses " + invalidAddressCount + " · steps S " + v.length +
      " · different steps N " + distinctCount(v);
    var api = document.getElementById("apiStatus");
    if (api) api.textContent = "Address lookup: " + AddressService.mode() + ". Memory: " + (MEMORY_ON ? "on" : "off") + ".";
  }

  // --- Export helpers ---
  function toTSV(list) {
    // Columns A to G of the results spreadsheet. Column H (lostness) is a formula there, so it is left out.
    return list.map(function (r) {
      return [r.id, r.completed, r.timeSec, r.errors, r.S, r.N, r.R].join("\t");
    }).join("\n");
  }

  function csvCell(v) {
    var s = String(v == null ? "" : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function errorKindsText(obj) {
    return Object.keys(obj || {}).map(function (k) { return k + ":" + obj[k]; }).join("; ");
  }

  function toCSV(list) {
    var head = ["Participant", "Completed (1/0)", "Time (s)", "Errors", "S", "N", "R", "Lostness",
      "Naturalness (1-5)", "Notes", "Logged at",
      "Taps", "Typed", "Back uses", "Help uses", "Multi-answer messages", "Error types",
      "Address lookup", "Avg lookup (ms)", "Memory"];
    STEP_COLUMNS.forEach(function (s) { head.push("Seconds on " + s); });
    var rows = [head];
    list.forEach(function (r) {
      var L = lostness(r.S, r.N, r.R);
      var row = [r.id, r.completed, r.timeSec, r.errors, r.S, r.N, r.R,
        L == null ? "" : L.toFixed(3), r.naturalness, r.notes, r.when,
        r.taps, r.typed, r.backs, r.helps, r.multi, errorKindsText(r.errorKinds),
        r.addressSources, r.addressMs, r.memory];
      STEP_COLUMNS.forEach(function (s) { row.push(r.stepSec && r.stepSec[s] != null ? r.stepSec[s] : ""); });
      rows.push(row);
    });
    return rows.map(function (row) { return row.map(csvCell).join(","); }).join("\r\n");
  }

  function dateStamp() {
    var d = new Date();
    function p(n) { return n < 10 ? "0" + n : "" + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function downloadText(text, filename, type) {
    var blob = new Blob(["﻿" + text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function copyText(text, done) {
    function fallback() {
      var ta = document.getElementById("copyBox");
      ta.hidden = false;
      ta.value = text;
      ta.focus();
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      if (ok) ta.hidden = true;
      done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else {
      fallback();
    }
  }

  function setExportMsg(text) {
    if (exportMsg) exportMsg.textContent = text;
  }

  // A button that needs two taps (first tap asks, second tap does it).
  function confirmTap(btn, idleText, askText, action) {
    var timer = null;
    btn.textContent = idleText;
    btn.addEventListener("click", function () {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        btn.textContent = idleText;
        btn.classList.remove("armed");
        action();
        return;
      }
      btn.textContent = askText;
      btn.classList.add("armed");
      timer = setTimeout(function () {
        timer = null;
        btn.textContent = idleText;
        btn.classList.remove("armed");
      }, 4000);
    });
  }

  function updateRecord(id, field, value) {
    var list = loadSessions().slice();
    list.forEach(function (r) { if (r.id === id) r[field] = value; });
    saveSessions(list);
  }

  function deleteRecord(id) {
    saveSessions(loadSessions().filter(function (r) { return r.id !== id; }));
    renderResults();
  }

  function renderResults() {
    if (!resultsBody) return;
    var list = loadSessions();
    resultsBody.innerHTML = "";
    emptyMsg.hidden = list.length > 0;
    storageWarn.hidden = storageOK;
    list.forEach(function (r) {
      var tr = document.createElement("tr");
      var L = lostness(r.S, r.N, r.R);
      [r.id, r.completed, r.timeSec, r.errors, r.S, r.N, r.R, L == null ? "" : L.toFixed(3)].forEach(function (v) {
        var td = document.createElement("td");
        td.textContent = v;
        tr.appendChild(td);
      });

      var tdNat = document.createElement("td");
      var nat = document.createElement("input");
      nat.type = "number"; nat.min = "1"; nat.max = "5"; nat.step = "1";
      nat.className = "cellInput narrow";
      nat.value = r.naturalness;
      nat.setAttribute("aria-label", "Naturalness rating for participant " + r.id);
      nat.addEventListener("change", function () { updateRecord(r.id, "naturalness", nat.value); });
      tdNat.appendChild(nat);
      tr.appendChild(tdNat);

      var tdNotes = document.createElement("td");
      var notes = document.createElement("input");
      notes.type = "text";
      notes.className = "cellInput wide";
      notes.value = r.notes;
      notes.setAttribute("aria-label", "Notes for participant " + r.id);
      notes.addEventListener("change", function () { updateRecord(r.id, "notes", notes.value); });
      tdNotes.appendChild(notes);
      tr.appendChild(tdNotes);

      var tdDel = document.createElement("td");
      var del = document.createElement("button");
      del.type = "button";
      del.className = "rowDelete";
      del.setAttribute("aria-label", "Delete participant " + r.id);
      confirmTap(del, "✕", "Sure?", function () { deleteRecord(r.id); });
      tdDel.appendChild(del);
      tr.appendChild(tdDel);

      resultsBody.appendChild(tr);
    });
  }

  // ===========================================================================
  // Address service: live lookup (Geoapify) with the built-in list as a fallback
  // ===========================================================================
  var AddressService = (function () {
    var KEY = String(CFG.geoapifyKey || "").trim();
    var downUntil = 0;

    function live() { return !!KEY && !FORCE_LOCAL && Date.now() > downUntil; }

    function mode() {
      if (!KEY) return "built-in list (no Geoapify key set)";
      if (FORCE_LOCAL) return "built-in list (?local)";
      if (Date.now() <= downUntil) return "built-in list (live lookup failed, retrying soon)";
      return "Geoapify (live)";
    }

    // Keeps only deliverable results: a house number, a street, in Brampton.
    function mapResult(f) {
      var num = f.housenumber;
      var street = f.street;
      if (!num || !street) return null;
      var city = String(f.city || f.town || f.village || "");
      if (city.toLowerCase() !== "brampton") return null;
      return {
        street: num + " " + street,
        city: "Brampton",
        province: "ON",
        postal: f.postcode || "",
        confidence: f.rank ? f.rank.confidence : 0,
        matchType: f.rank ? f.rank.match_type : ""
      };
    }

    function fetchApi(text) {
      var url = "https://api.geoapify.com/v1/geocode/autocomplete?text=" + encodeURIComponent(text) +
        "&filter=rect:-79.88,43.58,-79.60,43.86&bias=proximity:-79.7624,43.7315" +
        "&lang=en&limit=6&format=json&apiKey=" + encodeURIComponent(KEY);
      var request = fetch(url).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (j) {
        var out = [], seen = {};
        (j.results || []).forEach(function (f) {
          var rec = mapResult(f);
          if (rec && !seen[rec.street]) { seen[rec.street] = true; out.push(rec); }
        });
        return out;
      });
      var timeout = new Promise(function (resolve, reject) {
        setTimeout(function () { reject(new Error("timeout")); }, 4000);
      });
      return Promise.race([request, timeout]);
    }

    function localSearch(text) {
      var q = AddressBackend.normalize(text);
      if (!q) return AddressBackend.all();
      return AddressBackend.all().filter(function (r) { return AddressBackend.normalize(r.street).indexOf(q) > -1; });
    }

    function markDown() { downUntil = Date.now() + 30000; }

    // Suggestions while the person is typing.
    function search(text) {
      if (!live()) return Promise.resolve({ items: localSearch(text), source: "local" });
      return fetchApi(text).then(
        function (items) { return { items: items, source: "geoapify" }; },
        function () {
          markDown();
          logEvent("address", { source: "geoapify", ok: false, kind: "suggest" });
          return { items: localSearch(text), source: "local-fallback" };
        }
      );
    }

    function localResolve(text, started, source) {
      var rec = AddressBackend.lookup(text);
      var res;
      if (rec) {
        res = { status: "ok", rec: rec };
      } else {
        var near = AddressBackend.suggest(text);
        res = near ? { status: "near", rec: near } : { status: "none" };
      }
      res.source = source;
      res.ms = Date.now() - started;
      logEvent("address", { source: source, ms: res.ms, ok: true, result: res.status });
      return res;
    }

    // Final check of what the person sent: ok (accept), near ("did you mean"), or none (not deliverable).
    function resolve(text) {
      var started = Date.now();
      if (!live()) return Promise.resolve(localResolve(text, started, "local"));
      return fetchApi(text).then(
        function (items) {
          var top = items[0];
          var res;
          if (!top) {
            res = { status: "none" };
          } else if (AddressBackend.normalize(top.street) === AddressBackend.normalize(text) ||
                     (top.confidence >= 0.95 && top.matchType === "full_match")) {
            res = { status: "ok", rec: top };
          } else {
            res = { status: "near", rec: top };
          }
          res.source = "geoapify";
          res.ms = Date.now() - started;
          logEvent("address", { source: "geoapify", ms: res.ms, ok: true, result: res.status });
          return res;
        },
        function () {
          markDown();
          logEvent("address", { source: "geoapify", ms: Date.now() - started, ok: false, kind: "resolve" });
          return localResolve(text, started, "local-fallback");
        }
      );
    }

    return { live: live, mode: mode, search: search, resolve: resolve };
  })();

  // ===========================================================================
  // Page elements and conversation state
  // ===========================================================================
  var log = document.getElementById("log");
  var form = document.getElementById("composer");
  var input = document.getElementById("textInput");
  var restartBtn = document.getElementById("restartBtn");
  var backBtn = document.getElementById("backBtn");
  var helpBtn = document.getElementById("helpBtn");
  var orderBtn = document.getElementById("orderBtn");

  var state, turnCount = 0, errorCount = 0, invalidAddressCount = 0;
  var pendingFocus = false;          // true after a keyboard activation, so the next question gets focus
  var currentToppingsDone = null;    // what "Done adding toppings" does right now

  function freshState() {
    return {
      step: "greet",
      size: null,
      crust: null,
      toppings: [],
      name: "",
      street: "",
      apt: "",
      city: "",
      postal: "",
      tipPct: 0,
      badAddressAttempts: 0
    };
  }

  function botIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="M3 10L12 4l9 6-1.3 1.6L12 7 4.3 11.6 3 10Z" fill="currentColor"/><path d="M5 12l7 4 7-4-1 7.5a1 1 0 0 1-.6.8L12 22l-5.4-1.7a1 1 0 0 1-.6-.8L5 12Z" fill="currentColor" opacity="0.85"/></svg>';
  }

  function now() {
    var d = new Date();
    var h = d.getHours(), m = d.getMinutes();
    var ampm = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    return h + ":" + (m < 10 ? "0" + m : m) + " " + ampm;
  }

  function scrollToEnd() {
    requestAnimationFrame(function () { log.scrollTop = log.scrollHeight; });
  }

  function clearTrailingInteractives() {
    var stale = log.querySelectorAll(".quickReplies, .toppingPanel, .addressPanel, .tipPanel");
    stale.forEach(function (el) { el.remove(); });
  }

  // Gives keyboard focus to the first control of a new question, but only when the person is using the keyboard.
  function maybeFocus(el) {
    if (!pendingFocus || !el) return;
    pendingFocus = false;
    try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  function srOnly(text) {
    var s = document.createElement("span");
    s.className = "srOnly";
    s.textContent = text;
    return s;
  }

  // method: "tap" or "typed". keep: leave the current answer buttons on screen.
  function addUserMessage(text, method, keep) {
    noteActivity();
    if (!keep) clearTrailingInteractives();
    logEvent("input", { method: method || "typed", step: state ? state.step : "" });
    var row = document.createElement("div");
    row.className = "row user";
    var wrap = document.createElement("div");
    wrap.className = "bubbleWrap";
    var bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.appendChild(srOnly("You: "));
    bubble.appendChild(document.createTextNode(text));
    var ts = document.createElement("div");
    ts.className = "timestamp";
    ts.setAttribute("aria-hidden", "true");
    ts.textContent = "You · " + now();
    wrap.appendChild(bubble);
    wrap.appendChild(ts);
    row.appendChild(wrap);
    log.appendChild(row);
    scrollToEnd();
  }

  function createTypingRow() {
    var row = document.createElement("div");
    row.className = "row bot typing";
    row.setAttribute("aria-hidden", "true");
    var av = document.createElement("div");
    av.className = "avatar";
    av.innerHTML = botIcon();
    var wrap = document.createElement("div");
    wrap.className = "bubbleWrap";
    var bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    wrap.appendChild(bubble);
    row.appendChild(av);
    row.appendChild(wrap);
    log.appendChild(row);
    scrollToEnd();
    return row;
  }

  function showTyping(cb, delay) {
    var tok = flowToken;
    var row = createTypingRow();
    setTimeout(function () {
      row.remove();
      if (tok !== flowToken) return;
      cb();
    }, delay || TYPING_MS);
  }

  // Shows the typing dots while a promise settles (at least as long as a normal bot pause), then continues.
  function thinking(makePromise, cb) {
    var tok = flowToken;
    var started = Date.now();
    var row = createTypingRow();
    makePromise().then(function (res) {
      var wait = Math.max(0, TYPING_MS - (Date.now() - started));
      setTimeout(function () {
        row.remove();
        if (tok !== flowToken) return;
        cb(res);
      }, wait);
    });
  }

  function addBotMessage(text) {
    var row = document.createElement("div");
    row.className = "row bot";
    var av = document.createElement("div");
    av.className = "avatar";
    av.innerHTML = botIcon();
    var wrap = document.createElement("div");
    wrap.className = "bubbleWrap";
    var bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.appendChild(srOnly("PizzaPal Bot: "));
    bubble.appendChild(document.createTextNode(text));
    var ts = document.createElement("div");
    ts.className = "timestamp";
    ts.setAttribute("aria-hidden", "true");
    ts.textContent = "PizzaPal Bot · " + now();
    wrap.appendChild(bubble);
    wrap.appendChild(ts);
    row.appendChild(av);
    row.appendChild(wrap);
    log.appendChild(row);
    scrollToEnd();
  }

  function botSay(text, after) {
    turnCount++;
    updateStats();
    showTyping(function () {
      addBotMessage(text);
      if (after) after();
    });
  }

  function addQuickReplies(options, onPick) {
    var container = document.createElement("div");
    container.className = "quickReplies";
    container.setAttribute("role", "group");
    container.setAttribute("aria-label", "Answer options");
    options.forEach(function (opt) {
      var btn = document.createElement("button");
      btn.className = "chip";
      btn.type = "button";
      btn.textContent = opt.label;
      btn.addEventListener("click", function (e) {
        pendingFocus = e.detail === 0;   // 0 means it was pressed with the keyboard
        var all = container.querySelectorAll(".chip");
        all.forEach(function (c) { c.disabled = true; });
        addUserMessage(opt.label, "tap");
        onPick(opt);
      });
      container.appendChild(btn);
    });
    log.appendChild(container);
    scrollToEnd();
    maybeFocus(container.querySelector(".chip"));
  }

  function fmtMoney(n) {
    return "$" + n.toFixed(2);
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  // Charge for toppings beyond the included ones, in the order the customer picked them.
  function toppingTotal() {
    var charge = 0;
    state.toppings.forEach(function (t, i) {
      if (i >= INCLUDED_TOPPINGS) {
        charge += PREMIUM_TOPPINGS.indexOf(t) > -1 ? EXTRA_PREMIUM : EXTRA_STANDARD;
      }
    });
    return charge;
  }

  // Pizza price: size + crust + extra toppings.
  function orderTotal() {
    var sizeObj = SIZES.find(function (s) { return s.id === state.size; });
    var crustObj = CRUSTS.find(function (c) { return c.id === state.crust; });
    return round2((sizeObj ? sizeObj.price : 0) + (crustObj ? crustObj.surcharge : 0) + toppingTotal());
  }

  // Everything the customer pays: pizza, delivery fee, HST on both, then the optional tip.
  function totals() {
    var sub = orderTotal();
    var fee = DELIVERY_FEE;
    var hst = round2((sub + fee) * HST_RATE);
    var tip = round2(sub * (state.tipPct || 0));
    return { sub: sub, fee: fee, hst: hst, tip: tip, total: round2(sub + fee + hst + tip) };
  }

  // --- Step: toppings (multi-select panel). Used for the first pass and for Modify > Toppings. ---
  function renderToppingsPanel(onDone) {
    currentToppingsDone = onDone;
    var panel = document.createElement("div");
    panel.className = "toppingPanel";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "Toppings");

    var counter = document.createElement("div");
    counter.className = "counterLine";
    counter.setAttribute("aria-live", "polite");
    panel.appendChild(counter);

    var grid = document.createElement("div");
    grid.className = "toppingGrid";
    panel.appendChild(grid);

    var note = document.createElement("div");
    note.className = "counterLine";
    note.textContent = "★ = premium. First " + INCLUDED_TOPPINGS + " toppings are included. After that: " +
      fmtMoney(EXTRA_STANDARD) + " each, or " + fmtMoney(EXTRA_PREMIUM) + " for premium.";
    panel.appendChild(note);

    var doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.className = "doneBtn";
    doneBtn.textContent = "Done adding toppings";
    panel.appendChild(doneBtn);

    function refresh() {
      var n = state.toppings.length;
      counter.textContent = "Toppings selected: " + n + " (" + INCLUDED_TOPPINGS + " included)" +
        (n > INCLUDED_TOPPINGS ? " · Extra charge: " + fmtMoney(toppingTotal()) : "");
      var focusName = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.topping : null;
      grid.innerHTML = "";
      TOPPINGS.forEach(function (name) {
        var chip = document.createElement("button");
        var selected = state.toppings.indexOf(name) > -1;
        chip.type = "button";
        chip.className = "chip" + (selected ? " selected" : "");
        chip.dataset.topping = name;
        chip.setAttribute("aria-pressed", String(selected));
        chip.textContent = name + (PREMIUM_TOPPINGS.indexOf(name) > -1 ? " ★" : "");

        // Business rule from the spec: no Extra Cheese on Large.
        if (name === "Extra Cheese" && state.size === "large" && !selected) {
          chip.disabled = true;
          chip.title = "Extra Cheese isn't available on Large pizzas";
        }

        chip.addEventListener("click", function () {
          var idx = state.toppings.indexOf(name);
          if (idx > -1) {
            state.toppings.splice(idx, 1);
          } else {
            state.toppings.push(name);
          }
          refresh();
        });
        grid.appendChild(chip);
        if (focusName === name) { try { chip.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      });
    }

    doneBtn.addEventListener("click", function (e) {
      pendingFocus = e.detail === 0;
      panel.remove();
      var summary = state.toppings.length ? state.toppings.join(", ") : "No extra toppings";
      addUserMessage(summary, "tap");
      onDone();
    });

    refresh();
    log.appendChild(panel);
    scrollToEnd();
    maybeFocus(grid.querySelector(".chip:not([disabled])"));
  }

  // kind says what went wrong, for the usability log:
  //   input (didn't understand), invalid-address, address-near-miss, card, rule (a menu rule)
  function addSystemError(text, kind) {
    errorCount++;
    consecutiveErrors++;
    logEvent("error", { kind: kind || "input", step: state ? state.step : "" });
    updateStats();
    var shown = text;
    if (consecutiveErrors === 2) shown += " Stuck? Tap Help for tips, or Back to return to the previous question.";
    var row = document.createElement("div");
    row.className = "row bot";
    var av = document.createElement("div");
    av.className = "avatar";
    av.innerHTML = botIcon();
    var wrap = document.createElement("div");
    wrap.className = "bubbleWrap";
    var bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.style.color = "var(--danger)";
    bubble.appendChild(srOnly("Error: "));
    bubble.appendChild(document.createTextNode(shown));
    wrap.appendChild(bubble);
    row.appendChild(av);
    row.appendChild(wrap);
    log.appendChild(row);
    scrollToEnd();
  }

  // ===========================================================================
  // Address suggestions under the address question
  // ===========================================================================
  var suggestSeq = 0;
  var suggestTimer = null;

  function addressPanel() { return log.querySelector(".addressPanel"); }

  function fillSuggestions(panel, items, emptyText) {
    var grid = panel.querySelector(".addressGrid");
    var status = panel.querySelector(".addressStatus");
    grid.innerHTML = "";
    items.forEach(function (rec) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = rec.street;
      chip.addEventListener("click", function (e) {
        pendingFocus = e.detail === 0;
        suggestSeq++;
        addUserMessage(rec.street, "tap");   // also removes this panel
        acceptAddress(rec);
      });
      grid.appendChild(chip);
    });
    status.textContent = items.length
      ? items.length + (items.length === 1 ? " suggestion" : " suggestions")
      : (emptyText || "");
  }

  function showAddressPicker() {
    if (!SHOW_ADDRESS_PICKER) return;
    var panel = document.createElement("div");
    panel.className = "addressPanel";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "Address suggestions");

    var title = document.createElement("div");
    title.className = "counterLine";
    panel.appendChild(title);

    var grid = document.createElement("div");
    grid.className = "addressGrid";
    panel.appendChild(grid);

    var status = document.createElement("div");
    status.className = "counterLine addressStatus";
    status.setAttribute("aria-live", "polite");
    panel.appendChild(status);

    log.appendChild(panel);
    scrollToEnd();

    if (AddressService.live()) {
      title.textContent = "Start typing your address, then tap a suggestion.";
      status.textContent = "";
      if (input.value.trim().length >= 3) updateSuggestions(input.value);
    } else {
      title.textContent = "Test addresses: tap one, or type your own.";
      AddressService.search("").then(function (r) { fillSuggestions(panel, r.items, ""); });
    }
  }

  function updateSuggestions(q) {
    var panel = addressPanel();
    if (!panel) return;
    var seq = ++suggestSeq;
    var live = AddressService.live();
    if (live && q.trim().length < 3) {
      fillSuggestions(panel, [], "");
      return;
    }
    AddressService.search(q).then(function (r) {
      if (seq !== suggestSeq || !addressPanel()) return;
      var wasLive = r.source === "geoapify";
      fillSuggestions(panel, r.items, wasLive
        ? "No matching Brampton address yet. Keep typing the house number and street."
        : "No matching address in the list.");
    });
  }

  // ===========================================================================
  // Conversation flow
  // ===========================================================================
  function startFlow() {
    finishSession(false);   // a run that was left unfinished counts as not completed
    flowToken++;
    state = freshState();
    history = [];
    lastEnteredStep = "";
    consecutiveErrors = 0;
    turnCount = 0; errorCount = 0; invalidAddressCount = 0;
    newSession();
    updateStats();
    updateBar();
    log.innerHTML = "";

    var saved = MEMORY_ON ? loadCustomer() : null;
    if (saved) {
      botSay("Welcome back, " + saved.name + "! 👋 Want your usual (" + describeUsual(saved) + ") delivered to " + saved.street + "?", function () {
        state.step = "welcome";
        updateBar();
        addQuickReplies([{ id: "reorder", label: "Yes, reorder" }, { id: "new", label: "Start a new order" }], function (opt) {
          if (opt.id === "reorder") {
            session.reorder = true;
            state.size = saved.size; state.crust = saved.crust; state.toppings = saved.toppings.slice();
            state.name = saved.name; state.street = saved.street; state.city = saved.city;
            state.postal = saved.postal; state.apt = saved.apt || "";
            ["size", "crust", "toppings", "name", "street", "apt"].forEach(function (s) { countVisit(s, "memory"); });
            showOrderSummary();
          } else {
            askSize("No problem! What size would you like today?");
          }
        });
      });
      return;
    }

    askSize("Hi, I'm the PizzaPal Bot! 👋 Welcome. Let's build your perfect pizza. What size would you like today?");
  }

  function dropExtraCheeseIfLarge(announce) {
    if (state.size === "large" && state.toppings.indexOf("Extra Cheese") > -1) {
      state.toppings = state.toppings.filter(function (t) { return t !== "Extra Cheese"; });
      if (announce) addSystemError("Extra Cheese isn't available on Large pizzas, so I left it off your order.", "rule");
    }
  }

  function askSize(text) {
    botSay(text, function () {
      enter("size");
      addQuickReplies(SIZES.map(function (s) { return { id: s.id, label: s.label }; }), function (opt) {
        state.size = opt.id;
        dropExtraCheeseIfLarge(false);
        goToCrust();
      });
    });
  }

  function askCrust(text) {
    botSay(text, function () {
      enter("crust");
      addQuickReplies(CRUSTS.map(function (c) { return { id: c.id, label: c.label }; }), function (opt) {
        state.crust = opt.id;
        goToToppings();
      });
    });
  }

  function goToCrust() {
    askCrust("Great, a " + labelFor(SIZES, state.size).toLowerCase() + "! What kind of crust do you prefer?");
  }

  function goToToppings() {
    botSay("Awesome choice, " + labelFor(CRUSTS, state.crust) + ". 🍕 Now for the fun part: toppings! Your first " + INCLUDED_TOPPINGS + " are included. Each extra topping after that is " + fmtMoney(EXTRA_STANDARD) + ", or " + fmtMoney(EXTRA_PREMIUM) + " for premium ones (marked ★). Tap what you'd like, then hit Done.", function () {
      enter("toppings");
      renderToppingsPanel(goToAddressName);
    });
  }

  function goToAddressName() {
    if (state.name) {   // already given in an earlier message, or kept when the pizza was reset
      countVisit("name", "multi");
      goToStreet();
      return;
    }
    botSay("Got it! Pepperoni jokes aside, let's get this delivered — what name should I put on the order?", function () {
      enter("name");
    });
  }

  function goToStreet() {
    botSay("Thanks, " + state.name + "! What's your delivery street address? (House number and street name.)", function () {
      enter("street");
      showAddressPicker();
    });
  }

  // Checks the typed address. Valid: accept. Close: "did you mean". Otherwise say so and ask again.
  function handleStreetInput(text) {
    suggestSeq++;
    thinking(function () { return AddressService.resolve(text); }, function (res) {
      if (res.status === "ok") {
        acceptAddress(res.rec);
        return;
      }

      state.badAddressAttempts++;
      invalidAddressCount++;

      if (res.status === "near") {
        var near = res.rec;
        enter("street-confirm");
        addSystemError("Sorry, I couldn't find that address.", "address-near-miss");
        botSay("Did you mean " + near.street + ", " + near.city + "?", function () {
          addQuickReplies(
            [{ id: "yes", label: "Yes, that's it" }, { id: "no", label: "No, enter again" }],
            function (opt) {
              if (opt.id === "yes") {
                acceptAddress(near);
              } else {
                askStreetAgain();
              }
            }
          );
        });
        return;
      }

      addSystemError("Sorry, that's not a valid address in our Brampton delivery area.", "invalid-address");
      askStreetAgain();
    });
  }

  function askStreetAgain() {
    var hint = "";
    if (state.badAddressAttempts >= 2) {
      hint = AddressService.live() ? " Start typing and pick one of the suggestions." : " For example: " + AddressBackend.sample().street + ".";
    }
    botSay("Please enter your street address again (house number and street name)." + hint, function () {
      enter("street");
      showAddressPicker();
    });
  }

  function acceptAddress(rec) {
    state.street = rec.street;
    state.city = rec.city;
    state.postal = rec.postal;
    state.badAddressAttempts = 0;
    botSay("Found it ✓ " + rec.street + ", " + rec.city + ", " + rec.province + (rec.postal ? " " + rec.postal : "") + ".", function () {
      goToApt();
    });
  }

  function goToApt() {
    botSay("Do you have an apartment or unit number? (Type it, or tap Skip if none.)", function () {
      enter("apt");
      addQuickReplies([{ id: "skip", label: "Skip" }], function () {
        state.apt = "";
        showOrderSummary();
      });
    });
  }

  function labelFor(list, id) {
    var found = list.find(function (x) { return x.id === id; });
    return found ? found.label : "";
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // The order card. Also used for "My order" part-way through, so blank parts show a dash.
  function buildOrderCard(title) {
    var sizeLabel = labelFor(SIZES, state.size);
    var crustLabel = labelFor(CRUSTS, state.crust);
    var toppingsLabel = state.toppings.length ? state.toppings.join(", ") : (state.crust ? "None" : "");
    var addr = state.street ? state.street + (state.apt ? " Apt " + state.apt : "") + ", " + state.city + (state.postal ? ", " + state.postal : "") : "";
    var extraCount = Math.max(0, state.toppings.length - INCLUDED_TOPPINGS);
    function dash(v) { return v ? escapeHtml(v) : "&mdash;"; }

    var html = "<h2>" + escapeHtml(title) + "</h2><dl>" +
      "<dt>Name</dt><dd>" + dash(state.name) + "</dd>" +
      "<dt>Address</dt><dd>" + dash(addr) + "</dd>" +
      "<dt>Size</dt><dd>" + dash(sizeLabel) + "</dd>" +
      "<dt>Crust</dt><dd>" + dash(crustLabel) + "</dd>" +
      "<dt>Toppings</dt><dd>" + dash(toppingsLabel) + "</dd>";
    if (extraCount) html += "<dt>Extra toppings</dt><dd>" + extraCount + " extra, +" + fmtMoney(toppingTotal()) + "</dd>";
    if (state.size) {
      var t = totals();
      html += "<dt>Pizza</dt><dd>" + fmtMoney(t.sub) + "</dd>" +
        "<dt>Delivery fee</dt><dd>" + fmtMoney(t.fee) + "</dd>" +
        "<dt>HST (" + Math.round(HST_RATE * 100) + "%)</dt><dd>" + fmtMoney(t.hst) + "</dd>";
      if (t.tip) html += "<dt>Tip</dt><dd>" + fmtMoney(t.tip) + "</dd>";
      html += "</dl><div class=\"total\">Total " + fmtMoney(t.total) + "</div>";
    } else {
      html += "</dl>";
    }

    var card = document.createElement("div");
    card.className = "orderCard";
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", title);
    card.innerHTML = html;
    return card;
  }

  function showOrderSummary() {
    enter("confirm");
    botSay("Here's your order — does everything look right?", function () {
      log.appendChild(buildOrderCard("Order Summary"));
      scrollToEnd();

      addQuickReplies(
        [{ id: "confirm", label: "Confirm ✓" }, { id: "modify", label: "Modify Order" }],
        function (opt) {
          if (opt.id === "confirm") {
            goToPayment();
          } else {
            offerModifyOptions();
          }
        }
      );
    });
  }

  function offerModifyOptions() {
    botSay("No problem — what would you like to change?", function () {
      addQuickReplies(
        [
          { id: "size", label: "Size" },
          { id: "crust", label: "Crust" },
          { id: "toppings", label: "Toppings" },
          { id: "address", label: "Address" }
        ],
        function (opt) {
          if (opt.id === "size") {
            botSay("Sure! What size would you like instead?", function () {
              enter("size");
              addQuickReplies(SIZES.map(function (s) { return { id: s.id, label: s.label }; }), function (o) {
                state.size = o.id;
                dropExtraCheeseIfLarge(true);
                showOrderSummary();
              });
            });
          } else if (opt.id === "crust") {
            botSay("What crust would you like instead?", function () {
              enter("crust");
              addQuickReplies(CRUSTS.map(function (c) { return { id: c.id, label: c.label }; }), function (o) {
                state.crust = o.id;
                showOrderSummary();
              });
            });
          } else if (opt.id === "toppings") {
            state.toppings = [];
            botSay("Let's redo the toppings. The first " + INCLUDED_TOPPINGS + " are included; extras are " + fmtMoney(EXTRA_STANDARD) + " (" + fmtMoney(EXTRA_PREMIUM) + " for ★ premium).", function () {
              enter("toppings");
              renderToppingsPanel(showOrderSummary);
            });
          } else {
            botSay("Sure, let's redo the address. What name should I put on the order?", function () {
              enter("name");
            });
          }
        }
      );
    });
  }

  // ===========================================================================
  // Payment (mock). Nothing is charged, sent or stored. Only the format is checked.
  // ===========================================================================
  // Returns an error message, or "" if the card details look fine.
  function cardProblem(numberText, expiryText, cvvText) {
    var digits = numberText.replace(/\D/g, "");
    if (digits.length !== 16) return "The card number should have 16 digits.";
    var m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(expiryText.trim());
    if (!m || +m[1] < 1 || +m[1] > 12) return "Please enter the expiry date as MM/YY, for example 12/30.";
    var d = new Date();
    var year = 2000 + (+m[2]);
    var expired = year < d.getFullYear() || (year === d.getFullYear() && (+m[1]) < d.getMonth() + 1);
    if (expired) return "That card has expired. Please use a future expiry date.";
    if (!/^\d{3}$/.test(cvvText.trim())) return "The security code (CVV) is 3 digits.";
    return "";
  }

  function renderTipPanel() {
    var panel = document.createElement("div");
    panel.className = "tipPanel";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "Tip for your driver, optional");

    var title = document.createElement("div");
    title.className = "counterLine";
    title.textContent = "Add a tip for your driver? (Optional)";
    panel.appendChild(title);

    var row = document.createElement("div");
    row.className = "tipRow";
    panel.appendChild(row);

    var totalLine = document.createElement("div");
    totalLine.className = "totalLine";
    totalLine.setAttribute("aria-live", "polite");
    panel.appendChild(totalLine);

    function refresh() {
      row.innerHTML = "";
      TIP_OPTIONS.forEach(function (pct) {
        var chip = document.createElement("button");
        chip.type = "button";
        var selected = (state.tipPct || 0) === pct;
        chip.className = "chip" + (selected ? " selected" : "");
        chip.setAttribute("aria-pressed", String(selected));
        chip.textContent = pct === 0 ? "No tip" : Math.round(pct * 100) + "% (" + fmtMoney(round2(orderTotal() * pct)) + ")";
        chip.addEventListener("click", function () {
          state.tipPct = pct;
          refresh();
          var again = row.querySelectorAll(".chip")[TIP_OPTIONS.indexOf(pct)];
          if (again) { try { again.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
        });
        row.appendChild(chip);
      });
      var t = totals();
      totalLine.textContent = "Total " + fmtMoney(t.total) +
        " (pizza " + fmtMoney(t.sub) + ", delivery " + fmtMoney(t.fee) + ", HST " + fmtMoney(t.hst) +
        (t.tip ? ", tip " + fmtMoney(t.tip) : "") + ")";
    }
    refresh();
    log.appendChild(panel);
    scrollToEnd();
  }

  function askPaymentMethod(text) {
    botSay(text, function () {
      enter("pay");
      renderTipPanel();
      addQuickReplies(
        [{ id: "card", label: "Pay by card" }, { id: "cash", label: "Pay on delivery" }],
        function (opt) {
          if (opt.id === "card") {
            botSay("Enter your card details below. This is a test checkout, so any card number will work.", showCardForm);
          } else {
            botSay("No problem, you'll pay when your pizza arrives.", function () {
              placeOrder("Pay on delivery");
            });
          }
        }
      );
    });
  }

  function goToPayment() {
    askPaymentMethod("Almost done! Add a tip if you like, then choose how to pay.");
  }

  function showCardForm() {
    enter("pay-card");   // same payment screen, so it is not counted again
    var panel = document.createElement("div");
    panel.className = "cardPanel";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "Card details");

    var note = document.createElement("div");
    note.className = "counterLine";
    note.textContent = "Test payment only. Any 16-digit number, any future expiry and any 3-digit code will work. Please don't enter a real card.";
    panel.appendChild(note);

    function field(label, attrs) {
      var wrap = document.createElement("label");
      wrap.textContent = label;
      var inp = document.createElement("input");
      inp.type = "text";
      inp.autocomplete = "off";
      Object.keys(attrs).forEach(function (k) { inp.setAttribute(k, attrs[k]); });
      wrap.appendChild(inp);
      return { wrap: wrap, input: inp };
    }
    var num = field("Card number", { inputmode: "numeric", maxlength: "19", placeholder: "1234 5678 9012 3456" });
    var exp = field("Expiry (MM/YY)", { inputmode: "numeric", maxlength: "5", placeholder: "MM/YY" });
    var cvv = field("CVV", { inputmode: "numeric", maxlength: "3", placeholder: "123" });
    panel.appendChild(num.wrap);
    var row = document.createElement("div");
    row.className = "cardRow";
    row.appendChild(exp.wrap);
    row.appendChild(cvv.wrap);
    panel.appendChild(row);

    num.input.addEventListener("input", function () {
      var d = num.input.value.replace(/\D/g, "").slice(0, 16);
      num.input.value = d.replace(/(.{4})/g, "$1 ").trim();
    });
    exp.input.addEventListener("input", function () {
      var d = exp.input.value.replace(/\D/g, "").slice(0, 4);
      exp.input.value = d.length > 2 ? d.slice(0, 2) + "/" + d.slice(2) : d;
    });
    cvv.input.addEventListener("input", function () {
      cvv.input.value = cvv.input.value.replace(/\D/g, "").slice(0, 3);
    });

    var actions = document.createElement("div");
    actions.className = "cardActions";
    var payBtn = document.createElement("button");
    payBtn.type = "button";
    payBtn.className = "doneBtn";
    payBtn.textContent = "Pay " + fmtMoney(totals().total);
    var changeBtn = document.createElement("button");
    changeBtn.type = "button";
    changeBtn.className = "linkBtn";
    changeBtn.textContent = "Change payment method";
    actions.appendChild(payBtn);
    actions.appendChild(changeBtn);
    panel.appendChild(actions);

    payBtn.addEventListener("click", function () {
      noteActivity();
      var problem = cardProblem(num.input.value, exp.input.value, cvv.input.value);
      if (problem) {
        addSystemError(problem, "card");
        return;
      }
      var last4 = num.input.value.replace(/\D/g, "").slice(-4);
      panel.remove();
      addUserMessage("Card ending " + last4, "tap");
      botSay("Processing your payment…", function () {
        placeOrder("Card ending " + last4);
      });
    });
    changeBtn.addEventListener("click", function () {
      panel.remove();
      addUserMessage("Change payment method", "tap");
      askPaymentMethod("Sure, how would you like to pay?");
    });

    log.appendChild(panel);
    scrollToEnd();
    num.input.focus();
  }

  function placeOrder(payLabel) {
    finishSession(true);
    var t = totals();
    var orderId = "PZA-" + Math.floor(10000 + Math.random() * 89999);
    var eta = (18 + Math.floor(Math.random() * 15)) + " min";
    saveCustomer();
    botSay(
      "Thank you! 🎉 Your order has been placed.\nOrder ID: " + orderId +
      "\nEstimated time: " + eta +
      "\nPizza: " + fmtMoney(t.sub) +
      "\nDelivery fee: " + fmtMoney(t.fee) +
      "\nHST (" + Math.round(HST_RATE * 100) + "%): " + fmtMoney(t.hst) +
      (t.tip ? "\nTip: " + fmtMoney(t.tip) : "") +
      "\nTotal: " + fmtMoney(t.total) +
      "\nPayment: " + (payLabel || "Pay on delivery") +
      "\n\nSee you soon, " + state.name + "!",
      function () {
        state.step = "done";
        updateBar();
        addQuickReplies([{ id: "restart", label: "Start a new order" }], function () {
          startFlow();
        });
      }
    );
  }

  // ===========================================================================
  // Order memory (only with ?memory): the last customer, kept in this browser
  // ===========================================================================
  function loadCustomer() {
    try {
      var raw = window.localStorage.getItem(CUSTOMER_KEY);
      var c = raw ? JSON.parse(raw) : null;
      return c && c.name && c.street && c.size && c.crust && Array.isArray(c.toppings) ? c : null;
    } catch (e) {
      return null;
    }
  }

  function saveCustomer() {
    if (!MEMORY_ON) return;
    try {
      window.localStorage.setItem(CUSTOMER_KEY, JSON.stringify({
        name: state.name, street: state.street, city: state.city, postal: state.postal, apt: state.apt,
        size: state.size, crust: state.crust, toppings: state.toppings
      }));
    } catch (e) { /* storage blocked: memory simply won't work */ }
  }

  function clearCustomer() {
    try { window.localStorage.removeItem(CUSTOMER_KEY); } catch (e) { /* ignore */ }
  }

  function describeUsual(c) {
    var tops = c.toppings.length ? c.toppings.join(", ") : "no extra toppings";
    return labelFor(SIZES, c.size).toLowerCase() + ", " + labelFor(CRUSTS, c.crust).toLowerCase() + ", " + tops;
  }

  // ===========================================================================
  // Several answers in one message ("large pepperoni on thin crust")
  // ===========================================================================
  function parseOrder(text) {
    var lower = text.toLowerCase();
    var out = { size: null, crust: null, toppings: [], name: "" };

    var sm = /(?:^|[^a-z])(small|medium|large)(?![a-z])/.exec(lower);
    if (sm) out.size = sm[1];

    if (/gluten[\s-]?free|(?:^|[^a-z])gf(?![a-z])/.test(lower)) out.crust = "gf";
    else if (/hand[\s-]?tossed/.test(lower)) out.crust = "hand";
    else if (/(?:^|[^a-z])thin(?![a-z])/.test(lower)) out.crust = "thin";

    var found = [];
    TOPPING_WORDS.forEach(function (entry) {
      var best = -1;
      entry[1].forEach(function (word) {
        var re = new RegExp("(?:^|[^a-zñ])(" + word + ")(?![a-zñ])", "g");
        var m;
        while ((m = re.exec(lower)) !== null) {
          var idx = m.index + m[0].indexOf(m[1]);
          var before = lower.slice(Math.max(0, idx - 14), idx);
          var negated = /(?:^|[^a-z])(?:no|without|hold the|skip|not|except)\s+(?:the\s+|any\s+)?$/.test(before);
          if (!negated && (best === -1 || idx < best)) best = idx;
        }
      });
      if (best > -1) found.push({ idx: best, name: entry[0] });
    });
    found.sort(function (a, b) { return a.idx - b.idx; });
    found.forEach(function (f) { if (out.toppings.indexOf(f.name) === -1) out.toppings.push(f.name); });

    var nm = /(?:my name is|name is|name's)\s+([a-z][a-z'\-]*(?:\s[a-z][a-z'\-]*)?)/i.exec(text);
    if (nm) out.name = nm[1].replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    return out;
  }

  // Applies what was found and returns readable pieces for the "Got it" message.
  function applyParsed(p) {
    var parts = [];
    if (p.size) { state.size = p.size; parts.push(labelFor(SIZES, p.size)); }
    if (p.crust) { state.crust = p.crust; parts.push(labelFor(CRUSTS, p.crust)); }
    if (p.toppings.length) {
      p.toppings.forEach(function (t) { if (state.toppings.indexOf(t) === -1) state.toppings.push(t); });
      parts.push(p.toppings.join(" + "));
    }
    if (p.name) { state.name = p.name; parts.push("name " + p.name); }
    dropExtraCheeseIfLarge(true);
    return parts;
  }

  // Handles a typed message at the size, crust or toppings step. Returns false if nothing was recognised.
  function handleOrderText(raw, text) {
    var p = parseOrder(text);
    var step = state.step;
    if (!(p.size || p.crust || p.toppings.length || p.name)) return false;

    var onlyOne = [!!p.size, !!p.crust, p.toppings.length > 0, !!p.name].filter(Boolean).length === 1;
    var simple = onlyOne && ((step === "size" && p.size) || (step === "crust" && p.crust));

    addUserMessage(raw, "typed");
    var parts = applyParsed(p);

    if (simple) {
      if (step === "size") goToCrust(); else goToToppings();
      return true;
    }

    logEvent("multi", { step: step });
    var intro = "Got it: " + parts.join(", ") + ".";

    if (!state.size) { askSize(intro + " Which size would you like?"); return true; }
    if (!state.crust) { askCrust(intro + " What kind of crust do you prefer?"); return true; }

    if (step === "size") countVisit("crust", "multi");   // crust was answered ahead of its screen

    if (step === "toppings") {
      var done = currentToppingsDone || goToAddressName;
      botSay(intro + " Adjust the toppings if you like, then tap Done.", function () {
        renderToppingsPanel(done);
      });
    } else {
      botSay(intro + " Adjust the toppings if you like, then tap Done.", function () {
        enter("toppings");
        renderToppingsPanel(goToAddressName);
      });
    }
    return true;
  }

  // ===========================================================================
  // Back, help and "my order" (buttons under the chat, or typed)
  // ===========================================================================
  var HELP_TEXT = {
    size: "Tap Small, Medium or Large, or type it. You can also say several things at once, like “large pepperoni on thin crust”.",
    crust: "Tap a crust, or type it. Gluten-Free costs " + fmtMoney(1.5) + " more. You can also type toppings here, like “thin crust with ham and olives”.",
    toppings: "Tap the toppings you want, then press “Done adding toppings”. The first " + INCLUDED_TOPPINGS + " are included, extra ones cost a little more. You can also type them, like “pepperoni and mushrooms”.",
    name: "Type the name for the order.",
    street: "Start typing your street address (house number and street) and tap a suggestion. We deliver within Brampton only.",
    "street-confirm": "Tap “Yes, that's it” if the address is right, or “No, enter again” to type it again.",
    apt: "Type your apartment or unit number, or tap Skip if you don't have one.",
    confirm: "Check your order. Tap Confirm ✓ to go to payment, or Modify Order to change something.",
    pay: "Choose a tip if you like (optional), then Pay by card or Pay on delivery.",
    "pay-card": "This is a test checkout: any 16-digit number, any future expiry and any 3-digit code will work.",
    welcome: "Tap “Yes, reorder” to repeat your last order, or “Start a new order”.",
    done: "Your order has been placed. Tap “Start a new order” to begin another."
  };

  function updateBar() {
    if (!backBtn || !state) return;
    backBtn.disabled = !canGoBack();
  }

  function canGoBack() {
    if (SUBSTEP_PARENT[state.step]) return true;
    return HISTORY_STEPS.indexOf(state.step) > -1 && history.length > 1;
  }

  function reaskStep(step) {
    if (step === "size") askSize("Sure, what size would you like?");
    else if (step === "crust") goToCrust();
    else if (step === "toppings") goToToppings();
    else if (step === "name") { state.name = ""; goToAddressName(); }
    else if (step === "street") goToStreet();
    else if (step === "apt") goToApt();
    else if (step === "confirm") showOrderSummary();
    else if (step === "pay") goToPayment();
  }

  function goBack(method, label) {
    var can = canGoBack();
    addUserMessage(label || "Back", method, !can);
    logEvent("nav", { action: "back", from: state.step });
    if (!can) {
      botSay(state.step === "done"
        ? "Your order has already been placed. Tap “Start a new order” to begin another."
        : "That's the first question, so there's nothing to go back to.");
      return;
    }
    flowToken++;
    suggestSeq++;
    log.querySelectorAll(".cardPanel").forEach(function (el) { el.remove(); });
    var parent = SUBSTEP_PARENT[state.step];
    if (parent) {
      botSay("No problem, going back.", function () { reaskStep(parent); });
      return;
    }
    history.pop();                    // the question we are leaving
    var prev = history.pop();         // the one we return to (asking it again puts it back)
    state = JSON.parse(JSON.stringify(prev.snap));
    state.step = prev.step;
    lastEnteredStep = "";
    updateBar();
    botSay("No problem, going back.", function () { reaskStep(prev.step); });
  }

  function showHelp(method, label) {
    addUserMessage(label || "Help", method, true);
    logEvent("nav", { action: "help", step: state.step });
    var text = HELP_TEXT[state.step] || "I'll guide you through size, crust, toppings, your name, the delivery address and payment.";
    botSay(text + "\n\nShortcuts: Back, My order, or type “cancel” to cancel the order.");
  }

  function showOrderSoFar(method, label) {
    addUserMessage(label || "My order", method, true);
    logEvent("nav", { action: "order", step: state.step });
    botSay("Here's your order so far.", function () {
      log.appendChild(buildOrderCard("Your order so far"));
      scrollToEnd();
    });
  }

  function startOver() {
    addUserMessage("Start over", "typed");
    logEvent("nav", { action: "startover", step: state.step });
    flowToken++;
    suggestSeq++;
    log.querySelectorAll(".cardPanel").forEach(function (el) { el.remove(); });
    state = freshState();
    history = [];
    lastEnteredStep = "";
    updateBar();
    askSize("Okay, let's start the order over. What size would you like?");
  }

  // ===========================================================================
  // Free-text handling per step
  // ===========================================================================
  function matchFromList(list, text) {
    var lower = text.toLowerCase();
    return list.find(function (item) { return lower.indexOf(item.label.toLowerCase()) > -1 || lower.indexOf(item.id) > -1; });
  }

  var CMD_BACK = /^(back|go back|undo|undo that|previous|previous question)$/i;
  var CMD_HELP = /^(help|help me|\?|i need help|i'm stuck|im stuck)$/i;
  var CMD_ORDER = /^(my order|order|show order|show my order|view order|what'?s in my order|summary)$/i;
  var CMD_START_OVER = /^(start over|start again|restart)$/i;

  function handleFreeText(raw) {
    var text = raw.trim();
    if (!text) return;

    var lower = text.toLowerCase();

    if (CMD_BACK.test(text)) { goBack("typed"); return; }
    if (CMD_HELP.test(text)) { showHelp("typed"); return; }
    if (CMD_ORDER.test(text)) { showOrderSoFar("typed"); return; }
    if (CMD_START_OVER.test(text) && state.step !== "done" && state.step !== "welcome") { startOver(); return; }

    if (lower === "cancel") {
      addUserMessage(raw, "typed");
      finishSession(false);
      flowToken++;
      var openCard = log.querySelector(".cardPanel");   // the card form is not cleared by addUserMessage
      if (openCard) openCard.remove();
      botSay("Order cancelled. No charges were made. Tap below to start fresh whenever you're ready.", function () {
        state.step = "done";
        updateBar();
        addQuickReplies([{ id: "restart", label: "Start a new order" }], function () { startFlow(); });
      });
      return;
    }
    if (lower === "reset" && (state.step === "toppings" || state.step === "confirm")) {
      addUserMessage(raw, "typed");
      state.size = null; state.crust = null; state.toppings = [];
      botSay("Pizza details cleared — your delivery info is still saved. Let's start over with the size.", function () {
        enter("size");
        addQuickReplies(SIZES.map(function (s) { return { id: s.id, label: s.label }; }), function (opt) {
          state.size = opt.id;
          goToCrust();
        });
      });
      return;
    }

    switch (state.step) {
      case "size":
      case "crust":
      case "toppings": {
        if (handleOrderText(raw, text)) break;
        addUserMessage(raw, "typed");
        if (state.step === "size") {
          addSystemError("Sorry, I didn't catch that. Please choose Small, Medium, or Large.");
        } else if (state.step === "crust") {
          addSystemError("I didn't recognize that crust. Try Hand-Tossed, Thin & Crispy, or Gluten-Free.");
        } else {
          addSystemError("I didn't recognize that topping. Tap the toppings above, or type names like “pepperoni and mushrooms”.");
        }
        break;
      }
      case "pay": {
        addUserMessage(raw, "typed", true);
        addSystemError("Please tap Pay by card or Pay on delivery.");
        break;
      }
      case "pay-card": {
        addUserMessage(raw, "typed", true);
        addSystemError("Please fill in the card form above, then tap Pay.", "card");
        break;
      }
      case "name": {
        addUserMessage(raw, "typed");
        state.name = text;
        goToStreet();
        break;
      }
      case "street":
      case "street-confirm": {
        addUserMessage(raw, "typed");
        handleStreetInput(text);
        break;
      }
      case "apt": {
        addUserMessage(raw, "typed");
        state.apt = /^(skip|none|no|n\/a)$/i.test(text) ? "" : text;
        showOrderSummary();
        break;
      }
      default: {
        addUserMessage(raw, "typed");
        addSystemError("I'm not sure what to do with that right now — try the buttons above, or type “cancel” to stop.");
      }
    }
  }

  // Sending does not rely on the browser's form submission, which some windows block.
  // Enter and the arrow button both call send() directly.
  function send() {
    var val = input.value;
    if (!val.trim()) return;
    input.value = "";
    pendingFocus = false;
    suggestSeq++;
    handleFreeText(val);
    input.focus();
  }
  form.addEventListener("submit", function (e) { e.preventDefault(); });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  document.getElementById("sendBtn").addEventListener("click", send);

  // Address suggestions while typing at the address question.
  input.addEventListener("input", function () {
    if (state.step !== "street") return;
    clearTimeout(suggestTimer);
    var q = input.value;
    suggestTimer = setTimeout(function () { updateSuggestions(q); }, 250);
  });

  backBtn.addEventListener("click", function (e) { pendingFocus = false; goBack("tap"); void e; });
  helpBtn.addEventListener("click", function () { showHelp("tap"); });
  orderBtn.addEventListener("click", function () { showOrderSoFar("tap"); });

  // ===========================================================================
  // Tester tools: only available when the page is opened with ?tester
  // ===========================================================================
  function setupTesterTools() {
    var testPanel = document.getElementById("testPanel");
    var testerBtn = document.getElementById("testerBtn");
    var tabResults = document.getElementById("tabResults");
    var tabAddresses = document.getElementById("tabAddresses");
    var paneResults = document.getElementById("paneResults");
    var paneAddresses = document.getElementById("paneAddresses");
    var addressList = document.getElementById("addressList");
    resultsBody = document.getElementById("resultsBody");
    emptyMsg = document.getElementById("emptyMsg");
    exportMsg = document.getElementById("exportMsg");
    storageWarn = document.getElementById("storageWarn");

    testerBtn.hidden = false;
    restartBtn.hidden = false;

    AddressBackend.all().forEach(function (rec) {
      var li = document.createElement("li");
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = rec.street;
      b.addEventListener("click", function () {
        input.value = rec.street;
        input.focus();
      });
      li.appendChild(b);
      addressList.appendChild(li);
    });

    function showTab(name) {
      var isResults = name === "results";
      paneResults.hidden = !isResults;
      paneAddresses.hidden = isResults;
      tabResults.classList.toggle("active", isResults);
      tabAddresses.classList.toggle("active", !isResults);
      tabResults.setAttribute("aria-selected", String(isResults));
      tabAddresses.setAttribute("aria-selected", String(!isResults));
    }
    tabResults.addEventListener("click", function () { showTab("results"); });
    tabAddresses.addEventListener("click", function () { showTab("addresses"); });

    testerBtn.addEventListener("click", function () {
      testPanel.hidden = !testPanel.hidden;
      testerBtn.setAttribute("aria-expanded", String(!testPanel.hidden));
      if (!testPanel.hidden) { setExportMsg(""); renderResults(); updateStats(); }
    });

    document.getElementById("copyBtn").addEventListener("click", function () {
      var list = loadSessions();
      if (!list.length) { setExportMsg("No results to copy yet."); return; }
      copyText(toTSV(list), function (ok) {
        setExportMsg(ok
          ? "Copied " + list.length + " row(s). In the spreadsheet, click cell A2 and paste."
          : "Automatic copy was blocked. The text below is selected: press Ctrl+C (or Cmd+C), then paste into cell A2.");
      });
    });

    document.getElementById("csvBtn").addEventListener("click", function () {
      var list = loadSessions();
      if (!list.length) { setExportMsg("No results to download yet."); return; }
      var name = "pizzapal_results_" + dateStamp() + ".csv";
      downloadText(toCSV(list), name, "text/csv;charset=utf-8");
      setExportMsg("Downloaded " + name + ".");
    });

    document.getElementById("jsonBtn").addEventListener("click", function () {
      var list = loadSessions();
      if (!list.length) { setExportMsg("No results to download yet."); return; }
      var name = "pizzapal_events_" + dateStamp() + ".json";
      downloadText(JSON.stringify(list, null, 2), name, "application/json");
      setExportMsg("Downloaded " + name + " (every run with its full event log).");
    });

    confirmTap(document.getElementById("clearBtn"), "Clear results", "Tap again to delete all", function () {
      saveSessions([]);
      renderResults();
      setExportMsg("All results cleared.");
    });

    confirmTap(document.getElementById("forgetBtn"), "Clear saved customer", "Tap again to confirm", function () {
      clearCustomer();
      setExportMsg("Saved customer cleared. The next ?memory visit starts fresh.");
    });

    // Another tab (the participant's) saved a run: refresh the table.
    window.addEventListener("storage", function (e) {
      if (e.key === STORE_KEY) renderResults();
    });

    renderResults();
  }

  if (TESTER) {
    setupTesterTools();
  } else {
    var panel = document.getElementById("testPanel");
    if (panel) panel.remove();
  }

  restartBtn.addEventListener("click", function () {
    startFlow();
  });

  // Closing or reloading mid-order counts as not completed.
  window.addEventListener("pagehide", function () { finishSession(false); });

  startFlow();
})();