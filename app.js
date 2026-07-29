import { supabaseConfig } from "./supabase-config.js";

const ROSTER = [
  "Steven", "Shiv", "Harry", "Oliver", "Henry", "Miles",
  "James", "Zach", "Max", "Will", "Graham", "David",
];

// Aug 16, 2026 through Sep 8, 2026 inclusive — the day before the
// 2026 NFL regular season opener (Wed, Sept 9, 2026).
const RANGE_START = new Date(2026, 7, 16);
const RANGE_END = new Date(2026, 8, 8);

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ACTIVE_NAME_KEY = "draftPollActiveName";
const LOCAL_RESPONSES_KEY = "draftPollResponsesLocal";

function pad(n) {
  return String(n).padStart(2, "0");
}

function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatHour(hour) {
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${period}`;
}

function generateSlots() {
  const slots = [];
  for (let d = new Date(RANGE_START); d <= RANGE_END; d.setDate(d.getDate() + 1)) {
    const day = d.getDay(); // 0 = Sun ... 6 = Sat
    const isWeekend = day === 0 || day === 6;
    const times = isWeekend ? [15, 18] : [18];
    for (const hour of times) {
      slots.push({
        id: `${dateKey(d)}-${pad(hour)}:00`,
        dow: DAY_NAMES[day],
        dateLabel: `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`,
        timeLabel: formatHour(hour),
        month: d.getMonth(),
        isWeekend,
      });
    }
  }
  return slots;
}

const SLOTS = generateSlots();

function slotLabel(slot) {
  return `${slot.dow}, ${slot.dateLabel} — ${slot.timeLabel}`;
}

// Shortest prefix of a name that is unique within the roster, for narrow-screen headers.
function shortLabel(name) {
  for (let len = 1; len <= name.length; len++) {
    const prefix = name.slice(0, len);
    if (ROSTER.filter((n) => n.startsWith(prefix)).length === 1) return prefix;
  }
  return name;
}

function isConfigured() {
  return (
    Boolean(supabaseConfig.url) &&
    supabaseConfig.url !== "https://YOUR_PROJECT_REF.supabase.co" &&
    Boolean(supabaseConfig.anonKey) &&
    supabaseConfig.anonKey !== "YOUR_ANON_KEY"
  );
}

function normalizeEntry(value) {
  if (Array.isArray(value)) return { unavailable: value, done: false };
  if (value && typeof value === "object") {
    return { unavailable: value.unavailable || [], done: Boolean(value.done) };
  }
  return { unavailable: [], done: false };
}

async function createSupabaseStore() {
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.111.0");
  const supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey);
  let notify = () => {};

  async function fetchAll() {
    const { data, error } = await supabase.from("responses").select("name, unavailable, done");
    if (error) throw error;
    const result = {};
    for (const row of data) result[row.name] = normalizeEntry(row);
    return result;
  }

  return {
    subscribe(callback) {
      notify = callback;
      fetchAll().then(callback).catch(() => {});
      const channel = supabase
        .channel("responses-changes")
        .on("postgres_changes", { event: "*", schema: "public", table: "responses" }, () => {
          fetchAll().then(callback).catch(() => {});
        })
        .subscribe();
      return () => supabase.removeChannel(channel);
    },
    async refresh() {
      notify(await fetchAll());
    },
    async save(name, entry) {
      const { error } = await supabase.from("responses").upsert({
        name,
        unavailable: entry.unavailable,
        done: entry.done,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
  };
}

function readLocalResponses() {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_RESPONSES_KEY) || "{}");
    const result = {};
    for (const [name, value] of Object.entries(raw)) result[name] = normalizeEntry(value);
    return result;
  } catch {
    return {};
  }
}

function createLocalStore() {
  let notify = () => {};
  return {
    subscribe(callback) {
      notify = callback;
      callback(readLocalResponses());
      const handler = (e) => {
        if (!e.key || e.key === LOCAL_RESPONSES_KEY) callback(readLocalResponses());
      };
      window.addEventListener("storage", handler);
      return () => window.removeEventListener("storage", handler);
    },
    async refresh() {
      notify(readLocalResponses());
    },
    async save(name, entry) {
      const data = readLocalResponses();
      data[name] = entry;
      localStorage.setItem(LOCAL_RESPONSES_KEY, JSON.stringify(data));
      window.dispatchEvent(new StorageEvent("storage", { key: LOCAL_RESPONSES_KEY }));
    },
  };
}

let store;
let responses = {}; // name -> { unavailable: [slotId], done: bool }
let activeName = localStorage.getItem(ACTIVE_NAME_KEY) || "";
let justMe = false;

const cellMap = new Map(); // `${slotId}|${name}` -> <td>
const rowMap = new Map(); // slotId -> { tr, badge, okMark }
const headerCells = new Map(); // name -> <th>

function entryFor(name) {
  return responses[name] || { unavailable: [], done: false };
}

function isUnavailable(name, slotId) {
  return entryFor(name).unavailable.includes(slotId);
}

function conflictsFor(slotId) {
  return ROSTER.filter((name) => isUnavailable(name, slotId));
}

// Active person's column comes first so voting needs no horizontal scrolling.
function columnOrder() {
  if (!activeName) return ROSTER;
  return [activeName, ...ROSTER.filter((n) => n !== activeName)];
}

function setupNameSelector() {
  const select = document.getElementById("whoAmI");
  for (const name of ROSTER) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }
  select.value = activeName;
  select.addEventListener("change", () => {
    activeName = select.value;
    localStorage.setItem(ACTIVE_NAME_KEY, activeName);
    if (!activeName) setJustMe(false);
    buildTable();
    render();
  });
}

function setJustMe(on) {
  justMe = on;
  const btn = document.getElementById("justMeBtn");
  btn.setAttribute("aria-pressed", String(on));
  btn.classList.toggle("active", on);
}

function setupButtons() {
  document.getElementById("justMeBtn").addEventListener("click", () => {
    setJustMe(!justMe);
    render();
  });
  document.getElementById("doneBtn").addEventListener("click", () => {
    if (!activeName) return;
    const current = entryFor(activeName);
    persist(activeName, { ...current, done: !current.done });
  });
}

// --- Toast / save feedback ---------------------------------------------------

let toastTimer = null;
let retryAction = null;

function showToast(message, kind, retry) {
  const toast = document.getElementById("toast");
  const retryBtn = document.getElementById("toastRetry");
  document.getElementById("toastMsg").textContent = message;
  toast.className = `toast ${kind}`;
  toast.hidden = false;
  retryAction = retry || null;
  retryBtn.hidden = !retry;
  clearTimeout(toastTimer);
  if (kind === "ok") {
    toastTimer = setTimeout(() => { toast.hidden = true; }, 1400);
  }
}

function setupToast() {
  document.getElementById("toastRetry").addEventListener("click", () => {
    document.getElementById("toast").hidden = true;
    if (retryAction) retryAction();
  });
}

// Optimistic save: update the UI immediately, revert and offer retry on failure.
async function persist(name, entry) {
  const prev = responses[name];
  responses[name] = entry;
  render();
  try {
    await store.save(name, entry);
    showToast("Saved ✓", "ok");
  } catch {
    responses[name] = prev;
    render();
    showToast("Couldn't save — check your connection.", "error", () => persist(name, entry));
  }
}

function handleCellActivate(td) {
  const name = td.dataset.name;
  if (name !== activeName) return;
  const slotId = td.dataset.slot;
  const current = entryFor(name);
  const set = new Set(current.unavailable);
  if (set.has(slotId)) set.delete(slotId);
  else set.add(slotId);
  persist(name, { ...current, unavailable: Array.from(set) });
}

// --- Table construction ------------------------------------------------------

function buildTable() {
  const order = columnOrder();
  const headerRow = document.getElementById("headerRow");
  const tbody = document.getElementById("tableBody");
  headerRow.innerHTML = "";
  tbody.innerHTML = "";
  cellMap.clear();
  rowMap.clear();
  headerCells.clear();

  const corner = document.createElement("th");
  corner.className = "corner";
  corner.textContent = "Date / Time";
  headerRow.appendChild(corner);

  for (const name of order) {
    const th = document.createElement("th");
    th.dataset.name = name;
    th.innerHTML =
      `<span class="name-full"></span><span class="name-short"></span><span class="donemark" title="Marked done">✓</span>`;
    th.querySelector(".name-full").textContent = name;
    th.querySelector(".name-short").textContent = shortLabel(name);
    headerRow.appendChild(th);
    headerCells.set(name, th);
  }

  let lastMonth = SLOTS[0].month;
  for (const slot of SLOTS) {
    if (slot.month !== lastMonth) {
      const divider = document.createElement("tr");
      divider.className = "month-divider";
      const th = document.createElement("th");
      th.colSpan = 1 + ROSTER.length;
      th.textContent = MONTH_FULL[slot.month];
      divider.appendChild(th);
      tbody.appendChild(divider);
      lastMonth = slot.month;
    }

    const tr = document.createElement("tr");
    tr.dataset.slot = slot.id;
    if (slot.isWeekend) tr.classList.add("weekend");

    const th = document.createElement("th");
    th.className = "rowlabel";
    th.innerHTML =
      `<span class="dow"></span>, <span class="date"></span> — <span class="time"></span>` +
      `<span class="okmark" title="Everyone free">✓</span><span class="conflict-badge"></span>`;
    th.querySelector(".dow").textContent = slot.dow;
    th.querySelector(".date").textContent = slot.dateLabel;
    th.querySelector(".time").textContent = slot.timeLabel;
    tr.appendChild(th);

    for (const name of order) {
      const td = document.createElement("td");
      td.className = "cell";
      td.dataset.name = name;
      td.dataset.slot = slot.id;
      td.tabIndex = 0;
      td.setAttribute("role", "button");
      td.setAttribute("aria-label", `${name}: ${slotLabel(slot)}`);
      td.addEventListener("click", () => handleCellActivate(td));
      td.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleCellActivate(td);
        }
      });
      tr.appendChild(td);
      cellMap.set(`${slot.id}|${name}`, td);
    }

    tbody.appendChild(tr);
    rowMap.set(slot.id, {
      tr,
      badge: th.querySelector(".conflict-badge"),
      okMark: th.querySelector(".okmark"),
    });
  }
}

// --- Rendering ---------------------------------------------------------------

function renderSummary() {
  const ranked = SLOTS.map((slot) => ({ slot, conflicts: conflictsFor(slot.id) }));
  const open = ranked.filter((r) => r.conflicts.length === 0);
  const title = document.getElementById("summaryTitle");
  const chips = document.getElementById("availableChips");
  chips.innerHTML = "";

  const addChip = (text, best) => {
    const chip = document.createElement("span");
    chip.className = best ? "chip best" : "chip";
    chip.textContent = text;
    chips.appendChild(chip);
  };

  if (open.length > 0) {
    title.textContent = `Available times (${open.length} of ${SLOTS.length})`;
    for (const r of open) addChip(`✓ ${slotLabel(r.slot)}`, false);
  } else {
    const min = Math.min(...ranked.map((r) => r.conflicts.length));
    const best = ranked.filter((r) => r.conflicts.length === min);
    title.textContent = `Best options (fewest conflicts: ${min})`;
    for (const r of best) {
      const shown = r.conflicts.slice(0, 3).join(", ");
      const extra = r.conflicts.length > 3 ? ` +${r.conflicts.length - 3} more` : "";
      addChip(`${slotLabel(r.slot)} · ✕ ${shown}${extra}`, true);
    }
  }

  const doneCount = ROSTER.filter((name) => entryFor(name).done).length;
  document.getElementById("doneStatus").textContent = `${doneCount} of ${ROSTER.length} marked done`;
}

function render() {
  for (const slot of SLOTS) {
    const conflicts = conflictsFor(slot.id);
    const { tr, badge, okMark } = rowMap.get(slot.id);

    for (const name of ROSTER) {
      const td = cellMap.get(`${slot.id}|${name}`);
      const unavailable = isUnavailable(name, slot.id);
      td.classList.toggle("unavailable", unavailable);
      td.textContent = unavailable ? "✕" : "";
      td.setAttribute("aria-pressed", String(unavailable));
      td.classList.toggle("editable", name === activeName);
      td.classList.toggle("my-column", name === activeName);
      td.classList.toggle("col-hidden", justMe && name !== activeName);
    }

    tr.classList.toggle("available", conflicts.length === 0);
    okMark.classList.toggle("show", conflicts.length === 0);
    badge.textContent = conflicts.length > 0 ? `${conflicts.length} ✕` : "";
  }

  for (const [name, th] of headerCells) {
    th.classList.toggle("my-column", name === activeName);
    th.classList.toggle("col-hidden", justMe && name !== activeName);
    th.classList.toggle("done", entryFor(name).done);
  }

  const hasName = Boolean(activeName);
  document.getElementById("pickPrompt").hidden = hasName;
  document.getElementById("tableShell").classList.toggle("dimmed", !hasName);
  const doneBtn = document.getElementById("doneBtn");
  const justMeBtn = document.getElementById("justMeBtn");
  doneBtn.hidden = !hasName;
  justMeBtn.hidden = !hasName;
  if (hasName) {
    const done = entryFor(activeName).done;
    doneBtn.textContent = done ? "Done ✓" : "I'm done";
    doneBtn.setAttribute("aria-pressed", String(done));
    doneBtn.classList.toggle("active", done);
  }

  renderSummary();
  updateScrollHint();
}

// Right-edge fade hinting at more columns off-screen.
function updateScrollHint() {
  const wrap = document.getElementById("tableWrap");
  const shell = document.getElementById("tableShell");
  const more = wrap.scrollWidth - wrap.clientWidth - wrap.scrollLeft > 4;
  shell.classList.toggle("can-scroll-right", more);
}

async function init() {
  setupNameSelector();
  setupButtons();
  setupToast();
  buildTable();
  render();

  document.getElementById("tableWrap").addEventListener("scroll", updateScrollHint, { passive: true });
  window.addEventListener("resize", updateScrollHint);

  if (isConfigured()) {
    store = await createSupabaseStore();
  } else {
    document.getElementById("offlineBanner").hidden = false;
    store = createLocalStore();
  }

  store.subscribe((data) => {
    responses = data;
    render();
  });

  // Realtime sockets drop silently on mobile — re-fetch whenever we come back.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) store.refresh().catch(() => {});
  });
  window.addEventListener("online", () => store.refresh().catch(() => {}));
}

init();
