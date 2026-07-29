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
      const id = `${dateKey(d)}-${pad(hour)}:00`;
      const label = `${DAY_NAMES[day]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()} — ${formatHour(hour)}`;
      slots.push({ id, label });
    }
  }
  return slots;
}

const SLOTS = generateSlots();

function isConfigured() {
  return (
    Boolean(supabaseConfig.url) &&
    supabaseConfig.url !== "https://YOUR_PROJECT_REF.supabase.co" &&
    Boolean(supabaseConfig.anonKey) &&
    supabaseConfig.anonKey !== "YOUR_ANON_KEY"
  );
}

async function createSupabaseStore() {
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  const supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey);

  async function fetchAll() {
    const { data, error } = await supabase.from("responses").select("name, unavailable");
    if (error) throw error;
    const result = {};
    for (const row of data) result[row.name] = row.unavailable || [];
    return result;
  }

  return {
    subscribe(callback) {
      fetchAll().then(callback);
      const channel = supabase
        .channel("responses-changes")
        .on("postgres_changes", { event: "*", schema: "public", table: "responses" }, () => {
          fetchAll().then(callback);
        })
        .subscribe();
      return () => supabase.removeChannel(channel);
    },
    async save(name, unavailable) {
      const { error } = await supabase
        .from("responses")
        .upsert({ name, unavailable, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
  };
}

function readLocalResponses() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_RESPONSES_KEY) || "{}");
  } catch {
    return {};
  }
}

function createLocalStore() {
  return {
    subscribe(callback) {
      callback(readLocalResponses());
      const handler = (e) => {
        if (!e.key || e.key === LOCAL_RESPONSES_KEY) callback(readLocalResponses());
      };
      window.addEventListener("storage", handler);
      return () => window.removeEventListener("storage", handler);
    },
    async save(name, unavailable) {
      const data = readLocalResponses();
      data[name] = unavailable;
      localStorage.setItem(LOCAL_RESPONSES_KEY, JSON.stringify(data));
      window.dispatchEvent(new StorageEvent("storage", { key: LOCAL_RESPONSES_KEY }));
    },
  };
}

let store;
let responses = {}; // name -> unavailable slot ids
let activeName = localStorage.getItem(ACTIVE_NAME_KEY) || "";

const cellMap = new Map(); // `${slotId}|${name}` -> <td>
const rowMap = new Map(); // slotId -> <tr>

function isUnavailable(name, slotId) {
  return (responses[name] || []).includes(slotId);
}

function slotHasNoOne(slotId) {
  return ROSTER.every((name) => !isUnavailable(name, slotId));
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
    render();
  });
}

function renderHeader() {
  const headerRow = document.getElementById("headerRow");
  for (const name of ROSTER) {
    const th = document.createElement("th");
    th.textContent = name;
    th.dataset.name = name;
    headerRow.appendChild(th);
  }
}

async function handleCellActivate(td) {
  const name = td.dataset.name;
  if (name !== activeName) return;
  const slotId = td.dataset.slot;
  const current = new Set(responses[name] || []);
  if (current.has(slotId)) current.delete(slotId);
  else current.add(slotId);
  await store.save(name, Array.from(current));
}

function renderBody() {
  const tbody = document.getElementById("tableBody");
  for (const slot of SLOTS) {
    const tr = document.createElement("tr");
    tr.dataset.slot = slot.id;

    const th = document.createElement("th");
    th.className = "rowlabel";
    th.textContent = slot.label;
    tr.appendChild(th);

    for (const name of ROSTER) {
      const td = document.createElement("td");
      td.className = "cell";
      td.dataset.name = name;
      td.dataset.slot = slot.id;
      td.tabIndex = 0;
      td.setAttribute("role", "button");
      td.setAttribute("aria-label", `${name}: ${slot.label}`);
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
    rowMap.set(slot.id, tr);
  }
}

function renderSummary() {
  const available = SLOTS.filter((slot) => slotHasNoOne(slot.id));
  document.getElementById("availableCount").textContent = `(${available.length} of ${SLOTS.length})`;

  const chips = document.getElementById("availableChips");
  chips.innerHTML = "";
  if (available.length === 0) {
    const span = document.createElement("span");
    span.className = "none";
    span.textContent = "No times are fully open yet.";
    chips.appendChild(span);
    return;
  }
  for (const slot of available) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = slot.label;
    chips.appendChild(chip);
  }
}

function render() {
  for (const slot of SLOTS) {
    let allFree = true;
    for (const name of ROSTER) {
      const td = cellMap.get(`${slot.id}|${name}`);
      const unavailable = isUnavailable(name, slot.id);
      td.classList.toggle("unavailable", unavailable);
      td.textContent = unavailable ? "✕" : "";
      td.classList.toggle("editable", name === activeName);
      td.classList.toggle("my-column", name === activeName);
      if (unavailable) allFree = false;
    }
    rowMap.get(slot.id).classList.toggle("available", allFree);
  }

  document.querySelectorAll("#headerRow th[data-name]").forEach((th) => {
    th.classList.toggle("my-column", th.dataset.name === activeName);
  });

  renderSummary();
}

async function init() {
  setupNameSelector();
  renderHeader();
  renderBody();

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
}

init();
