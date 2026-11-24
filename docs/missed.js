(() => {
  const BOOK_ORDER = ["ProphetX", "Kalshi", "Novig", "Polymarket"];
  const PAGE = 60;
  const FETCH_PAGE = 1000;
  const SUPABASE_URL = "https://pygnirbppsekiwzwtdvj.supabase.co";
  const SUPABASE_KEY = "sb_publishable_uYrKVr0Ex6Ttva21StRkDA_wthWhuzs";
  const SELECT = [
    "id",
    "alerted_at",
    "recorded_at",
    "book",
    "reason",
    "detail",
    "tournament",
    "matchup",
    "match_date",
    "market",
    "bet",
    "discord_odds",
    "book_odds",
    "recommended_stake",
    "ev_pct",
  ].join(",");

  const EDGE_REASONS = [
    ["event_not_found", "Event not found", "Game is not on that book."],
    ["market_not_found", "Market not found", "Game is there, this market or line is not."],
    ["selection_not_found", "Selection not found", "Market is there, this side or player is not."],
    ["unsupported_market", "Unsupported market", "Bot could not interpret the alert."],
    ["odds_not_better", "Odds not better", "Market was found and the book's price was worse than Discord."],
    ["no_liquidity", "No liquidity", "No quote, or not enough size, at an acceptable price."],
    ["order_rejected", "Order rejected", "Order was sent and the book refused it."],
    ["order_not_filled", "Order not filled", "Order was accepted and nothing filled."],
    ["order_unknown", "Order unknown", "Order was sent and the bot could not tell whether it filled."],
    ["trading_blocked", "Trading blocked", "Book is refusing all bets: a location check, an account lock, or a Kalshi block."],
    ["balance_empty", "Balance empty", "Price was fine and there was no cash."],
    ["stake_too_small", "Stake too small", "Recommended size could not buy one contract."],
    ["client_error", "Client error", "Book client failed before an order was sent."],
    ["history_unavailable", "History unavailable", "Open bets could not be read, so the whole batch was not placed."],
  ];
  const INTENTIONAL_REASONS = [
    ["not_offered", "Not offered", "Config says this book does not offer that tournament or market."],
    ["other_book_open", "Other book open", "Another book already has this exact line."],
    ["exposure_cap", "Exposure cap", "Cross-book cap left nothing to bet."],
    ["repeat_bet", "Repeat bet", "This line was already placed, and the new size was not a top-up."],
  ];
  const REASONS = new Map();
  for (const [code, label, blurb] of EDGE_REASONS) REASONS.set(code, { label, blurb });
  for (const [code, label, blurb] of INTENTIONAL_REASONS) REASONS.set(code, { label, blurb });
  const INTENTIONAL = new Set(INTENTIONAL_REASONS.map(([code]) => code));
  const REASON_ORDER = new Map(
    [...EDGE_REASONS, ...INTENTIONAL_REASONS].map(([code], index) => [code, index]),
  );
  const DELAY_BUCKETS = [
    { key: "neg", label: "Before the post" },
    { key: "lt30", label: "Under 30s" },
    { key: "lt2", label: "30s–2m" },
    { key: "lt5", label: "2–5m" },
    { key: "lt15", label: "5–15m" },
    { key: "lt60", label: "15–60m" },
    { key: "over", label: "Over 1h" },
    { key: "none", label: "No alert time" },
  ];

  const state = {
    rows: [],
    error: false,
    book: "",
    market: "",
    from: "",
    to: "",
    scope: "edge",
    reason: "",
    sort: { key: "total", dir: "desc" },
    logLimit: PAGE,
  };

  const moneyFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const whenFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
  const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const stampFormat = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  });

  const els = {
    snapshot: document.querySelector("#snapshot"),
    banner: document.querySelector("#banner"),
    note: document.querySelector("#note"),
    filters: document.querySelector("#filters"),
    books: document.querySelector("#books"),
    scope: document.querySelector("#scope"),
    market: document.querySelector("#market"),
    from: document.querySelector("#from"),
    to: document.querySelector("#to"),
    clear: document.querySelector("#clear"),
    kpis: document.querySelector("#kpis"),
    reasonPanel: document.querySelector("#reason-panel"),
    reasonMeta: document.querySelector("#reason-meta"),
    clearReason: document.querySelector("#clear-reason"),
    reasonRoot: document.querySelector("#reason-root"),
    oddsPanel: document.querySelector("#odds-panel"),
    oddsMeta: document.querySelector("#odds-meta"),
    oddsRoot: document.querySelector("#odds-root"),
    log: document.querySelector("#log"),
    logMeta: document.querySelector("#log-meta"),
    logRoot: document.querySelector("#log-root"),
    empty: document.querySelector("#empty"),
    emptyTitle: document.querySelector("#empty-title"),
    emptyCopy: document.querySelector("#empty-copy"),
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  const tip = el("div", "odds-tip");
  tip.hidden = true;
  tip.setAttribute("role", "tooltip");
  document.body.append(tip);

  function placeTip(text, target) {
    if (!text) return;
    tip.textContent = text;
    tip.hidden = false;
    const rect = target.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - tipRect.width / 2, window.innerWidth - tipRect.width - 8));
    let top = rect.top - tipRect.height - 8;
    if (top < 8) top = rect.bottom + 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  function hideTip() {
    tip.hidden = true;
  }

  function money(value) {
    if (value == null || Number.isNaN(value)) return "—";
    return moneyFormat.format(value);
  }

  function points(value) {
    if (value == null || Number.isNaN(value)) return "—";
    return `${value.toFixed(1)}%`;
  }

  function ratio(value) {
    if (value == null || Number.isNaN(value)) return "—";
    return `${(value * 100).toFixed(1)}%`;
  }

  function asNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  function formatOdds(value) {
    if (value == null || value === "") return "—";
    const text = String(value).trim();
    if (!text) return "—";
    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric > 0 && !text.startsWith("+")) return `+${text}`;
    return text;
  }

  function payoutPerUnit(value) {
    const odds = Number(String(value ?? "").trim());
    if (!Number.isFinite(odds) || (odds > -100 && odds < 100)) return null;
    if (odds >= 100) return odds / 100;
    return 100 / Math.abs(odds);
  }

  function priceGapPoints(discord, book) {
    const discordPayout = payoutPerUnit(discord);
    const bookPayout = payoutPerUnit(book);
    if (discordPayout == null || bookPayout == null) return null;
    const discordImplied = 1 / (1 + discordPayout);
    const bookImplied = 1 / (1 + bookPayout);
    return (bookImplied - discordImplied) * 100;
  }

  function formatGap(gap) {
    if (gap == null || !Number.isFinite(gap)) return "—";
    if (Math.abs(gap) < 0.05) return "0.0 pts";
    const sign = gap > 0 ? "+" : "-";
    return `${sign}${Math.abs(gap).toFixed(1)} pts`;
  }

  function gapTone(gap) {
    if (gap == null || Math.abs(gap) < 0.05) return "flat";
    return gap > 0 ? "neg" : "pos";
  }

  function formatDelay(seconds) {
    if (seconds == null || !Number.isFinite(seconds)) return "—";
    const sign = seconds < 0 ? "-" : "";
    const abs = Math.round(Math.abs(seconds));
    if (abs < 60) return `${sign}${abs}s`;
    const minutes = Math.floor(abs / 60);
    const remain = abs % 60;
    if (minutes < 60) return remain ? `${sign}${minutes}m ${remain}s` : `${sign}${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const minRemain = minutes % 60;
    return minRemain ? `${sign}${hours}h ${minRemain}m` : `${sign}${hours}h`;
  }

  function monthParts(iso) {
    const match = String(iso || "").match(/^(\d{4})-(\d{2})/);
    if (!match) return null;
    const index = Number(match[2]) - 1;
    if (index < 0 || index > 11) return null;
    return { year: match[1], index };
  }

  function formatDay(iso) {
    if (!iso) return "—";
    const parts = monthParts(iso);
    const day = Number(String(iso).slice(8, 10));
    if (!parts || !day) return String(iso);
    return `${day} ${MONTHS_SHORT[parts.index]} ${parts.year}`;
  }

  function formatStamp(iso) {
    const text = String(iso || "");
    if (!/T\d{2}:\d{2}/.test(text)) return "";
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return "";
    const parts = stampFormat.formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value || "";
    return `${get("day")} ${get("month")} ${get("year")} ${get("hour")}:${get("minute")}:${get("second")} ${get("timeZoneName")}`;
  }

  function formatWhen(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return whenFormat.format(date);
  }

  function reasonInfo(reason) {
    const known = REASONS.get(reason);
    if (known) return known;
    const label = reason
      ? reason.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
      : "Unknown";
    return { label, blurb: "Unlisted reason code." };
  }

  function isEdge(reason) {
    return !INTENTIONAL.has(reason);
  }

  function stakeOf(row) {
    return row.recommendedStake == null ? 0 : row.recommendedStake;
  }

  function stakeSum(rows) {
    return rows.reduce((sum, row) => sum + stakeOf(row), 0);
  }

  function weightedEv(rows) {
    let stake = 0;
    let weighted = 0;
    for (const row of rows) {
      if (row.evPct == null || !(row.recommendedStake > 0)) continue;
      stake += row.recommendedStake;
      weighted += row.evPct * row.recommendedStake;
    }
    return stake ? weighted / stake : null;
  }

  function weightedMedian(pairs) {
    const weighted = pairs.filter((pair) => pair.value != null && Number.isFinite(pair.value) && pair.weight > 0);
    const source = weighted.length
      ? weighted
      : pairs
          .filter((pair) => pair.value != null && Number.isFinite(pair.value))
          .map((pair) => ({ value: pair.value, weight: 1 }));
    if (!source.length) return null;
    source.sort((a, b) => a.value - b.value);
    const total = source.reduce((sum, pair) => sum + pair.weight, 0);
    let covered = 0;
    for (const pair of source) {
      covered += pair.weight;
      if (covered >= total / 2) return pair.value;
    }
    return source[source.length - 1].value;
  }

  function booksIn(rows) {
    const present = new Set(rows.map((row) => row.book).filter(Boolean));
    const ordered = BOOK_ORDER.filter((book) => present.has(book));
    const extras = [...present].filter((book) => !BOOK_ORDER.includes(book)).sort();
    return ordered.concat(extras);
  }

  function dayOf(row) {
    return String(row.recordedAt || "").slice(0, 10);
  }

  function delaySeconds(alerted, recorded) {
    if (!alerted || !recorded) return null;
    const start = new Date(alerted).getTime();
    const end = new Date(recorded).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return (end - start) / 1000;
  }

  function bucketKey(seconds) {
    if (seconds == null) return "none";
    if (seconds < 0) return "neg";
    if (seconds < 30) return "lt30";
    if (seconds < 120) return "lt2";
    if (seconds < 300) return "lt5";
    if (seconds < 900) return "lt15";
    if (seconds < 3600) return "lt60";
    return "over";
  }

  function hasPrice(row) {
    return row.bookOdds != null && String(row.bookOdds).trim() !== "";
  }

  function toRow(raw) {
    const reason = String(raw.reason || "").trim().toLowerCase();
    return {
      id: raw.id,
      alertedAt: raw.alerted_at || null,
      recordedAt: raw.recorded_at || null,
      book: String(raw.book || "").trim() || "Unknown",
      reason,
      detail: String(raw.detail || "").trim(),
      tournament: String(raw.tournament || "").trim(),
      matchup: String(raw.matchup || "").trim(),
      matchDate: String(raw.match_date || "").trim(),
      market: String(raw.market || "").trim(),
      bet: String(raw.bet || "").trim(),
      discordOdds: raw.discord_odds,
      bookOdds: raw.book_odds,
      recommendedStake: asNumber(raw.recommended_stake),
      evPct: asNumber(raw.ev_pct),
      delaySec: delaySeconds(raw.alerted_at, raw.recorded_at),
    };
  }

  function noteFor(scope) {
    if (scope === "intentional") {
      return "Skipped on purpose. The book does not offer that tournament or market, another book already has the line, the exposure cap left nothing to bet, or the line was already placed and this alert was not a top-up.";
    }
    return "Wagers the bot did not place. Stake is Discord's recommended dollars, so bigger alerts count for more. Delay is the time from the Discord post to the skip.";
  }

  function sliceRows() {
    const query = state.market.trim().toLowerCase();
    return state.rows.filter((row) => {
      const edge = isEdge(row.reason);
      if (state.scope === "edge" && !edge) return false;
      if (state.scope === "intentional" && edge) return false;
      if (state.book && row.book !== state.book) return false;
      if (query) {
        const haystack = `${row.tournament} ${row.matchup} ${row.market} ${row.bet} ${row.detail}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      const day = dayOf(row);
      if (state.from && day && day < state.from) return false;
      if (state.to && day && day > state.to) return false;
      return true;
    });
  }

  function kpi(label, value, sub) {
    const card = el("article", "kpi");
    card.append(el("span", null, label));
    card.append(el("strong", null, value));
    if (sub) card.append(el("em", null, sub));
    return card;
  }

  function renderBooks(rows) {
    const books = booksIn(rows);
    if (state.book && !books.includes(state.book)) books.push(state.book);
    const wanted = ["", ...books];
    const existing = [...els.books.querySelectorAll("button")];
    const same =
      existing.length === wanted.length &&
      existing.every((button, index) => (button.dataset.book || "") === wanted[index]);
    if (same) {
      for (const button of existing) {
        button.setAttribute("aria-pressed", (button.dataset.book || "") === state.book ? "true" : "false");
      }
      return;
    }
    const buttons = wanted.map((book) => {
      const button = el("button", null, book || "All books");
      button.type = "button";
      button.dataset.book = book;
      button.setAttribute("aria-pressed", book === state.book ? "true" : "false");
      button.addEventListener("click", () => {
        state.book = state.book === book ? "" : book;
        state.logLimit = PAGE;
        render();
      });
      return button;
    });
    els.books.replaceChildren(...buttons);
  }

  function stakeCell(count, stake) {
    const cell = el("td", "num cell");
    if (!count) {
      cell.append(el("span", "muted", "—"));
      return cell;
    }
    cell.title = `${count.toLocaleString()} skips · recommended ${money(stake)}`;
    cell.append(el("strong", null, money(stake)));
    cell.append(el("small", null, `${count.toLocaleString()} skip${count === 1 ? "" : "s"}`));
    return cell;
  }

  function renderReasons(slice) {
    const books = booksIn(slice);
    const groups = new Map();
    for (const row of slice) {
      if (!groups.has(row.reason)) groups.set(row.reason, []);
      groups.get(row.reason).push(row);
    }
    const reasons = [...groups.entries()].map(([reason, items]) => {
      const byBook = {};
      for (const book of books) {
        const bookRows = items.filter((row) => row.book === book);
        byBook[book] = { count: bookRows.length, stake: stakeSum(bookRows) };
      }
      return {
        reason,
        label: reasonInfo(reason).label,
        blurb: reasonInfo(reason).blurb,
        count: items.length,
        stake: stakeSum(items),
        byBook,
      };
    });
    const { key, dir } = state.sort;
    const sign = dir === "asc" ? 1 : -1;
    reasons.sort((a, b) => {
      if (key === "label") return a.label.localeCompare(b.label) * sign || a.reason.localeCompare(b.reason);
      const left = key === "total" ? a.stake : a.byBook[key]?.stake || 0;
      const right = key === "total" ? b.stake : b.byBook[key]?.stake || 0;
      if (left !== right) return (left - right) * sign;
      return b.stake - a.stake || (REASON_ORDER.get(a.reason) ?? 999) - (REASON_ORDER.get(b.reason) ?? 999);
    });

    const columns = [{ key: "label", name: "Reason" }]
      .concat(books.map((book) => ({ key: book, name: book })))
      .concat(books.length >= 2 ? [{ key: "total", name: "Total" }] : []);
    const table = el("table", "matrix");
    const headRow = el("tr");
    for (const column of columns) {
      const th = el("th", column.key === "label" ? "label sortable" : "num sortable", column.name);
      th.title = column.key === "label" ? "Stable reason code" : "Recommended stake";
      if (state.sort.key === column.key) {
        th.textContent += state.sort.dir === "asc" ? " ↑" : " ↓";
        th.setAttribute("aria-sort", state.sort.dir === "asc" ? "ascending" : "descending");
      }
      th.addEventListener("click", () => {
        if (state.sort.key === column.key) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
        else state.sort = { key: column.key, dir: column.key === "label" ? "asc" : "desc" };
        render();
      });
      headRow.append(th);
    }
    const head = el("thead");
    head.append(headRow);
    table.append(head);
    const body = el("tbody");
    for (const reason of reasons) {
      const tr = el("tr", state.reason === reason.reason ? "pick is-selected" : "pick");
      tr.dataset.reason = reason.reason;
      tr.tabIndex = 0;
      tr.setAttribute("aria-pressed", state.reason === reason.reason ? "true" : "false");
      tr.setAttribute("aria-label", `${reason.label}. ${reason.blurb}`);
      const choose = () => {
        state.reason = state.reason === reason.reason ? "" : reason.reason;
        state.logLimit = PAGE;
        render();
      };
      tr.addEventListener("click", choose);
      tr.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        choose();
      });
      const label = el("td", "label");
      label.title = `${reason.reason} — ${reason.blurb}`;
      label.textContent = reason.label;
      tr.append(label);
      for (const book of books) tr.append(stakeCell(reason.byBook[book].count, reason.byBook[book].stake));
      if (books.length >= 2) tr.append(stakeCell(reason.count, reason.stake));
      body.append(tr);
    }
    const total = el("tr", "total");
    total.append(el("td", "label", "All"));
    for (const book of books) {
      const bookRows = slice.filter((row) => row.book === book);
      total.append(stakeCell(bookRows.length, stakeSum(bookRows)));
    }
    if (books.length >= 2) total.append(stakeCell(slice.length, stakeSum(slice)));
    body.append(total);
    table.append(body);
    const wrap = el("div", "table-wrap");
    wrap.append(table);
    els.reasonRoot.replaceChildren(wrap);
    const info = state.reason ? reasonInfo(state.reason) : null;
    els.reasonMeta.textContent = info
      ? `${info.label} in the skip log · ${slice.length.toLocaleString()} skips in the table`
      : `${reasons.length.toLocaleString()} reasons · ${money(stakeSum(slice))} recommended`;
    els.clearReason.hidden = !state.reason;
  }

  function headedTable(className, columns) {
    const table = el("table", className);
    const headRow = el("tr");
    for (const column of columns) {
      const th = el("th", column.num ? "num" : "", column.label);
      if (column.title) th.title = column.title;
      headRow.append(th);
    }
    const head = el("thead");
    head.append(headRow);
    const body = el("tbody");
    table.append(head, body);
    return { table, body };
  }

  function dateCell(iso) {
    const cell = el("td");
    const label = formatDay(iso);
    const stamp = formatStamp(iso);
    if (!stamp) {
      cell.textContent = label;
      return cell;
    }
    const trigger = el("span", "date-hover", label);
    trigger.tabIndex = 0;
    trigger.dataset.stamp = stamp;
    trigger.setAttribute("aria-label", stamp);
    cell.append(trigger);
    return cell;
  }

  function delayCell(row) {
    const cell = el("td", "num");
    cell.textContent = formatDelay(row.delaySec);
    if (row.delaySec == null) {
      cell.title = "Discord post time was missing";
      return cell;
    }
    const from = formatStamp(row.alertedAt);
    const to = formatStamp(row.recordedAt);
    if (from && to) cell.title = `${from} to ${to}`;
    return cell;
  }

  function matchupCell(row) {
    const cell = el("td", "wrap");
    cell.append(document.createTextNode(row.matchup || "—"));
    if (row.matchDate) cell.append(el("span", "subline muted", row.matchDate));
    return cell;
  }

  function reasonCell(row) {
    const info = reasonInfo(row.reason);
    const cell = el("td", "wrap");
    cell.title = info.blurb;
    cell.append(document.createTextNode(info.label));
    cell.append(el("span", "subline muted", row.reason || "unknown"));
    if (row.detail) cell.append(el("span", "subline", row.detail));
    return cell;
  }

  function appendSkipRow(body, row, includeReason) {
    const tr = el("tr");
    tr.append(dateCell(row.recordedAt));
    tr.append(delayCell(row));
    tr.append(el("td", null, row.book || "—"));
    if (includeReason) tr.append(reasonCell(row));
    tr.append(el("td", "wrap", row.tournament || "—"));
    tr.append(matchupCell(row));
    tr.append(el("td", "wrap", row.market || "—"));
    tr.append(el("td", "wrap", row.bet || "—"));
    tr.append(el("td", "num", formatOdds(row.discordOdds)));
    tr.append(el("td", "num", formatOdds(row.bookOdds)));
    const gap = priceGapPoints(row.discordOdds, row.bookOdds);
    tr.append(el("td", `num ${gapTone(gap)}`, formatGap(gap)));
    tr.append(el("td", "num", money(row.recommendedStake)));
    if (includeReason) tr.append(el("td", "num", points(row.evPct)));
    body.append(tr);
  }

  const SKIP_COLUMNS = [
    { label: "Recorded" },
    { label: "Delay", num: true, title: "recorded_at minus alerted_at" },
    { label: "Book" },
    { label: "Reason" },
    { label: "Tournament" },
    { label: "Matchup" },
    { label: "Market" },
    { label: "Bet" },
    { label: "Discord", num: true, title: "Discord's American odds" },
    { label: "Book odds", num: true, title: "American odds at the book. Higher is better for the bettor." },
    { label: "Shorter", num: true, title: "Book implied probability minus Discord, in percentage points." },
    { label: "Stake", num: true, title: "Discord's recommended dollars" },
    { label: "EV", num: true },
  ];

  function renderOdds(slice) {
    const odds = slice.filter((row) => row.reason === "odds_not_better");
    const show = state.scope === "edge" && odds.length > 0 && (!state.reason || state.reason === "odds_not_better");
    els.oddsPanel.hidden = !show;
    if (!show) {
      els.oddsRoot.replaceChildren();
      els.oddsMeta.textContent = "";
      return;
    }
    const books = booksIn(odds);
    const priced = odds.filter(hasPrice).length;
    els.oddsMeta.textContent = `${odds.length.toLocaleString()} skips · ${money(stakeSum(odds))} recommended · ${priced.toLocaleString()} with a book price`;

    const summary = headedTable(null, [
      { label: "Book" },
      { label: "Skips", num: true },
      { label: "Stake", num: true, title: "Recommended stake" },
      { label: "Median delay", num: true, title: "Stake-weighted median of recorded_at minus alerted_at" },
      { label: "Priced", num: true, title: "Skips where the book had a price" },
      { label: "Shorter", num: true, title: "Stake-weighted median price gap. Positive means the book was worse." },
    ]);
    const summaryGroups = books.map((book) => odds.filter((row) => row.book === book));
    if (books.length >= 2) summaryGroups.push(odds);
    summaryGroups.forEach((items, index) => {
      const tr = el("tr", index === books.length ? "total" : "");
      tr.dataset.book = index === books.length ? "all" : books[index];
      const delay = weightedMedian(items.map((row) => ({ value: row.delaySec, weight: stakeOf(row) })));
      const gap = weightedMedian(
        items.map((row) => ({ value: priceGapPoints(row.discordOdds, row.bookOdds), weight: stakeOf(row) })),
      );
      const withPrice = items.filter(hasPrice).length;
      tr.append(el("td", "label", index === books.length ? "All" : books[index]));
      tr.append(el("td", "num", items.length.toLocaleString()));
      tr.append(el("td", "num", money(stakeSum(items))));
      tr.append(el("td", "num", formatDelay(delay)));
      tr.append(el("td", "num", `${withPrice.toLocaleString()} of ${items.length.toLocaleString()}`));
      tr.append(el("td", `num ${gapTone(gap)}`, formatGap(gap)));
      summary.body.append(tr);
    });

    const delayBooks = books;
    const delayTable = el("table", "matrix");
    const delayHeadRow = el("tr");
    delayHeadRow.append(el("th", "label", "Delay"));
    for (const book of delayBooks) delayHeadRow.append(el("th", "num", book));
    if (delayBooks.length >= 2) delayHeadRow.append(el("th", "num", "Total"));
    const delayHead = el("thead");
    delayHead.append(delayHeadRow);
    delayTable.append(delayHead);
    const delayBody = el("tbody");
    for (const bucket of DELAY_BUCKETS) {
      const matching = odds.filter((row) => bucketKey(row.delaySec) === bucket.key);
      if (!matching.length) continue;
      const tr = el("tr");
      tr.append(el("td", "label", bucket.label));
      for (const book of delayBooks) {
        const bookRows = matching.filter((row) => row.book === book);
        tr.append(stakeCell(bookRows.length, stakeSum(bookRows)));
      }
      if (delayBooks.length >= 2) tr.append(stakeCell(matching.length, stakeSum(matching)));
      delayBody.append(tr);
    }
    delayTable.append(delayBody);

    const previewRows = odds
      .slice()
      .sort((a, b) => stakeOf(b) - stakeOf(a) || (b.delaySec || 0) - (a.delaySec || 0));
    const preview = previewRows.slice(0, 8);
    const previewColumns = SKIP_COLUMNS.filter((column) => column.label !== "Reason" && column.label !== "EV");
    const previewTable = headedTable("bets", previewColumns);
    for (const row of preview) appendSkipRow(previewTable.body, row, false);

    const root = document.createDocumentFragment();
    const byBook = el("div", "miss-block");
    byBook.append(el("h3", null, "By book"));
    const summaryWrap = el("div", "table-wrap");
    summaryWrap.append(summary.table);
    byBook.append(summaryWrap);
    const byDelay = el("div", "miss-block");
    byDelay.append(el("h3", null, "Delay by book"));
    const delayWrap = el("div", "table-wrap");
    delayWrap.append(delayTable);
    byDelay.append(delayWrap);
    const largest = el("div", "miss-block");
    largest.append(el("h3", null, "Largest recommended stakes"));
    const previewWrap = el("div", "table-wrap");
    previewWrap.append(previewTable.table);
    largest.append(previewWrap);
    if (previewRows.length > preview.length) {
      const more = el(
        "button",
        "more",
        `Show all ${previewRows.length.toLocaleString()} in the log`,
      );
      more.type = "button";
      more.addEventListener("click", () => {
        state.reason = "odds_not_better";
        state.logLimit = PAGE;
        render();
        document.querySelector("#log")?.scrollIntoView({ block: "start" });
      });
      largest.append(more);
    }
    root.append(byBook, byDelay, largest);
    els.oddsRoot.replaceChildren(root);
  }

  function renderLog(slice) {
    const rows = (state.reason ? slice.filter((row) => row.reason === state.reason) : slice)
      .slice()
      .sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)) || (Number(b.id) || 0) - (Number(a.id) || 0));
    if (!rows.length) {
      els.logRoot.replaceChildren(el("p", "muted", "No skips in this slice."));
      els.logMeta.textContent = "0 skips";
      return;
    }
    const shown = rows.slice(0, state.logLimit);
    const { table, body } = headedTable("bets", SKIP_COLUMNS);
    for (const row of shown) appendSkipRow(body, row, true);
    const fragment = document.createDocumentFragment();
    const wrap = el("div", "table-wrap");
    wrap.append(table);
    fragment.append(wrap);
    if (shown.length < rows.length) {
      const more = el(
        "button",
        "more",
        `Show more (${shown.length.toLocaleString()} of ${rows.length.toLocaleString()})`,
      );
      more.type = "button";
      more.addEventListener("click", () => {
        state.logLimit += PAGE;
        render();
      });
      fragment.append(more);
    }
    els.logRoot.replaceChildren(fragment);
    const label = state.reason ? reasonInfo(state.reason).label : "Skips";
    els.logMeta.textContent = `${label} · ${rows.length.toLocaleString()} ${rows.length === 1 ? "skip" : "skips"}`;
  }

  function renderKpis(slice) {
    const stake = stakeSum(slice);
    const cards = [
      kpi("Skips", slice.length.toLocaleString(), state.scope === "edge" ? "missed edge" : "intentional"),
      kpi("Recommended", money(stake), "Discord's recommended dollars"),
      kpi("Avg EV", points(weightedEv(slice)), "stake-weighted"),
    ];
    if (state.scope === "edge") {
      const moved = slice.filter((row) => row.reason === "odds_not_better");
      const movedStake = stakeSum(moved);
      const delay = weightedMedian(moved.map((row) => ({ value: row.delaySec, weight: stakeOf(row) })));
      const unpriced = moved.filter((row) => !hasPrice(row)).length;
      cards.push(
        kpi(
          "Odds not better",
          moved.length.toLocaleString(),
          moved.length ? `${money(movedStake)} · ${stake ? ratio(movedStake / stake) : "—"} of stake` : "none in this slice",
        ),
      );
      cards.push(kpi("Median delay", formatDelay(delay), "odds not better, stake-weighted"));
      cards.push(kpi("No book price", unpriced.toLocaleString(), "odds not better"));
    } else {
      const groups = new Map();
      for (const row of slice) {
        if (!groups.has(row.reason)) groups.set(row.reason, []);
        groups.get(row.reason).push(row);
      }
      const top = [...groups.entries()]
        .map(([reason, items]) => ({ reason, items, stake: stakeSum(items) }))
        .sort((a, b) => b.stake - a.stake || a.reason.localeCompare(b.reason))
        .slice(0, 3);
      for (const group of top) {
        cards.push(
          kpi(
            reasonInfo(group.reason).label,
            money(group.stake),
            `${group.items.length.toLocaleString()} skip${group.items.length === 1 ? "" : "s"}`,
          ),
        );
      }
    }
    els.kpis.replaceChildren(...cards);
  }

  function renderSnapshot() {
    if (state.error) {
      els.snapshot.textContent = "Missed bets unavailable";
      return;
    }
    if (!state.rows.length) {
      els.snapshot.textContent = "No missed bets yet";
      return;
    }
    const times = state.rows.map((row) => row.recordedAt).filter(Boolean).sort();
    const first = times.length ? formatWhen(times[0]) : "";
    const last = times.length ? formatWhen(times[times.length - 1]) : "";
    const span = first && last && first !== last ? `${first} – ${last}` : first || "no timestamp";
    els.snapshot.textContent = `${state.rows.length.toLocaleString()} skips · ${span}`;
  }

  function renderEmpty() {
    if (state.error) {
      els.emptyTitle.textContent = "Missed bets unavailable";
      els.emptyCopy.textContent = "Could not load skipped wagers from Supabase.";
      return;
    }
    if (!state.rows.length) {
      els.emptyTitle.textContent = "No missed bets yet";
      els.emptyCopy.textContent =
        "Rows show up in batches about every five minutes, starting when the current bot process came up. recorded_at is when the wager was skipped.";
      return;
    }
    els.emptyTitle.textContent = "No skips in this slice";
    els.emptyCopy.textContent =
      state.scope === "intentional"
        ? "No intentional skips match these filters."
        : "No missed-edge skips match these filters.";
  }

  function updateScopeTabs() {
    for (const tab of els.scope.querySelectorAll("[data-scope]")) {
      tab.setAttribute("aria-selected", tab.dataset.scope === state.scope ? "true" : "false");
    }
  }

  function writeUrl() {
    const params = new URLSearchParams();
    if (state.book) params.set("book", state.book);
    if (state.market) params.set("market", state.market);
    if (state.from) params.set("from", state.from);
    if (state.to) params.set("to", state.to);
    if (state.scope === "intentional") params.set("skips", "intentional");
    if (state.reason) params.set("reason", state.reason);
    const query = params.toString();
    const next = `${location.pathname}${query ? `?${query}` : ""}`;
    const current = `${location.pathname}${location.search}`;
    if (current !== next) history.replaceState(null, "", next);
  }

  function render() {
    hideTip();
    els.note.textContent = noteFor(state.scope);
    els.banner.hidden = !state.error;
    if (state.error) els.banner.textContent = "Could not load missed bets from Supabase.";
    updateScopeTabs();
    renderSnapshot();
    const slice = state.error ? [] : sliceRows();
    if (state.reason && !slice.some((row) => row.reason === state.reason)) state.reason = "";
    const showData = slice.length > 0;
    els.filters.hidden = state.error || !state.rows.length;
    els.kpis.hidden = !showData;
    els.reasonPanel.hidden = !showData;
    els.log.hidden = !showData;
    els.empty.hidden = showData;
    writeUrl();
    if (!showData) {
      els.oddsPanel.hidden = true;
      els.clearReason.hidden = true;
      renderEmpty();
      return;
    }
    renderBooks(state.rows);
    renderKpis(slice);
    renderReasons(slice);
    renderOdds(slice);
    renderLog(slice);
  }

  function readUrl() {
    const params = new URLSearchParams(location.search);
    state.book = params.get("book") || "";
    state.market = params.get("market") || "";
    state.from = params.get("from") || "";
    state.to = params.get("to") || "";
    state.scope = params.get("skips") === "intentional" ? "intentional" : "edge";
    state.reason = params.get("reason") || "";
  }

  function syncControls() {
    els.market.value = state.market;
    els.from.value = state.from;
    els.to.value = state.to;
  }

  async function loadMisses() {
    const rows = [];
    let offset = 0;
    while (true) {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/dashboard_missed_bets?select=${SELECT}&order=id.asc`,
        {
          cache: "no-store",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            Range: `${offset}-${offset + FETCH_PAGE - 1}`,
          },
        },
      );
      if (!response.ok) throw new Error(String(response.status));
      const page = await response.json();
      if (!Array.isArray(page)) throw new Error("unexpected response");
      for (const row of page) rows.push(toRow(row));
      if (page.length < FETCH_PAGE) return rows;
      offset += FETCH_PAGE;
    }
  }

  function resetSlice() {
    state.book = "";
    state.market = "";
    state.from = "";
    state.to = "";
    state.reason = "";
    state.logLimit = PAGE;
    syncControls();
    render();
  }

  els.market.addEventListener("input", () => {
    state.market = els.market.value;
    state.logLimit = PAGE;
    render();
  });
  els.from.addEventListener("change", () => {
    state.from = els.from.value;
    state.logLimit = PAGE;
    render();
  });
  els.to.addEventListener("change", () => {
    state.to = els.to.value;
    state.logLimit = PAGE;
    render();
  });
  els.clear.addEventListener("click", resetSlice);
  els.clearReason.addEventListener("click", () => {
    state.reason = "";
    state.logLimit = PAGE;
    render();
  });
  els.scope.addEventListener("click", (event) => {
    const node = event.target && event.target.nodeType === 1 ? event.target : event.target && event.target.parentElement;
    const tab = node && node.closest ? node.closest("[data-scope]") : null;
    if (!tab || tab.dataset.scope === state.scope) return;
    state.scope = tab.dataset.scope;
    state.reason = "";
    state.logLimit = PAGE;
    render();
  });

  function hoverTarget(event) {
    const node = event.target && event.target.nodeType === 1 ? event.target : event.target && event.target.parentElement;
    return node && node.closest ? node.closest(".date-hover") : null;
  }

  const page = document.querySelector(".page");
  page.addEventListener("mouseover", (event) => {
    const target = hoverTarget(event);
    if (target) placeTip(target.dataset.stamp, target);
  });
  page.addEventListener("mouseout", (event) => {
    const target = hoverTarget(event);
    if (!target) return;
    if (event.relatedTarget && target.contains(event.relatedTarget)) return;
    hideTip();
  });
  page.addEventListener("focusin", (event) => {
    const target = hoverTarget(event);
    if (target) placeTip(target.dataset.stamp, target);
  });
  page.addEventListener("focusout", (event) => {
    const target = hoverTarget(event);
    if (!target) return;
    if (event.relatedTarget && target.contains(event.relatedTarget)) return;
    hideTip();
  });
  document.addEventListener("scroll", hideTip, true);

  async function init() {
    readUrl();
    syncControls();
    try {
      state.rows = await loadMisses();
    } catch (error) {
      state.error = true;
      state.rows = [];
    }
    const days = state.rows.map(dayOf).filter(Boolean).sort();
    if (days.length) {
      els.from.min = days[0];
      els.from.max = days[days.length - 1];
      els.to.min = days[0];
      els.to.max = days[days.length - 1];
    }
    render();
  }

  init();
})();
