const STORAGE_KEY = "chill-kitchen-inventory-v1";
const activityLimit = 12;

const foodEmojis = {
  milk: "🥛", cheese: "🧀", egg: "🥚", eggs: "🥚", butter: "🧈",
  bread: "🍞", meat: "🥩", chicken: "🍗", fish: "🐟", salmon: "🐟",
  apple: "🍎", banana: "🍌", berry: "🫐", berries: "🫐", vegetable: "🥦",
  broccoli: "🥦", carrot: "🥕", tomato: "🍅", soup: "🥣", ice: "🍨",
  pizza: "🍕", pea: "🫛", peas: "🫛", corn: "🌽", yogurt: "🥣",
  yoghurt: "🥣", juice: "🧃", pasta: "🍝", shrimp: "🍤", avocado: "🥑"
};

const itemDialog = document.querySelector("#item-dialog");
const itemForm = document.querySelector("#item-form");
const todayLabel = document.querySelector("#today-label");
const activityList = document.querySelector("#activity-list");
let state = loadState();

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return { items: [], activity: [] };
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed.items) || !Array.isArray(parsed.activity)) {
      throw new Error("Saved inventory has an unexpected format.");
    }
    return parsed;
  } catch (error) {
    console.error("Could not load the saved inventory.", error);
    return { items: [], activity: [] };
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    document.querySelector(".saved-label").textContent = "Lagret på denne enheten";
  } catch (error) {
    console.error("Could not save the inventory to this device.", error);
    document.querySelector(".saved-label").textContent = "Kunne ikke lagre";
  }
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function render() {
  const fridgeItems = state.items.filter((item) => item.location === "fridge");
  const freezerItems = state.items.filter((item) => item.location === "freezer");
  document.querySelector("#total-count").textContent = String(state.items.length);
  document.querySelector("#fridge-count").textContent = String(fridgeItems.length);
  document.querySelector("#freezer-count").textContent = String(freezerItems.length);
  document.querySelector("#fridge-pill").textContent = String(fridgeItems.length);
  document.querySelector("#freezer-pill").textContent = String(freezerItems.length);
  renderItems("fridge", fridgeItems);
  renderItems("freezer", freezerItems);
  renderActivity();
}

function renderItems(location, items) {
  const list = document.querySelector(`#${location}-list`);
  if (items.length === 0) {
    const icon = location === "fridge" ? "🥬" : "❄";
    const locationName = location === "fridge" ? "kjøleskapet" : "fryseren";
    list.innerHTML = `<div class="empty-state"><span aria-hidden="true">${icon}</span><div><strong>Ingen varer her ennå</strong>Legg til din første vare i ${locationName} for å komme i gang.</div></div>`;
    return;
  }

  list.replaceChildren(...items.map((item) => {
    const row = document.createElement("article");
    row.className = "item-row";
    const emoji = getEmoji(item.name);
    const expiry = getExpiry(item.expiry);
    const quantity = formatQuantity(item.quantity);
    row.innerHTML = `
      <div class="item-name">
        <span class="food-emoji" aria-hidden="true">${emoji}</span>
        <div><strong></strong><small>Lagt til ${formatDate(item.createdAt)}</small></div>
      </div>
      <div class="quantity-control" aria-label="Antallskontroll for ${escapeHtml(item.name)}">
        <button type="button" data-action="use" data-id="${escapeHtml(item.id)}" aria-label="Bruk én ${escapeHtml(item.name)}" ${item.quantity <= 0 ? "disabled" : ""}>−</button>
        <span class="quantity-value">${quantity} ${escapeHtml(item.unit || (item.quantity === 1 ? "vare" : "varer"))}</span>
        <button type="button" data-action="add" data-id="${escapeHtml(item.id)}" aria-label="Legg til én ${escapeHtml(item.name)}">+</button>
      </div>
      <span class="expiry ${expiry.soon ? "soon" : ""}">${expiry.text}</span>
      <div class="row-actions">
        <button class="use-button" type="button" data-action="use" data-id="${escapeHtml(item.id)}" aria-label="Bruk ${formatQuantity(Math.min(1, item.quantity))} ${escapeHtml(item.name)}" ${item.quantity <= 0 ? "disabled" : ""}>Bruk ${formatQuantity(Math.min(1, item.quantity))}</button>
        <button class="remove-button" type="button" data-action="remove" data-id="${escapeHtml(item.id)}" aria-label="Fjern ${escapeHtml(item.name)}">×</button>
      </div>`;
    row.querySelector(".item-name strong").textContent = item.name;
    return row;
  }));
}

function renderActivity() {
  if (state.activity.length === 0) {
    activityList.innerHTML = '<div class="activity-empty">Oppdateringer vises her når du legger til eller bruker varer.</div>';
    return;
  }
  activityList.replaceChildren(...state.activity.slice(0, activityLimit).map((entry) => {
    const row = document.createElement("div");
    row.className = "activity-row";
    const wasRemoved = entry.action === "removed";
    const wasUsed = entry.action === "used";
    const symbol = wasRemoved ? "×" : wasUsed ? "−" : entry.action === "added" ? "+" : "+";
    const description = wasRemoved
      ? `Fjernet <strong>${escapeHtml(entry.name)}</strong> fra ${getLocationName(entry.location)}`
      : wasUsed
        ? `Brukte ${formatQuantity(entry.amount)} ${escapeHtml(entry.unit || (entry.amount === 1 ? "vare" : "varer"))} av <strong>${escapeHtml(entry.name)}</strong>`
        : entry.action === "added"
          ? `La til <strong>${escapeHtml(entry.name)}</strong> i ${getLocationName(entry.location)}`
          : `Fylte på <strong>${escapeHtml(entry.name)}</strong> med ${formatQuantity(entry.amount)} ${escapeHtml(entry.unit || "varer")}`;
    row.innerHTML = `<span class="activity-symbol ${wasRemoved ? "removed" : ""}" aria-hidden="true">${symbol}</span><span class="activity-copy">${description}</span><span class="activity-meta">${formatRelative(entry.at)}</span>`;
    return row;
  }));
}

