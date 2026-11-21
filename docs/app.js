(() => {
  const BOOK_ORDER = ["ProphetX", "Kalshi", "Novig", "Polymarket"];
  const SETTLED = new Set(["won", "lost", "push", "void"]);
  const PAGE = 60;
  const SUPABASE_URL = "https://pygnirbppsekiwzwtdvj.supabase.co";
  const SUPABASE_KEY = "sb_publishable_uYrKVr0Ex6Ttva21StRkDA_wthWhuzs";
  const FETCH_PAGE = 1000;
  // American prices: +100 and -100 are the same even-money point, and the
  // scale runs outward from there. Nothing valid sits between -99 and 99.
  const ODDS_GAP = 0.05;
  const ODDS_GAP_LABEL = `${(ODDS_GAP * 100).toFixed(ODDS_GAP * 100 % 1 ? 1 : 0)}%`;

  const state = {
    data: null,
    book: "",
    league: "",
    market: "",
    from: "",
    to: "",
    settled: false,
    betStatus: "settled",
    view: "league",
    sort: { key: "total", dir: "desc" },
    betLimit: PAGE,
    chartPoints: [],
    hoverIndex: null,
    chartBrush: null,
  };

  const moneyFormat = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  });

  const els = {
    snapshot: document.querySelector("#snapshot"),
    banner: document.querySelector("#banner"),
    books: document.querySelector("#books"),
    league: document.querySelector("#league"),
    market: document.querySelector("#market"),
    from: document.querySelector("#from"),
    to: document.querySelector("#to"),
    settled: document.querySelector("#settled"),
    clear: document.querySelector("#clear"),
    kpis: document.querySelector("#kpis"),
    readout: document.querySelector("#chart-readout"),
    canvas: document.querySelector("#pnl-chart"),
    views: document.querySelector("#views"),
    betsStatus: document.querySelector("#bets-status"),
    betsOpen: document.querySelector("#bets-open"),
    tableMeta: document.querySelector("#table-meta"),
    tableRoot: document.querySelector("#table-root"),
    bovadaKpis: document.querySelector("#bovada-kpis"),
    bovadaRoot: document.querySelector("#bovada-root"),
  };

  const oddsTip = el("div", "odds-tip");
  oddsTip.hidden = true;
  oddsTip.setAttribute("role", "tooltip");
  document.body.append(oddsTip);

  function placeOddsTip(target) {
    const discord = target.dataset.discord;
    if (!discord) return;
    oddsTip.textContent = target.dataset.warn ? `Discord ${discord} · over ${ODDS_GAP_LABEL} off` : `Discord ${discord}`;
    oddsTip.hidden = false;
    const rect = target.getBoundingClientRect();
    const tipRect = oddsTip.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - tipRect.width / 2, window.innerWidth - tipRect.width - 8));
    let top = rect.top - tipRect.height - 8;
    if (top < 8) top = rect.bottom + 8;
    oddsTip.style.left = `${left}px`;
    oddsTip.style.top = `${top}px`;
  }

  function hideOddsTip() {
    oddsTip.hidden = true;
  }

  function oddsHoverTarget(event) {
    const node = event.target && event.target.nodeType === 1 ? event.target : event.target && event.target.parentElement;
    return node && node.closest ? node.closest(".odds-hover") : null;
  }

  function num(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function money(value) {
    if (value == null || Number.isNaN(value)) return "—";
    return moneyFormat.format(value);
  }

  function ratio(value) {
    if (value == null || Number.isNaN(value)) return "—";
    return `${(value * 100).toFixed(1)}%`;
  }

  function points(value) {
    if (value == null || Number.isNaN(value)) return "—";
    return `${value.toFixed(1)}%`;
  }

  function tone(value) {
    if (value == null || Math.abs(value) < 0.005) return "flat";
    return value > 0 ? "pos" : "neg";
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

  function oddsDiffer(display, discord) {
    const betPayout = payoutPerUnit(display);
    const discordPayout = payoutPerUnit(discord);
    if (betPayout == null || discordPayout == null || betPayout === 0) return false;
    return Math.abs(betPayout - discordPayout) / betPayout > ODDS_GAP;
  }

  function oddsWarnIcon() {
    const icon = el("span", "odds-warn");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = "<svg viewBox='0 0 16 16' width='14' height='14'><path fill='currentColor' d='M8 1.4 15.2 14.6H.8L8 1.4z'/><path fill='#101410' d='M7.25 6.1h1.5v4.2h-1.5zm0 5.1h1.5v1.5h-1.5z'/></svg>";
    return icon;
  }

  function stakeOf(bet) {
    const matched = num(bet.matched_stake);
    return matched == null ? 0 : matched;
  }

  function profitOf(bet) {
    const profit = num(bet.profit);
    return profit == null ? 0 : profit;
  }

  function isSettled(bet) {
    return SETTLED.has(String(bet.outcome || "").toLowerCase());
  }

  function labelForBet(bet) {
    const selection = String(bet.selection || "").trim();
    const alert = String(bet.bet || "").trim();
    if (selection && !/^[a-z0-9-]+$/i.test(selection)) return selection;
    return alert || selection || "—";
  }

  function dayOf(bet) {
    return String(bet.placed_at || "").slice(0, 10);
  }

  function monthOf(bet) {
    const month = String(bet.placed_at || "").slice(0, 7);
    return month || "—";
  }

  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
    if (!parts || !day) return iso;
    return `${day} ${MONTHS_SHORT[parts.index]} ${parts.year}`;
  }

  function formatWhen(iso) {
    const day = formatDay(iso);
    const time = String(iso || "").match(/T(\d{2}):(\d{2})/);
    return time ? `${day} ${time[1]}:${time[2]}` : day;
  }

  function formatMonth(key) {
    const parts = monthParts(key);
    if (!parts) return key;
    return `${MONTHS[parts.index]} ${parts.year}`;
  }

  function booksIn(bets) {
    const present = new Set(bets.map((bet) => bet.book).filter(Boolean));
    const ordered = BOOK_ORDER.filter((book) => present.has(book));
    const extras = [...present].filter((book) => !BOOK_ORDER.includes(book)).sort();
    return ordered.concat(extras);
  }

  function summarize(bets) {
    const summary = {
      count: bets.length,
      settled: 0,
      won: 0,
      lost: 0,
      push: 0,
      voided: 0,
      pending: 0,
      staked: 0,
      profit: 0,
      evStake: 0,
      evWeighted: 0,
    };
    for (const bet of bets) {
      const stake = stakeOf(bet);
      summary.staked += stake;
      summary.profit += profitOf(bet);
      const outcome = String(bet.outcome || "").toLowerCase();
      if (outcome === "won") summary.won += 1;
      else if (outcome === "lost") summary.lost += 1;
      else if (outcome === "push") summary.push += 1;
      else if (outcome === "void") summary.voided += 1;
      else summary.pending += 1;
      if (SETTLED.has(outcome)) summary.settled += 1;
      const ev = num(bet.ev_pct);
      if (ev != null && stake > 0) {
        summary.evStake += stake;
        summary.evWeighted += ev * stake;
      }
    }
    summary.roi = summary.staked ? summary.profit / summary.staked : null;
    summary.avgEv = summary.evStake ? summary.evWeighted / summary.evStake : null;
    return summary;
  }

  function filteredBets() {
    const query = state.market.trim().toLowerCase();
    return state.data.bets.filter((bet) => {
      if (state.book && bet.book !== state.book) return false;
      if (state.league && bet.tournament !== state.league) return false;
      if (query) {
        const haystack = `${bet.market} ${bet.bet} ${bet.selection} ${bet.matchup}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      const day = dayOf(bet);
      if (state.from && day && day < state.from) return false;
      if (state.to && day && day > state.to) return false;
      if (state.settled && !isSettled(bet)) return false;
      return true;
    });
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function kpi(label, value, sub, valueClass) {
    const card = el("article", "kpi");
    card.append(el("span", null, label));
    card.append(el("strong", valueClass || "", value));
    if (sub) card.append(el("em", null, sub));
    return card;
  }

  function renderKpis(summary) {
    els.kpis.replaceChildren(
      kpi("Profit", money(summary.profit), ratio(summary.roi) + " ROI", tone(summary.profit)),
      kpi("Wagered", money(summary.staked), `${summary.count.toLocaleString()} bets`),
      kpi(
        "Record",
        `${summary.won.toLocaleString()}–${summary.lost.toLocaleString()}`,
        `${summary.push} push · ${summary.voided} void · ${summary.pending} open`,
      ),
      kpi("Hit rate", summary.won + summary.lost ? ratio(summary.won / (summary.won + summary.lost)) : "—", "wins / decisions"),
      kpi("Avg EV", points(summary.avgEv), "stake-weighted"),
      kpi("Open", summary.pending.toLocaleString(), "no outcome yet"),
    );
  }

  function renderBooks(allBooks) {
    const all = el("button", null, "All books");
    all.type = "button";
    all.setAttribute("aria-pressed", state.book ? "false" : "true");
    all.addEventListener("click", () => {
      state.book = "";
      state.betLimit = PAGE;
      render();
    });
    const buttons = [all];
    for (const book of allBooks) {
      const button = el("button", null, book);
      button.type = "button";
      button.setAttribute("aria-pressed", state.book === book ? "true" : "false");
      button.addEventListener("click", () => {
        state.book = state.book === book ? "" : book;
        state.betLimit = PAGE;
        render();
      });
      buttons.push(button);
    }
    els.books.replaceChildren(...buttons);
  }

  function fillFilters() {
    const leagues = [...new Set(state.data.bets.map((bet) => bet.tournament).filter(Boolean))].sort();
    const options = [new Option("All leagues", "")];
    for (const league of leagues) options.push(new Option(league, league));
    els.league.replaceChildren(...options);
    const days = state.data.bets.map(dayOf).filter(Boolean).sort();
    if (days.length) {
      els.from.min = days[0];
      els.from.max = days[days.length - 1];
      els.to.min = days[0];
      els.to.max = days[days.length - 1];
    }
  }

  function seriesOf(bets) {
    const rows = bets
      .filter((bet) => num(bet.profit) != null && bet.placed_at)
      .slice()
      .sort((a, b) => String(a.placed_at).localeCompare(String(b.placed_at)));
    let running = 0;
    return rows.map((bet) => {
      running += bet.profit;
      return { at: bet.placed_at, profit: running };
    });
  }

  function chartDay(point) {
    return String(point?.at || "").slice(0, 10);
  }

  function brushIndexes() {
    if (!state.chartBrush || !state.chartPoints.length) return null;
    return [
      Math.min(state.chartBrush.anchor, state.chartBrush.current),
      Math.max(state.chartBrush.anchor, state.chartBrush.current),
    ];
  }

  function drawRangeBand(ctx, points, start, end, height, pad) {
    const left = points[start].x;
    const right = points[end].x;
    const top = pad.top;
    const bottom = height - pad.bottom;
    const width = Math.max(2, right - left);
    ctx.save();
    ctx.fillStyle = "rgba(228, 195, 106, 0.14)";
    ctx.fillRect(left, top, width, bottom - top);
    ctx.strokeStyle = "rgba(228, 195, 106, 0.65)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, bottom);
    ctx.moveTo(right, top);
    ctx.lineTo(right, bottom);
    ctx.stroke();
    ctx.restore();
  }

  function nearestChartIndex(clientX) {
    const rect = els.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    let nearestIndex = 0;
    let best = Math.abs(state.chartPoints[0].x - x);
    state.chartPoints.forEach((point, index) => {
      const distance = Math.abs(point.x - x);
      if (distance < best) {
        nearestIndex = index;
        best = distance;
      }
    });
    return nearestIndex;
  }

  function redrawChart() {
    if (state.data) drawChart(filteredBets());
  }

  function drawChart(bets) {
    const canvas = els.canvas;
    const width = canvas.clientWidth || 600;
    const height = canvas.clientHeight || 240;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    canvas.classList.toggle("is-brushing", Boolean(state.chartBrush));

    const points = seriesOf(bets);
    state.chartPoints = points.map((point, index) => ({
      ...point,
      x: 0,
      y: 0,
      index,
    }));
    if (state.hoverIndex != null && (state.hoverIndex < 0 || state.hoverIndex >= points.length)) {
      state.hoverIndex = null;
    }
    if (!points.length) {
      state.hoverIndex = null;
      els.readout.textContent = "No settled profit in this slice.";
      return;
    }

    const pad = { top: 16, right: 16, bottom: 36, left: 72 };
    const values = points.map((point) => point.profit);
    let min = Math.min(0, ...values);
    let max = Math.max(0, ...values);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const xAt = (index) => {
      if (points.length === 1) return pad.left + (width - pad.left - pad.right) / 2;
      return pad.left + (index / (points.length - 1)) * (width - pad.left - pad.right);
    };
    const yAt = (value) => pad.top + ((max - value) / (max - min)) * (height - pad.top - pad.bottom);

    ctx.strokeStyle = "#2c352e";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, yAt(0));
    ctx.lineTo(width - pad.right, yAt(0));
    ctx.stroke();

    ctx.fillStyle = "#9aa394";
    ctx.font = "12px IBM Plex Mono, ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(money(max), pad.left - 8, pad.top);
    ctx.textBaseline = "bottom";
    ctx.fillText(money(min), pad.left - 8, height - pad.bottom - 2);
    drawXAxis(ctx, points, xAt, height, pad);

    points.forEach((point, index) => {
      state.chartPoints[index].x = xAt(index);
      state.chartPoints[index].y = yAt(point.profit);
    });

    const brush = brushIndexes();
    if (brush) drawRangeBand(ctx, state.chartPoints, brush[0], brush[1], height, pad);

    const end = points[points.length - 1].profit;
    ctx.beginPath();
    state.chartPoints.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = end >= 0 ? "#8fce78" : "#ef8b72";
    ctx.lineWidth = 2;
    ctx.stroke();

    const last = state.chartPoints[state.chartPoints.length - 1];
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
    ctx.fill();

    if (brush) {
      els.readout.textContent = `${formatDay(points[brush[0]].at)} – ${formatDay(points[brush[1]].at)}`;
      return;
    }

    const hover = state.hoverIndex == null ? null : state.chartPoints[state.hoverIndex];
    if (hover) {
      drawHoverGuide(ctx, hover, width, height, pad);
      els.readout.textContent = `${formatDay(hover.at)} · ${money(hover.profit)} cumulative`;
    } else {
      els.readout.textContent = `${formatDay(points[0].at)} – ${formatDay(points[points.length - 1].at)} · ${money(end)}`;
    }
  }

  function drawHoverGuide(ctx, point, width, height, pad) {
    const axisY = height - pad.bottom;
    ctx.save();
    ctx.strokeStyle = "rgba(228, 195, 106, 0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(point.x, pad.top);
    ctx.lineTo(point.x, axisY);
    ctx.stroke();

    ctx.fillStyle = "#e4c36a";
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#101410";
    ctx.stroke();

    const label = formatWhen(point.at);
    ctx.font = "11px IBM Plex Mono, ui-monospace, monospace";
    const boxW = ctx.measureText(label).width + 12;
    const boxH = 18;
    const boxX = Math.max(4, Math.min(width - boxW - 4, point.x - boxW / 2));
    const boxY = axisY + 6;
    ctx.fillStyle = "#101410";
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 4);
    ctx.fill();
    ctx.strokeStyle = "#e4c36a";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#e4c36a";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, boxX + 6, boxY + boxH / 2);
    ctx.restore();
  }

  function axisDate(iso, withYear) {
    const parts = monthParts(iso);
    if (!parts) return "";
    const day = Number(String(iso).slice(8, 10)) || 1;
    const stem = `${MONTHS_SHORT[parts.index]} ${day}`;
    return withYear ? `${stem}, ${parts.year}` : stem;
  }

  function drawXAxis(ctx, points, xAt, height, pad) {
    const plotWidth = Math.max(0, xAt(points.length - 1) - xAt(0));
    const slots = Math.max(2, Math.min(6, Math.floor(plotWidth / 96) || 2));
    const indexes = [];
    for (let slot = 0; slot < slots; slot += 1) {
      const index = points.length === 1 ? 0 : Math.round(slot * (points.length - 1) / (slots - 1));
      if (indexes[indexes.length - 1] !== index) indexes.push(index);
    }
    ctx.fillStyle = "#9aa394";
    ctx.font = "11px IBM Plex Mono, ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.strokeStyle = "#2c352e";
    ctx.lineWidth = 1;
    let lastX = -Infinity;
    indexes.forEach((index, position) => {
      const x = xAt(index);
      const isLast = position === indexes.length - 1;
      if (position > 0 && !isLast && x - lastX < 72) return;
      if (isLast && x - lastX < 72 && position > 0) return;
      ctx.beginPath();
      ctx.moveTo(x, height - pad.bottom);
      ctx.lineTo(x, height - pad.bottom + 5);
      ctx.stroke();
      ctx.fillText(axisDate(points[index].at, position === 0), x, height - pad.bottom + 8);
      lastX = x;
    });
  }

  function onChartMove(event) {
    if (!state.chartPoints.length || !state.data || state.chartBrush) return;
    const nearestIndex = nearestChartIndex(event.clientX);
    if (state.hoverIndex === nearestIndex) return;
    state.hoverIndex = nearestIndex;
    redrawChart();
  }

  function onChartPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    if (!state.chartPoints.length || !state.data) return;
    event.preventDefault();
    const index = nearestChartIndex(event.clientX);
    state.chartBrush = { anchor: index, current: index };
    state.hoverIndex = null;
    els.canvas.setPointerCapture(event.pointerId);
    redrawChart();
  }

  function onChartPointerMove(event) {
    if (state.chartBrush) {
      if (!state.chartPoints.length) return;
      const index = nearestChartIndex(event.clientX);
      if (state.chartBrush.current === index) return;
      state.chartBrush.current = index;
      redrawChart();
      return;
    }
    onChartMove(event);
  }

  function onChartPointerUp(event) {
    if (!state.chartBrush || !state.chartPoints.length) {
      state.chartBrush = null;
      return;
    }
    const start = Math.min(state.chartBrush.anchor, state.chartBrush.current);
    const end = Math.max(state.chartBrush.anchor, state.chartBrush.current);
    state.chartBrush = null;
    if (els.canvas.hasPointerCapture?.(event.pointerId)) {
      els.canvas.releasePointerCapture(event.pointerId);
    }
    state.from = chartDay(state.chartPoints[start]);
    state.to = chartDay(state.chartPoints[end]);
    els.from.value = state.from;
    els.to.value = state.to;
    state.betLimit = PAGE;
    render();
  }

  function onChartPointerCancel() {
    if (!state.chartBrush) return;
    state.chartBrush = null;
    redrawChart();
  }

  function groupRows(bets, keyFn) {
    const books = booksIn(bets);
    const groups = new Map();
    for (const bet of bets) {
      const key = keyFn(bet) || "—";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(bet);
    }
    const rows = [...groups.entries()].map(([label, items]) => {
      const byBook = {};
      for (const book of books) byBook[book] = summarize(items.filter((bet) => bet.book === book));
      return { label, total: summarize(items), byBook };
    });
    const { key, dir } = state.sort;
    const sign = dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (key === "label") return a.label.localeCompare(b.label, undefined, { numeric: true }) * sign;
      const left = key === "total" ? a.total.profit : a.byBook[key]?.profit || 0;
      const right = key === "total" ? b.total.profit : b.byBook[key]?.profit || 0;
      return (left - right) * sign || a.label.localeCompare(b.label);
    });
    return { books, rows };
  }

  function summaryCell(summary) {
    const cell = el("td", "num cell");
    if (!summary || !summary.count) {
      cell.append(el("span", "muted", "—"));
      return cell;
    }
    cell.title = `Wagered ${money(summary.staked)} · ${summary.count} bets`;
    cell.append(el("strong", tone(summary.profit), money(summary.profit)));
    cell.append(el("small", null, `${ratio(summary.roi)} · ${summary.count.toLocaleString()}`));
    return cell;
  }

  function renderMatrix(bets, keyFn, labelName) {
    const { books, rows } = groupRows(bets, keyFn);
    const table = el("table");
    const head = el("thead");
    const headRow = el("tr");
    const columns = [{ key: "label", name: labelName }].concat(
      books.map((book) => ({ key: book, name: book })),
      [{ key: "total", name: "Total" }],
    );
    if (books.length < 2) columns.pop();
    for (const column of columns) {
      const th = el("th", column.key === "label" ? "sortable" : "num sortable", column.name);
      if (state.sort.key === column.key) th.textContent += state.sort.dir === "asc" ? " ↑" : " ↓";
      th.addEventListener("click", () => {
        if (state.sort.key === column.key) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
        else state.sort = { key: column.key, dir: column.key === "label" ? "asc" : "desc" };
        render();
      });
      headRow.append(th);
    }
    head.append(headRow);
    table.append(head);

    const body = el("tbody");
    for (const row of rows) {
      const tr = el("tr");
      const label = el("td", null, state.view === "month" ? formatMonth(row.label) : row.label);
      tr.append(label);
      for (const book of books) tr.append(summaryCell(row.byBook[book]));
      if (books.length >= 2) tr.append(summaryCell(row.total));
      body.append(tr);
    }
    const total = summarize(bets);
    const totalRow = el("tr", "total");
    totalRow.append(el("td", null, "All"));
    for (const book of books) {
      totalRow.append(summaryCell(summarize(bets.filter((bet) => bet.book === book))));
    }
    if (books.length >= 2) totalRow.append(summaryCell(total));
    body.append(totalRow);
    table.append(body);

    const wrap = el("div", "table-wrap");
    wrap.append(table);
    els.tableRoot.replaceChildren(wrap);
    els.tableMeta.textContent = `${rows.length.toLocaleString()} ${labelName.toLowerCase()}${rows.length === 1 ? "" : "s"}`;
  }

  function oddsCell(bet) {
    const cell = el("td");
    const display = formatOdds(bet.odds);
    const discordRaw = bet.discord_odds;
    if (discordRaw == null || String(discordRaw).trim() === "") {
      cell.textContent = display;
      return cell;
    }
    const discord = formatOdds(discordRaw);
    const warn = oddsDiffer(bet.odds, discordRaw);
    const trigger = el("span", "odds-hover", display);
    trigger.tabIndex = 0;
    trigger.dataset.discord = discord;
    if (warn) {
      trigger.dataset.warn = "1";
      trigger.append(oddsWarnIcon());
    }
    trigger.setAttribute(
      "aria-label",
      warn
        ? `Bet odds ${display}, Discord odds ${discord}, more than ${ODDS_GAP_LABEL} apart`
        : `Bet odds ${display}, Discord odds ${discord}`,
    );
    cell.append(trigger);
    return cell;
  }

  function betsForStatus(bets) {
    return bets.filter((bet) => (state.betStatus === "open" ? !isSettled(bet) : isSettled(bet)));
  }

  function syncBetsStatus() {
    els.betsStatus.hidden = state.view !== "bets";
    els.betsOpen.checked = state.betStatus === "open";
  }

  function renderBets(bets) {
    const statusBets = betsForStatus(bets);
    if (!statusBets.length) {
      const label = state.betStatus === "open" ? "open" : "settled";
      els.tableRoot.replaceChildren(el("p", "muted", `No ${label} bets match these filters.`));
      els.tableMeta.textContent = `0 ${label} bets`;
      return;
    }
    const shown = statusBets
      .slice()
      .sort((a, b) => String(b.placed_at).localeCompare(String(a.placed_at)))
      .slice(0, state.betLimit);
    const table = el("table", "bets");
    const head = el("tr");
    for (const name of ["Date", "Book", "League", "Matchup", "Market", "Bet", "Odds", "EV", "Matched", "Result", "Profit"]) {
      head.append(el("th", ["EV", "Matched", "Profit"].includes(name) ? "num" : "", name));
    }
    const headEl = el("thead");
    headEl.append(head);
    table.append(headEl);
    const body = el("tbody");
    for (const bet of shown) {
      const tr = el("tr");
      const cells = [
        formatDay(bet.placed_at),
        bet.book || "—",
        bet.tournament || "—",
        bet.matchup || "—",
        bet.market || "—",
        labelForBet(bet),
      ];
      for (const value of cells) tr.append(el("td", null, value));
      tr.append(oddsCell(bet));
      tr.append(el("td", "num", points(num(bet.ev_pct))));
      tr.append(el("td", "num", money(stakeOf(bet))));
      const result = el("td");
      result.append(el("span", `tag ${tone(num(bet.profit))}`, bet.outcome || "open"));
      tr.append(result);
      tr.append(el("td", `num ${tone(num(bet.profit))}`, money(num(bet.profit))));
      body.append(tr);
    }
    table.append(body);
    const wrap = el("div", "table-wrap");
    wrap.append(table);
    const fragment = document.createDocumentFragment();
    fragment.append(wrap);
    if (shown.length < statusBets.length) {
      const more = el("button", "more", `Show more (${shown.length.toLocaleString()} of ${statusBets.length.toLocaleString()})`);
      more.type = "button";
      more.addEventListener("click", () => {
        state.betLimit += PAGE;
        render();
      });
      fragment.append(more);
    }
    els.tableRoot.replaceChildren(fragment);
    const label = state.betStatus === "open" ? "open" : "settled";
    els.tableMeta.textContent = `${statusBets.length.toLocaleString()} ${label} bets`;
  }

  function renderTable(bets) {
    if (state.view === "bets") {
      renderBets(bets);
      return;
    }
    if (!bets.length) {
      els.tableRoot.replaceChildren(el("p", "muted", "No bets match these filters."));
      els.tableMeta.textContent = "";
      return;
    }
    if (state.view === "market") renderMatrix(bets, (bet) => bet.market, "Market");
    else if (state.view === "month") renderMatrix(bets, monthOf, "Month");
    else renderMatrix(bets, (bet) => bet.tournament, "League");
  }

  function average(values) {
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function renderBovada() {
    const rows = state.data.bovada || [];
    if (!rows.length) {
      els.bovadaKpis.replaceChildren();
      els.bovadaRoot.replaceChildren(el("p", "muted", "Bovada picks are not in the database."));
      return;
    }
    const evs = rows.map((row) => num(row.ev_pct)).filter((value) => value != null);
    const clvs = rows.map((row) => num(row.clv_pct)).filter((value) => value != null);
    const positiveClv = clvs.filter((value) => value > 0).length;
    const placed = rows.filter((row) => num(row.stake));
    const staked = placed.reduce((sum, row) => sum + row.stake, 0);
    const profit = placed.reduce((sum, row) => sum + (num(row.profit) || 0), 0);
    const expected = placed.reduce((sum, row) => {
      const ev = num(row.ev_pct);
      return ev == null ? sum : sum + row.stake * (ev / 100);
    }, 0);
    const record = { won: 0, lost: 0, push: 0 };
    for (const row of placed) {
      const outcome = String(row.outcome || "").toLowerCase();
      if (outcome === "won") record.won += 1;
      else if (outcome === "push") record.push += 1;
      else if (outcome) record.lost += 1;
    }
    els.bovadaKpis.replaceChildren(
      kpi("Picks", rows.length.toLocaleString(), `${points(average(evs))} avg EV`),
      kpi("Avg CLV", points(average(clvs)), clvs.length ? `${ratio(positiveClv / clvs.length)} positive` : "no closing line"),
      kpi("Staked", money(staked), `${placed.length} bets placed`),
      kpi("Profit", money(profit), staked ? `${ratio(profit / staked)} ROI` : "—", tone(profit)),
      kpi("Expected", money(expected), "stake × EV, placed bets"),
      kpi("Record", `${record.won}–${record.lost}`, `${record.push} push`),
    );

    const sports = new Map();
    for (const row of rows) {
      const sport = row.sport || "—";
      if (!sports.has(sport)) sports.set(sport, []);
      sports.get(sport).push(row);
    }
    const table = el("table");
    const head = el("tr");
    for (const name of ["Sport", "Picks", "Avg EV", "Avg CLV", "Bets", "Staked", "Profit", "ROI"]) {
      head.append(el("th", name === "Sport" ? "" : "num", name));
    }
    const headEl = el("thead");
    headEl.append(head);
    table.append(headEl);
    const body = el("tbody");
    const sportRows = [...sports.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [sport, items] of sportRows) {
      const placedItems = items.filter((row) => num(row.stake));
      const sportStake = placedItems.reduce((sum, row) => sum + row.stake, 0);
      const sportProfit = placedItems.reduce((sum, row) => sum + (num(row.profit) || 0), 0);
      const tr = el("tr");
      tr.append(el("td", null, sport));
      tr.append(el("td", "num", String(items.length)));
      tr.append(el("td", "num", points(average(items.map((row) => num(row.ev_pct)).filter((value) => value != null)))));
      tr.append(el("td", "num", points(average(items.map((row) => num(row.clv_pct)).filter((value) => value != null)))));
      tr.append(el("td", "num", String(placedItems.length)));
      tr.append(el("td", "num", money(sportStake)));
      tr.append(el("td", `num ${tone(sportProfit)}`, money(sportProfit)));
      tr.append(el("td", "num", sportStake ? ratio(sportProfit / sportStake) : "—"));
      body.append(tr);
    }
    table.append(body);
    const wrap = el("div", "table-wrap");
    wrap.append(table);
    els.bovadaRoot.replaceChildren(wrap);
  }

  function viewFromHash() {
    const hash = location.hash.replace("#", "");
    if (hash === "markets") return "market";
    if (hash === "months") return "month";
    if (hash === "bets") return "bets";
    return "league";
  }

  function readUrl() {
    const params = new URLSearchParams(location.search);
    state.book = params.get("book") || "";
    state.league = params.get("league") || "";
    state.market = params.get("market") || "";
    state.from = params.get("from") || "";
    state.to = params.get("to") || "";
    state.settled = params.get("settled") === "1";
    state.view = viewFromHash();
    state.sort = state.view === "month" ? { key: "label", dir: "asc" } : { key: "total", dir: "desc" };
  }

  function writeUrl() {
    const params = new URLSearchParams();
    if (state.book) params.set("book", state.book);
    if (state.league) params.set("league", state.league);
    if (state.market) params.set("market", state.market);
    if (state.from) params.set("from", state.from);
    if (state.to) params.set("to", state.to);
    if (state.settled) params.set("settled", "1");
    const query = params.toString();
    const hash = { market: "#markets", month: "#months", bets: "#bets" }[state.view] || "";
    const next = `${location.pathname}${query ? `?${query}` : ""}${hash}`;
    const current = `${location.pathname}${location.search}${location.hash}`;
    if (current !== next) history.replaceState(null, "", next);
  }

  function render() {
    hideOddsTip();
    state.hoverIndex = null;
    const bets = filteredBets();
    const summary = summarize(bets);
    renderBooks(booksIn(state.data.bets));
    renderKpis(summary);
    drawChart(bets);
    syncBetsStatus();
    renderTable(bets);
    for (const tab of els.views.querySelectorAll("[data-view]")) {
      tab.setAttribute("aria-selected", tab.dataset.view === state.view ? "true" : "false");
    }
    writeUrl();
  }

  function showError(message) {
    els.banner.hidden = false;
    els.banner.textContent = message;
    els.snapshot.textContent = "Bets unavailable";
  }

  function toDashboardBet(row) {
    return {
      placed_at: row.placed_at,
      book: row.book || "",
      tournament: row.tournament,
      matchup: row.matchup,
      market: row.market,
      bet: row.bet,
      selection: row.selection,
      ev_pct: row.ev_pct,
      odds: row.display_odds == null ? row.discord_odds : row.display_odds,
      discord_odds: row.discord_odds,
      matched_stake: row.matched_stake,
      outcome: row.outcome,
      profit: row.profit,
    };
  }

  async function loadBets() {
    const rows = [];
    let offset = 0;
    const select = "placed_at,book,tournament,matchup,market,bet,selection,ev_pct,display_odds,discord_odds,matched_stake,outcome,profit";
    while (true) {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/dashboard_bets?select=${select}&order=id.asc`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            Range: `${offset}-${offset + FETCH_PAGE - 1}`,
          },
        },
      );
      if (!response.ok) throw new Error(String(response.status));
      const page = await response.json();
      for (const row of page) rows.push(toDashboardBet(row));
      if (page.length < FETCH_PAGE) return rows;
      offset += FETCH_PAGE;
    }
  }

  async function init() {
    let bets;
    try {
      bets = await loadBets();
    } catch (error) {
      showError("Could not load bets from Supabase.");
      return;
    }
    const latest = bets.reduce((max, bet) => (bet.placed_at > max ? bet.placed_at : max), "");
    state.data = { bets, bovada: [] };
    const when = latest
      ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(latest))
      : "no bets yet";
    els.snapshot.textContent = `${bets.length.toLocaleString()} bets · latest ${when}`;
    readUrl();
    fillFilters();
    if ([...els.league.options].some((option) => option.value === state.league)) els.league.value = state.league;
    els.market.value = state.market;
    els.from.value = state.from;
    els.to.value = state.to;
    els.settled.checked = state.settled;
    renderBovada();
    render();
  }

  els.league.addEventListener("change", () => {
    state.league = els.league.value;
    state.betLimit = PAGE;
    render();
  });
  els.market.addEventListener("input", () => {
    state.market = els.market.value;
    state.betLimit = PAGE;
    render();
  });
  els.from.addEventListener("change", () => {
    state.from = els.from.value;
    state.betLimit = PAGE;
    render();
  });
  els.to.addEventListener("change", () => {
    state.to = els.to.value;
    state.betLimit = PAGE;
    render();
  });
  els.settled.addEventListener("change", () => {
    state.settled = els.settled.checked;
    state.betLimit = PAGE;
    render();
  });
  els.clear.addEventListener("click", () => {
    state.book = "";
    state.league = "";
    state.market = "";
    state.from = "";
    state.to = "";
    state.settled = false;
    state.betStatus = "settled";
    state.betLimit = PAGE;
    els.league.value = "";
    els.market.value = "";
    els.from.value = "";
    els.to.value = "";
    els.settled.checked = false;
    render();
  });
  els.betsOpen.addEventListener("change", () => {
    state.betStatus = els.betsOpen.checked ? "open" : "settled";
    state.betLimit = PAGE;
    render();
  });
  function controlFromEvent(event) {
    const node = event.target && event.target.nodeType === 1 ? event.target : event.target && event.target.parentElement;
    return node && node.closest ? node.closest("[data-view], button") : null;
  }

  els.views.addEventListener("click", (event) => {
    const tab = controlFromEvent(event);
    if (!tab || !tab.dataset.view) return;
    event.preventDefault();
    state.view = tab.dataset.view;
    state.sort = state.view === "month" ? { key: "label", dir: "asc" } : { key: "total", dir: "desc" };
    state.betLimit = PAGE;
    render();
  });
  window.addEventListener("hashchange", () => {
    const view = viewFromHash();
    if (view === state.view) return;
    state.view = view;
    state.sort = view === "month" ? { key: "label", dir: "asc" } : { key: "total", dir: "desc" };
    state.betLimit = PAGE;
    render();
  });
  els.canvas.addEventListener("pointerdown", onChartPointerDown);
  els.canvas.addEventListener("pointermove", onChartPointerMove);
  els.canvas.addEventListener("pointerup", onChartPointerUp);
  els.canvas.addEventListener("pointercancel", onChartPointerCancel);
  els.canvas.addEventListener("pointerleave", () => {
    if (state.chartBrush || state.hoverIndex == null) return;
    state.hoverIndex = null;
    redrawChart();
  });
  window.addEventListener("resize", redrawChart);

  els.tableRoot.addEventListener("mouseover", (event) => {
    const target = oddsHoverTarget(event);
    if (target) placeOddsTip(target);
  });
  els.tableRoot.addEventListener("mouseout", (event) => {
    const target = oddsHoverTarget(event);
    if (!target) return;
    if (event.relatedTarget && target.contains(event.relatedTarget)) return;
    hideOddsTip();
  });
  els.tableRoot.addEventListener("focusin", (event) => {
    const target = oddsHoverTarget(event);
    if (target) placeOddsTip(target);
  });
  els.tableRoot.addEventListener("focusout", (event) => {
    const target = oddsHoverTarget(event);
    if (!target) return;
    if (event.relatedTarget && target.contains(event.relatedTarget)) return;
    hideOddsTip();
  });
  document.addEventListener("scroll", hideOddsTip, true);

  init();
})();
