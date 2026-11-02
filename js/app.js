/*
 * PizzaPal Bot: chat flow, topping pricing and address checking.
 * Needs js/addresses.js loaded first (it defines AddressBackend).
 * Prices are near the top: INCLUDED_TOPPINGS, EXTRA_STANDARD, EXTRA_PREMIUM and the SIZES list.
 * Every run is logged for the usability study (completion, time, errors, S, N). Open the page with
 * ?tester on the end of the address to see the results, export them, and use the Restart button.
 */
(function () {
  "use strict";

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
  // Toppings marked with a star in the chat. They cost more once the included toppings are used up.
  var PREMIUM_TOPPINGS = ["Extra Cheese", "Feta", "Mushroom", "Bacon", "Chicken", "Artichokes"];
  var INCLUDED_TOPPINGS = 3;   // first 3 toppings are part of the base price
  var EXTRA_STANDARD = 0.30;   // each topping after the first 3
  var EXTRA_PREMIUM = 0.60;    // each premium topping after the first 3


  // ---------------------------------------------------------------------------
  // Usability logging. One record per run, kept in the browser (localStorage).
  //   completed : 1 if the order was placed, else 0
  //   timeSec   : first tap or message -> "Confirm", capped at 300 (300 if not completed)
  //   errors    : red error messages, capped at 10
  //   S         : screens (steps) visited, repeats included
  //   N         : different screens visited
  //   R         : fewest screens needed to finish (7)
  // ---------------------------------------------------------------------------
  var TESTER = /[?&]tester(=|&|$)/.test(window.location.search);
  var STORE_KEY = "pizzapal.results.v1";
  var REQUIRED_STEPS = 7;   // size, crust, toppings, name, street, apartment, summary
  var TIME_CAP = 300;       // seconds
  var ERROR_CAP = 10;
  var COUNTED_STEPS = ["size", "crust", "toppings", "name", "street", "street-confirm", "apt", "confirm"];

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
    session = { t0: 0, visits: [], saved: false };
  }

  // The clock starts at the participant's first tap or message.
  function noteActivity() {
    if (session && !session.t0) session.t0 = Date.now();
  }

  // Moves the chat to a new step, and counts the screen if it is one of the study's screens.
  function enter(step) {
    state.step = step;
    if (session && COUNTED_STEPS.indexOf(step) > -1) {
      session.visits.push(step);
      updateStats();
    }
  }

  // Saves the run once. Runs nobody touched are ignored.
  function finishSession(completed) {
    if (!session || session.saved || !session.t0) return;
    session.saved = true;
    var elapsed = Math.round((Date.now() - session.t0) / 1000);
    var list = loadSessions().slice();
    var maxId = 0;
    list.forEach(function (r) { if (r.id > maxId) maxId = r.id; });
    list.push({
      id: maxId + 1,
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
      when: new Date().toISOString()
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

  function toCSV(list) {
    var rows = [["Participant", "Completed (1/0)", "Time (s)", "Errors", "S", "N", "R", "Lostness", "Naturalness (1-5)", "Notes", "Logged at"]];
    list.forEach(function (r) {
      var L = lostness(r.S, r.N, r.R);
      rows.push([r.id, r.completed, r.timeSec, r.errors, r.S, r.N, r.R,
        L == null ? "" : L.toFixed(3), r.naturalness, r.notes, r.when]);
    });
    return rows.map(function (row) { return row.map(csvCell).join(","); }).join("\r\n");
  }

  function dateStamp() {
    var d = new Date();
    function p(n) { return n < 10 ? "0" + n : "" + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
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

  var log = document.getElementById("log");
  var form = document.getElementById("composer");
  var input = document.getElementById("textInput");
  var restartBtn = document.getElementById("restartBtn");

  var state, turnCount, errorCount, invalidAddressCount = 0;

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
      badAddressAttempts: 0,
      editingReturnStep: null
    };
  }

  function botIcon() {
    return '<svg viewBox="0 0 24 24" fill="none"><path d="M3 10L12 4l9 6-1.3 1.6L12 7 4.3 11.6 3 10Z" fill="currentColor"/><path d="M5 12l7 4 7-4-1 7.5a1 1 0 0 1-.6.8L12 22l-5.4-1.7a1 1 0 0 1-.6-.8L5 12Z" fill="currentColor" opacity="0.85"/></svg>';
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
    var stale = log.querySelectorAll(".quickReplies, .toppingPanel");
    stale.forEach(function (el) { el.remove(); });
  }

  function addUserMessage(text) {
    noteActivity();
    clearTrailingInteractives();
    var row = document.createElement("div");
    row.className = "row user";
    var wrap = document.createElement("div");
    wrap.className = "bubbleWrap";
    var bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    var ts = document.createElement("div");
    ts.className = "timestamp";
    ts.textContent = "You · " + now();
    wrap.appendChild(bubble);
    wrap.appendChild(ts);
    row.appendChild(wrap);
    log.appendChild(row);
    scrollToEnd();
  }

  function showTyping(cb, delay) {
    var row = document.createElement("div");
    row.className = "row bot typing";
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
    setTimeout(function () {
      row.remove();
      cb();
    }, delay || 550);
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
    bubble.textContent = text;
    var ts = document.createElement("div");
    ts.className = "timestamp";
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
    options.forEach(function (opt) {
      var btn = document.createElement("button");
      btn.className = "chip";
      btn.type = "button";
      btn.textContent = opt.label;
      btn.addEventListener("click", function () {
        var all = container.querySelectorAll(".chip");
        all.forEach(function (c) { c.disabled = true; });
        addUserMessage(opt.label);
        onPick(opt);
      });
      container.appendChild(btn);
    });
    log.appendChild(container);
    scrollToEnd();
  }

  function fmtMoney(n) {
    return "$" + n.toFixed(2);
  }

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

  function orderTotal() {
    var sizeObj = SIZES.find(function (s) { return s.id === state.size; });
    var crustObj = CRUSTS.find(function (c) { return c.id === state.crust; });
    return (sizeObj ? sizeObj.price : 0) + (crustObj ? crustObj.surcharge : 0) + toppingTotal();
  }

  // --- Step: toppings (multi-select panel). Used for the first pass and for Modify > Toppings. ---
  function renderToppingsPanel(onDone) {
    var panel = document.createElement("div");
    panel.className = "toppingPanel";

    var counter = document.createElement("div");
    counter.className = "counterLine";
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
      grid.innerHTML = "";
      TOPPINGS.forEach(function (name) {
        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip" + (state.toppings.indexOf(name) > -1 ? " selected" : "");
        chip.textContent = name + (PREMIUM_TOPPINGS.indexOf(name) > -1 ? " ★" : "");

        // Business rule from the spec: no Extra Cheese on Large.
        if (name === "Extra Cheese" && state.size === "large" && state.toppings.indexOf(name) === -1) {
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
      });
    }

    doneBtn.addEventListener("click", function () {
      panel.remove();
      var summary = state.toppings.length ? state.toppings.join(", ") : "No extra toppings";
      addUserMessage(summary);
      onDone();
    });

    refresh();
    log.appendChild(panel);
    scrollToEnd();
  }

  function addSystemError(text) {
    errorCount++;
    updateStats();
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
    bubble.textContent = text;
    wrap.appendChild(bubble);
    row.appendChild(av);
    row.appendChild(wrap);
    log.appendChild(row);
    scrollToEnd();
  }

  // --- Flow steps ---
  function startFlow() {
    finishSession(false);   // a run that was left unfinished counts as not completed
    state = freshState();
    turnCount = 0; errorCount = 0; invalidAddressCount = 0;
    newSession();
    updateStats();
    log.innerHTML = "";
    botSay("Hi, I'm the PizzaPal Bot! 👋 Welcome. Let's build your perfect pizza. What size would you like today?", function () {
      enter("size");
      addQuickReplies(SIZES.map(function (s) { return { id: s.id, label: s.label }; }), function (opt) {
        state.size = opt.id;
        if (state.size === "large" && state.toppings.indexOf("Extra Cheese") > -1) {
          state.toppings = state.toppings.filter(function (t) { return t !== "Extra Cheese"; });
        }
        goToCrust();
      });
    });
  }

  function goToCrust() {
    botSay("Great, a " + labelFor(SIZES, state.size).toLowerCase() + "! What kind of crust do you prefer?", function () {
      enter("crust");
      addQuickReplies(CRUSTS.map(function (c) { return { id: c.id, label: c.label }; }), function (opt) {
        state.crust = opt.id;
        goToToppings();
      });
    });
  }

  function goToToppings() {
    botSay("Awesome choice, " + labelFor(CRUSTS, state.crust) + ". 🍕 Now for the fun part: toppings! Your first " + INCLUDED_TOPPINGS + " are included. Each extra topping after that is " + fmtMoney(EXTRA_STANDARD) + ", or " + fmtMoney(EXTRA_PREMIUM) + " for premium ones (marked ★). Tap what you'd like, then hit Done.", function () {
      enter("toppings");
      renderToppingsPanel(goToAddressName);
    });
  }

  function goToAddressName() {
    botSay("Got it! Pepperoni jokes aside, let's get this delivered — what name should I put on the order?", function () {
      enter("name");
    });
  }

  function goToStreet() {
    botSay("Thanks, " + state.name + "! What's your delivery street address? (House number and street name.)", function () {
      enter("street");
    });
  }

  // Checks the typed address against the mock backend. Invalid: say so and ask again.
  function handleStreetInput(text) {
    var rec = AddressBackend.lookup(text);
    if (rec) {
      acceptAddress(rec);
      return;
    }

    state.badAddressAttempts++;
    invalidAddressCount++;

    var near = AddressBackend.suggest(text);
    if (near) {
      enter("street-confirm");
      addSystemError("Sorry, I couldn't find that address.");
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

    addSystemError("Sorry, that's not a valid address in our Brampton delivery area.");
    askStreetAgain();
  }

  function askStreetAgain() {
    var hint = state.badAddressAttempts >= 2 ? " For example: " + AddressBackend.sample().street + "." : "";
    botSay("Please enter your street address again (house number and street name)." + hint, function () {
      enter("street");
    });
  }

  function acceptAddress(rec) {
    state.street = rec.street;
    state.city = rec.city;
    state.postal = rec.postal;
    state.badAddressAttempts = 0;
    botSay("Found it ✓ " + rec.street + ", " + rec.city + ", " + rec.province + " " + rec.postal + ".", function () {
      goToApt();
    });
  }

  function goToApt() {
    botSay("Do you have an apartment or unit number? (Tap Skip if none.)", function () {
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

  function showOrderSummary() {
    enter("confirm");
    var sizeLabel = labelFor(SIZES, state.size);
    var crustLabel = labelFor(CRUSTS, state.crust);
    var toppingsLabel = state.toppings.length ? state.toppings.join(", ") : "None";
    var addr = state.street + (state.apt ? " Apt " + state.apt : "") + ", " + state.city + ", " + state.postal;
    var total = orderTotal();
    var extraCount = Math.max(0, state.toppings.length - INCLUDED_TOPPINGS);
    var extraRow = extraCount
      ? "<dt>Extra toppings</dt><dd>" + extraCount + " extra, +" + fmtMoney(toppingTotal()) + "</dd>"
      : "";

    botSay("Here's your order — does everything look right?", function () {
      var card = document.createElement("div");
      card.className = "orderCard";
      card.innerHTML =
        "<h3>Order Summary</h3>" +
        "<dl>" +
        "<dt>Name</dt><dd>" + escapeHtml(state.name) + "</dd>" +
        "<dt>Address</dt><dd>" + escapeHtml(addr) + "</dd>" +
        "<dt>Size</dt><dd>" + escapeHtml(sizeLabel) + "</dd>" +
        "<dt>Crust</dt><dd>" + escapeHtml(crustLabel) + "</dd>" +
        "<dt>Toppings</dt><dd>" + escapeHtml(toppingsLabel) + "</dd>" +
        extraRow +
        "</dl>" +
        "<div class=\"total\">Total " + fmtMoney(total) + "</div>";
      log.appendChild(card);
      scrollToEnd();

      addQuickReplies(
        [{ id: "confirm", label: "Confirm ✓" }, { id: "modify", label: "Modify Order" }],
        function (opt) {
          if (opt.id === "confirm") {
            placeOrder();
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
                if (state.size === "large" && state.toppings.indexOf("Extra Cheese") > -1) {
                  state.toppings = state.toppings.filter(function (t) { return t !== "Extra Cheese"; });
                  addSystemError("Extra Cheese isn't available on Large pizzas, so I removed it from your order.");
                }
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
              state.editingReturnStep = "confirm";
            });
          }
        }
      );
    });
  }

  function placeOrder() {
    finishSession(true);
    var orderId = "PZA-" + Math.floor(10000 + Math.random() * 89999);
    var eta = (18 + Math.floor(Math.random() * 15)) + " min";
    botSay(
      "Thank you! 🎉 Your order has been placed.\nOrder ID: " + orderId +
      "\nEstimated time: " + eta +
      "\nTotal: " + fmtMoney(orderTotal()) +
      "\n\nSee you soon, " + state.name + "!",
      function () {
        state.step = "done";
        addQuickReplies([{ id: "restart", label: "Start a new order" }], function () {
          startFlow();
        });
      }
    );
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Free-text handling per step ---
  function matchFromList(list, text) {
    var lower = text.toLowerCase();
    return list.find(function (item) { return lower.indexOf(item.label.toLowerCase()) > -1 || lower.indexOf(item.id) > -1; });
  }

  function handleFreeText(raw) {
    var text = raw.trim();
    if (!text) return;

    var lower = text.toLowerCase();

    if (lower === "cancel") {
      addUserMessage(raw);
      finishSession(false);
      botSay("Order cancelled. No charges were made. Tap below to start fresh whenever you're ready.", function () {
        addQuickReplies([{ id: "restart", label: "Start a new order" }], function () { startFlow(); });
      });
      return;
    }
    if (lower === "reset" && (state.step === "toppings" || state.step === "confirm")) {
      addUserMessage(raw);
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
      case "size": {
        var m = matchFromList(SIZES, text);
        if (m) {
          addUserMessage(raw);
          state.size = m.id;
          goToCrust();
        } else {
          addUserMessage(raw);
          addSystemError("Sorry, I didn't catch that. Please choose Small, Medium, or Large.");
        }
        break;
      }
      case "crust": {
        var mc = matchFromList(CRUSTS, text);
        if (mc) {
          addUserMessage(raw);
          state.crust = mc.id;
          goToToppings();
        } else {
          addUserMessage(raw);
          addSystemError("I didn't recognize that crust. Try Hand-Tossed, Thin & Crispy, or Gluten-Free.");
        }
        break;
      }
      case "toppings": {
        addUserMessage(raw);
        addSystemError("Please use the buttons above to pick your toppings, then tap “Done adding toppings.”");
        break;
      }
      case "name": {
        addUserMessage(raw);
        state.name = text;
        goToStreet();
        break;
      }
      case "street":
      case "street-confirm": {
        addUserMessage(raw);
        handleStreetInput(text);
        break;
      }
      case "apt": {
        addUserMessage(raw);
        state.apt = /^(skip|none|no|n\/a)$/i.test(text) ? "" : text;
        showOrderSummary();
        break;
      }
      default: {
        addUserMessage(raw);
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

  // --- Tester tools: only available when the page is opened with ?tester ---
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
      var blob = new Blob(["﻿" + toCSV(list)], { type: "text/csv;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "pizzapal_results_" + dateStamp() + ".csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      setExportMsg("Downloaded " + a.download + ".");
    });

    confirmTap(document.getElementById("clearBtn"), "Clear results", "Tap again to delete all", function () {
      saveSessions([]);
      renderResults();
      setExportMsg("All results cleared.");
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