function getEmoji(name) {
  const normalized = name.toLowerCase();
  const match = Object.keys(foodEmojis).find((food) => normalized.includes(food));
  return match ? foodEmojis[match] : "🍽️";
}

function getLocationName(location) {
  return location === "freezer" ? "fryseren" : "kjøleskapet";
}

function getExpiry(expiry) {
  if (!expiry) return { text: "Ingen best før-dato", soon: false };
  const date = new Date(`${expiry}T00:00:00`);
  if (Number.isNaN(date.getTime())) return { text: "Ingen best før-dato", soon: false };
  const days = Math.ceil((date - startOfToday()) / 86400000);
  if (days < 0) return { text: `Best før ${date.toLocaleDateString("nb-NO", { day: "numeric", month: "short" })} · utgått`, soon: true };
  if (days === 0) return { text: "Best før i dag", soon: true };
  if (days <= 3) return { text: `Best før om ${days} ${days === 1 ? "dag" : "dager"}`, soon: true };
  return { text: `Best før ${date.toLocaleDateString("nb-NO", { day: "numeric", month: "short" })}`, soon: false };
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatQuantity(quantity) {
  return Number.isInteger(quantity) ? String(quantity) : String(Number(quantity.toFixed(2)));
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("nb-NO", { day: "numeric", month: "short" });
}

function formatRelative(value) {
  const time = new Date(value);
  const minutes = Math.max(0, Math.floor((Date.now() - time.getTime()) / 60000));
  if (minutes < 1) return "Akkurat nå";
  if (minutes < 60) return `${minutes} min siden`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} t siden`;
  if (hours < 48) return "I går";
  return time.toLocaleDateString("nb-NO", { day: "numeric", month: "short" });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function addActivity(action, item, amount) {
  state.activity.unshift({
    id: makeId(),
    action,
    name: item.name,
    location: item.location,
    amount,
    unit: item.unit,
    at: new Date().toISOString()
  });
  state.activity = state.activity.slice(0, 50);
}

function openDialog(location = "fridge") {
  itemForm.reset();
  itemForm.elements.location.value = location;
  itemForm.elements.quantity.value = "1";
  itemDialog.showModal();
  itemForm.elements.name.focus();
}

document.querySelector("#open-add").addEventListener("click", () => openDialog());
document.querySelectorAll(".add-location").forEach((button) => {
  button.addEventListener("click", () => openDialog(button.dataset.location));
});
document.querySelectorAll(".close-dialog").forEach((button) => {
  button.addEventListener("click", () => itemDialog.close());
});

itemDialog.addEventListener("click", (event) => {
  if (event.target === itemDialog) itemDialog.close();
});

itemForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!itemForm.reportValidity()) return;
  const formData = new FormData(itemForm);
  const quantity = Number(formData.get("quantity"));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    itemForm.elements.quantity.setCustomValidity("Antallet må være større enn null.");
    itemForm.reportValidity();
    itemForm.elements.quantity.setCustomValidity("");
    return;
  }
  const item = {
    id: makeId(),
    name: String(formData.get("name")).trim(),
    location: String(formData.get("location")),
    quantity,
    unit: String(formData.get("unit")).trim(),
    expiry: String(formData.get("expiry")),
    createdAt: new Date().toISOString()
  };
  if (!item.name) {
    itemForm.elements.name.setCustomValidity("Skriv inn navnet på varen.");
    itemForm.reportValidity();
    itemForm.elements.name.setCustomValidity("");
    return;
  }
  state.items.unshift(item);
  addActivity("added", item, item.quantity);
  saveState();
  render();
  itemDialog.close();
});

document.querySelectorAll(".item-list").forEach((list) => {
  list.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const item = state.items.find((candidate) => candidate.id === button.dataset.id);
    if (!item) return;
    if (button.dataset.action === "use") {
      if (item.quantity <= 0) return;
      const usedQuantity = Math.min(1, item.quantity);
      item.quantity = Math.max(0, Number((item.quantity - usedQuantity).toFixed(2)));
      addActivity("used", item, usedQuantity);
      if (item.quantity === 0) state.items = state.items.filter((candidate) => candidate.id !== item.id);
    } else if (button.dataset.action === "add") {
      item.quantity = Number((item.quantity + 1).toFixed(2));
      addActivity("restocked", item, 1);
    } else if (button.dataset.action === "remove") {
      addActivity("removed", item, item.quantity);
      state.items = state.items.filter((candidate) => candidate.id !== item.id);
    }
    saveState();
    render();
  });
});

document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((candidate) => candidate.classList.remove("active"));
    link.classList.add("active");
  });
});

todayLabel.textContent = new Date().toLocaleDateString("nb-NO", { weekday: "short", day: "numeric", month: "short" });
render();
