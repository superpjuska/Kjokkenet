import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getDatabase,
  get,
  onValue,
  ref,
  runTransaction
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const STORAGE_KEY = "chill-kitchen-inventory-v1";
const activityLimit = 12;
const storedActivityLimit = 50;

const foodEmojis = {
  milk: "🥛", cheese: "🧀", egg: "🥚", eggs: "🥚", butter: "🧈",
  bread: "🍞", meat: "🥩", chicken: "🍗", fish: "🐟", salmon: "🐟",
  apple: "🍎", banana: "🍌", berry: "🫐", berries: "🫐", vegetable: "🥦",
  broccoli: "🥦", carrot: "🥕", tomato: "🍅", soup: "🥣", ice: "🍨",
  pizza: "🍕", pea: "🫛", peas: "🫛", corn: "🌽", yogurt: "🥣",
  yoghurt: "🥣", juice: "🧃", pasta: "🍝", shrimp: "🍤", avocado: "🥑"
};

const authScreen = document.querySelector("#auth-screen");
const appShell = document.querySelector("#app-shell");
const authMessage = document.querySelector("#auth-message");
const loginForm = document.querySelector("#login-form");
const loginButton = document.querySelector("#login-submit");
const itemDialog = document.querySelector("#item-dialog");
const itemForm = document.querySelector("#item-form");
const barcodeInput = document.querySelector("#item-barcode");
const barcodeMessage = document.querySelector("#barcode-message");
const saveCatalogButton = document.querySelector("#save-catalog-product");
const scannerDialog = document.querySelector("#scanner-dialog");
const scannerVideo = document.querySelector("#scanner-video");
const scannerStatus = document.querySelector("#scanner-status");
const todayLabel = document.querySelector("#today-label");
const activityList = document.querySelector("#activity-list");
const appNotice = document.querySelector("#app-notice");
const importNotice = document.querySelector("#import-notice");

const firebaseConfigured = Boolean(
  firebaseConfig.apiKey
  && firebaseConfig.appId
  && !firebaseConfig.apiKey.startsWith("YOUR_")
  && !firebaseConfig.appId.startsWith("YOUR_")
);
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const database = getDatabase(firebaseApp);
const inventoryRef = ref(database, "inventory");
let state = { items: [], activity: [] };
let unsubscribeInventory;
let unsubscribeConnection;
let connected = false;
let inventoryLoaded = false;
let inventoryAccessError = false;
let noticeTimer;
let legacyState = loadLegacyState();
let scannerControls;
let scannerReader;
let scannerStarting = false;
let lookupInProgress = false;

function loadLegacyState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed.items) || !Array.isArray(parsed.activity)) {
      throw new Error("Den lokale beholdningen har et ukjent format.");
    }
    return parsed.items.length > 0 ? parsed : null;
  } catch (error) {
    console.error("Kunne ikke lese den lokale beholdningen.", error);
    return null;
  }
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function setSyncStatus(message, status = "connected") {
  const statusLabel = document.querySelector("#sync-status");
  const statusDot = document.querySelector("#sync-dot");
  statusLabel.textContent = message;
  statusDot.classList.toggle("offline", status === "offline");
  statusDot.classList.toggle("error", status === "error");
}

function showNotice(message, type = "error") {
  window.clearTimeout(noticeTimer);
  appNotice.textContent = message;
  appNotice.classList.toggle("success", type === "success");
  appNotice.hidden = false;
  noticeTimer = window.setTimeout(() => {
    appNotice.hidden = true;
  }, 7000);
}

function showAuthMessage(message, type = "error") {
  authMessage.textContent = message;
  authMessage.classList.toggle("success", type === "success");
  authMessage.hidden = false;
}

function showBarcodeMessage(message, type = "error") {
  barcodeMessage.textContent = message;
  barcodeMessage.classList.toggle("success", type === "success");
  barcodeMessage.hidden = false;
}

function getAuthErrorMessage(error) {
  switch (error.code) {
    case "auth/invalid-email":
      return "Brukernavnet er ugyldig. Bruk 3–32 bokstaver, tall, bindestreker eller understreker.";
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "Brukernavnet eller passordet stemmer ikke.";
    case "auth/too-many-requests":
      return "For mange forsøk. Vent litt før du prøver igjen.";
    case "auth/network-request-failed":
      return "Kunne ikke koble til Firebase. Sjekk internettforbindelsen.";
    case "auth/unauthorized-domain":
      return "Denne nettsideadressen er ikke godkjent for Firebase-pålogging. Legg til domenet under Authentication → Settings → Authorized domains i Firebase Console.";
    case "auth/operation-not-allowed":
    case "auth/configuration-not-found":
      return "E-post/passord er ikke aktivert i Firebase Authentication.";
    case "auth/invalid-api-key":
      return "Firebase-konfigurasjonen mangler en gyldig API-nøkkel.";
    case "auth/requests-to-this-api-are-blocked":
      return "Firebase API-nøkkelen blokkerer pålogging. Kontroller nøkkelrestriksjonene i Google Cloud Console.";
    case "auth/user-disabled":
      return "Denne kontoen er deaktivert. Kontakt administratoren.";
    default:
      return `Innloggingen mislyktes (${error.code || "ukjent feil"}). Kontroller brukernavn, passord og Firebase-oppsett.`;
  }
}

function getDatabaseErrorMessage(error) {
  const code = String(error.code || "");
  if (code.includes("PERMISSION_DENIED") || code === "database/permission-denied") {
    return "Ingen tilgang til fellesoversikten. Kontroller at brukerens UID er lagt inn i Realtime Database-reglene.";
  }
  if (error.code === "NETWORK_ERROR" || error.code === "database/connection-error") {
    return "Mistet forbindelsen til Firebase. Prøver å koble til igjen.";
  }
  return "Kunne ikke synkronisere med Firebase. Kontroller databaseoppsettet.";
}

function updateImportVisibility() {
  importNotice.hidden = !(
    legacyState
    && connected
    && state.items.length === 0
  );
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
  updateImportVisibility();
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
    const expiry = getExpiry(item.expiry);
    const quantity = formatQuantity(item.quantity);
    row.innerHTML = `
      <div class="item-name">
        <span class="food-emoji" aria-hidden="true">${getEmoji(item.name)}</span>
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
    const symbol = wasRemoved ? "×" : wasUsed ? "−" : "+";
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
  const date = value ? new Date(value) : new Date();
  return date.toLocaleDateString("nb-NO", { day: "numeric", month: "short" });
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

function openDialog(location = "fridge") {
  itemForm.reset();
  itemForm.elements.location.value = location;
  itemForm.elements.quantity.value = "1";
  barcodeMessage.hidden = true;
  saveCatalogButton.hidden = true;
  itemDialog.showModal();
  itemForm.elements.name.focus();
}

function stopScanner() {
  scannerControls?.stop();
  scannerControls = null;
  scannerReader = null;
  scannerStarting = false;
  scannerVideo.srcObject?.getTracks().forEach((track) => track.stop());
  scannerVideo.srcObject = null;
}

function closeScanner() {
  stopScanner();
  if (scannerDialog.open) scannerDialog.close();
}

async function openScanner() {
  if (scannerStarting || scannerDialog.open) return;
  scannerStarting = true;
  scannerStatus.textContent = "Starter kamera …";
  scannerDialog.showModal();
  try {
    const { BrowserMultiFormatReader } = await import(
      "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm"
    );
    if (!scannerDialog.open) return;
    scannerReader = new BrowserMultiFormatReader();
    const controls = await scannerReader.decodeFromConstraints(
      { video: { facingMode: { ideal: "environment" } } },
      scannerVideo,
      (result) => {
        if (!result || !scannerDialog.open) return;
        const barcode = result.getText().trim();
        if (!/^\d{8,14}$/.test(barcode)) {
          scannerStatus.textContent = "Fant en kode, men den ser ikke ut som en EAN-strekkode.";
          return;
        }
        barcodeInput.value = barcode;
        closeScanner();
        lookupProductByBarcode(barcode);
      }
    );
    scannerControls = controls;
    scannerStarting = false;
    if (!scannerDialog.open) {
      stopScanner();
      return;
    }
    scannerStatus.textContent = "Plasser strekkoden midt i rammen.";
  } catch (error) {
    console.error("Kunne ikke starte strekkodeskanneren.", error);
    scannerStarting = false;
    scannerStatus.textContent = error.name === "NotAllowedError"
      ? "Gi nettleseren tilgang til kameraet, og prøv igjen."
      : "Kameraet kunne ikke startes. Kontroller kameratilgang og bruk appens HTTPS-adresse.";
  }
}

async function lookupProductByBarcode(barcode = barcodeInput.value.trim()) {
  if (!/^\d{8,14}$/.test(barcode)) {
    showBarcodeMessage("Skriv inn en strekkode på 8–14 sifre.");
    barcodeInput.focus();
    return;
  }
  if (lookupInProgress) return;
  let endpoint;
  const user = auth.currentUser;
  if (!user) {
    showBarcodeMessage("Logg inn for å søke etter produkter.");
    return;
  }

  lookupInProgress = true;
  const lookupButton = document.querySelector("#lookup-barcode");
  const submitButton = itemForm.querySelector('[type="submit"]');
  lookupButton.disabled = true;
  submitButton.disabled = true;
  showBarcodeMessage("Søker etter varen …", "success");
  let timeoutId;
  try {
    saveCatalogButton.hidden = true;
    showBarcodeMessage("Sjekker produktbiblioteket …", "success");
    const catalogSnapshot = await get(ref(database, `productCatalog/${barcode}`));
    const catalogProduct = catalogSnapshot.val();
    if (typeof catalogProduct?.name === "string" && catalogProduct.name.trim()) {
      itemForm.elements.name.value = catalogProduct.name.trim();
      showBarcodeMessage(`Fant ${catalogProduct.name.trim()} i produktbiblioteket.`, "success");
      return;
    }
    if (!firebaseConfig.productLookupUrl) {
      offerCatalogSave("Fant ikke varen i produktbiblioteket. Skriv inn navnet for å lagre den.");
      return;
    }
    try {
      endpoint = new URL(firebaseConfig.productLookupUrl);
    } catch {
      offerCatalogSave("Proxy-adressen er ugyldig. Kontroller produktLookupUrl i firebase-config.js.");
      return;
    }
    if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost") {
      offerCatalogSave("Produktsøk må bruke en sikker HTTPS-adresse.");
      return;
    }
    showBarcodeMessage("Søker etter varen …", "success");
    endpoint.searchParams.set("barcode", barcode);
    const token = await user.getIdToken();
    const timeout = new AbortController();
    timeoutId = window.setTimeout(() => timeout.abort(), 12000);
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      signal: timeout.signal
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error("Proxien avviste forespørselen. Kontroller at den godtar Firebase-ID-tokenet.");
    }
    if (response.status === 404) {
      offerCatalogSave("Fant ikke varen. Skriv inn navnet for å lagre den i produktbiblioteket.");
      return;
    }
    if (!response.ok) throw new Error(`Produktsøket svarte med HTTP ${response.status}.`);
    const result = await response.json();
    const product = Array.isArray(result.data) ? result.data[0] : result.product || result.data || result;
    if (typeof product?.name !== "string" || !product.name.trim()) {
      throw new Error("Produktsøket returnerte ikke et varenavn i et støttet format.");
    }
    itemForm.elements.name.value = product.name.trim();
    showBarcodeMessage(`Fant ${product.name.trim()}. Kontroller navn og antall før du legger til.`, "success");
  } catch (error) {
    console.error("Kunne ikke hente produktinformasjon fra strekkoden.", error);
    const errorCode = String(error.code || "");
    const message = errorCode.includes("PERMISSION_DENIED") || errorCode.startsWith("database/")
      ? getDatabaseErrorMessage(error)
      : error.name === "AbortError"
        ? "Produktsøket tok for lang tid. Prøv igjen."
        : error instanceof TypeError
          ? "Kunne ikke nå produktsøket. Kontroller proxy-adressen og CORS-oppsettet."
          : error.message;
    offerCatalogSave(`${message} Skriv inn navnet for å lagre varen manuelt.`);
  } finally {
    window.clearTimeout(timeoutId);
    lookupInProgress = false;
    lookupButton.disabled = false;
    submitButton.disabled = false;
  }
}

function offerCatalogSave(message) {
  saveCatalogButton.hidden = false;
  showBarcodeMessage(message);
  itemForm.elements.name.focus();
}

async function saveProductToCatalog() {
  const barcode = barcodeInput.value.trim();
  const name = itemForm.elements.name.value.trim();
  if (!/^\d{8,14}$/.test(barcode)) {
    showBarcodeMessage("Skriv inn en strekkode på 8–14 sifre.");
    barcodeInput.focus();
    return;
  }
  if (!name) {
    showBarcodeMessage("Skriv inn varenavnet før du lagrer i produktbiblioteket.");
    itemForm.elements.name.focus();
    return;
  }
  if (saveCatalogButton.disabled) return;
  if (!auth.currentUser) {
    showBarcodeMessage("Logg inn for å lagre varer i produktbiblioteket.");
    return;
  }

  saveCatalogButton.disabled = true;
  const submitButton = itemForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  try {
    const result = await runTransaction(ref(database, `productCatalog/${barcode}`), (current) => {
      if (current) return;
      return { name, createdAt: new Date().toISOString() };
    }, { applyLocally: false });
    const savedProduct = result.snapshot.val();
    if (!result.committed) {
      if (typeof savedProduct?.name !== "string" || !savedProduct.name.trim()) {
        throw new Error("Produktet finnes allerede i biblioteket, men har ikke et gyldig varenavn.");
      }
      itemForm.elements.name.value = savedProduct.name.trim();
      showBarcodeMessage(`Strekkoden finnes allerede som ${savedProduct.name.trim()} i produktbiblioteket.`, "success");
      saveCatalogButton.hidden = true;
      return;
    }
    showBarcodeMessage(`${name} er lagret i det delte produktbiblioteket. Legg til varen for å føre den i beholdningen.`, "success");
    saveCatalogButton.hidden = true;
  } catch (error) {
    console.error("Kunne ikke lagre varen i produktbiblioteket.", error);
    showBarcodeMessage(error.code
      ? getDatabaseErrorMessage(error)
      : error.message || "Kunne ikke lagre varen i produktbiblioteket.");
  } finally {
    saveCatalogButton.disabled = false;
    submitButton.disabled = false;
  }
}

function createActivity(action, item, amount) {
  return {
    id: makeId(),
    action,
    name: item.name,
    location: item.location,
    amount,
    unit: item.unit || "",
    at: new Date().toISOString()
  };
}

function trimActivity(activity) {
  return Object.fromEntries(
    Object.entries(activity)
      .sort(([, first], [, second]) => String(second.at || "").localeCompare(String(first.at || "")))
      .slice(0, storedActivityLimit)
  );
}

function onInventoryChanged(snapshot) {
  const inventory = snapshot.val() || {};
  inventoryLoaded = true;
  inventoryAccessError = false;
  const items = inventory.items || {};
  const activity = inventory.activity || {};
  state.items = Object.entries(items)
    .map(([id, item]) => ({ ...item, id: item.id || id }))
    .sort((first, second) => String(second.createdAt || "").localeCompare(String(first.createdAt || "")));
  state.activity = Object.entries(activity)
    .map(([id, entry]) => ({ ...entry, id: entry.id || id }))
    .sort((first, second) => String(second.at || "").localeCompare(String(first.at || "")));
  render();
  if (connected) setSyncStatus("Synkronisert");
}

function listenForInventory() {
  unsubscribeInventory?.();
  unsubscribeConnection?.();
  connected = false;
  inventoryLoaded = false;
  inventoryAccessError = false;
  setSyncStatus("Kobler til Firebase …", "offline");
  unsubscribeInventory = onValue(inventoryRef, onInventoryChanged, (error) => {
    inventoryAccessError = true;
    console.error("Kunne ikke lese fellesoversikten fra Firebase.", error);
    setSyncStatus("Synkronisering feilet", "error");
    showNotice(getDatabaseErrorMessage(error));
  });
  unsubscribeConnection = onValue(ref(database, ".info/connected"), (snapshot) => {
    connected = snapshot.val() === true;
    if (!connected) {
      setSyncStatus("Frakoblet – kobler til …", "offline");
    } else if (inventoryAccessError) {
      setSyncStatus("Ingen tilgang til fellesoversikten", "error");
    } else if (inventoryLoaded) {
      setSyncStatus("Synkronisert");
    } else {
      setSyncStatus("Laster fellesoversikten …", "offline");
      updateImportVisibility();
    }
  });
}

async function commitInventoryChange(changeInventory) {
  const result = await runTransaction(inventoryRef, (current) => {
    const inventory = current && typeof current === "object" ? current : {};
    return changeInventory(inventory);
  }, { applyLocally: false });
  return result;
}

async function addItem(item) {
  const entry = createActivity("added", item, item.quantity);
  const result = await commitInventoryChange((current) => {
    const items = { ...(current.items || {}) };
    const activity = { ...(current.activity || {}) };
    if (items[item.id]) return;
    items[item.id] = item;
    activity[entry.id] = entry;
    return { ...current, items, activity: trimActivity(activity) };
  });
  if (!result.committed) throw new Error("Varen kunne ikke legges til i fellesoversikten.");
}

async function updateItem(itemId, action) {
  const entryId = makeId();
  const activityTime = new Date().toISOString();
  let actionApplied = false;
  const result = await commitInventoryChange((current) => {
    const items = { ...(current.items || {}) };
    const activity = { ...(current.activity || {}) };
    const item = items[itemId];
    if (!item || !Number.isFinite(Number(item.quantity))) return;

    let updatedItem;
    let amount;
    if (action === "use") {
      if (item.quantity <= 0) return;
      amount = Math.min(1, item.quantity);
      const remaining = Math.max(0, Number((item.quantity - amount).toFixed(2)));
      updatedItem = { ...item, quantity: remaining };
      if (remaining === 0) delete items[itemId];
      else items[itemId] = updatedItem;
    } else if (action === "add") {
      amount = 1;
      updatedItem = { ...item, quantity: Number((item.quantity + 1).toFixed(2)) };
      items[itemId] = updatedItem;
    } else if (action === "remove") {
      amount = item.quantity;
      delete items[itemId];
    } else {
      return;
    }

    activity[entryId] = {
      id: entryId,
      action: action === "add" ? "restocked" : action === "use" ? "used" : "removed",
      name: item.name,
      location: item.location,
      amount,
      unit: item.unit || "",
      at: activityTime
    };
    actionApplied = true;
    return { ...current, items, activity: trimActivity(activity) };
  });

  if (!result.committed && actionApplied) {
    throw new Error("Endringen ble ikke lagret. Prøv igjen.");
  }
}

async function importLegacyInventory() {
  if (!legacyState) return;
  const items = Object.fromEntries(legacyState.items.map((item) => {
    const id = item.id || makeId();
    return [id, { ...item, id, createdAt: item.createdAt || new Date().toISOString() }];
  }));
  const activity = Object.fromEntries(legacyState.activity.map((entry) => {
    const id = entry.id || makeId();
    return [id, { ...entry, id, at: entry.at || new Date().toISOString() }];
  }));
  const result = await commitInventoryChange((current) => {
    if (Object.keys(current.items || {}).length > 0) return;
    return { ...current, items, activity: trimActivity({ ...(current.activity || {}), ...activity }) };
  });
  if (!result.committed) {
    showNotice("Fellesoversikten har allerede varer. Den lokale beholdningen ble ikke importert.");
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
  legacyState = null;
  updateImportVisibility();
  showNotice("Beholdningen er importert til fellesoversikten.", "success");
}

function handleDatabaseAction(action, itemId) {
  updateItem(itemId, action).catch((error) => {
    console.error("Kunne ikke oppdatere varen i Firebase.", error);
    showNotice(error.message === "Endringen ble ikke lagret. Prøv igjen."
      ? error.message
      : getDatabaseErrorMessage(error));
  });
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

document.querySelector("#open-scanner").addEventListener("click", openScanner);
document.querySelector("#lookup-barcode").addEventListener("click", () => lookupProductByBarcode());
saveCatalogButton.addEventListener("click", saveProductToCatalog);
document.querySelector("#close-scanner").addEventListener("click", closeScanner);
document.querySelector("#cancel-scanner").addEventListener("click", closeScanner);
scannerDialog.addEventListener("click", (event) => {
  if (event.target === scannerDialog) closeScanner();
});
scannerDialog.addEventListener("close", stopScanner);

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
  const name = String(formData.get("name")).trim();
  if (!name) {
    itemForm.elements.name.setCustomValidity("Skriv inn navnet på varen.");
    itemForm.reportValidity();
    itemForm.elements.name.setCustomValidity("");
    return;
  }
  const item = {
    id: makeId(),
    name,
    barcode: String(formData.get("barcode")).trim(),
    location: String(formData.get("location")),
    quantity,
    unit: String(formData.get("unit")).trim(),
    expiry: String(formData.get("expiry")),
    createdAt: new Date().toISOString()
  };
  addItem(item).then(() => {
    itemDialog.close();
  }).catch((error) => {
    console.error("Kunne ikke legge til varen i Firebase.", error);
    showNotice(error.message === "Varen kunne ikke legges til i fellesoversikten."
      ? error.message
      : getDatabaseErrorMessage(error));
  });
});

document.querySelectorAll(".item-list").forEach((list) => {
  list.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (button) handleDatabaseAction(button.dataset.action, button.dataset.id);
  });
});

const viewCopy = {
  all: {
    title: "Matoversikt",
    description: "Se hva du har i kjøleskapet og fryseren. Oppdater underveis."
  },
  fridge: {
    title: "Kjøleskap",
    description: "Dette har du på kjøl."
  },
  freezer: {
    title: "Fryser",
    description: "Dette har du fryst ned."
  },
  activity: {
    title: "Siste aktivitet",
    description: "Se hva som nylig er lagt til, brukt eller fjernet."
  }
};

function setView(view) {
  const copy = viewCopy[view];
  if (!copy) return;
  document.querySelectorAll(".nav-link").forEach((button) => {
    const isCurrent = button.dataset.view === view;
    button.classList.toggle("active", isCurrent);
    if (isCurrent) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.hidden = !panel.dataset.viewPanel.split(" ").includes(view);
  });
  document.querySelector("#page-title").textContent = copy.title;
  document.querySelector("#page-description").textContent = copy.description;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".nav-link").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!firebaseConfigured) {
    showAuthMessage("Firebase-oppsettet mangler API-nøkkel eller app-ID. Se FIREBASE_SETUP.md.");
    return;
  }
  if (!loginForm.reportValidity()) return;
  const username = String(loginForm.elements.username.value).trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,32}$/.test(username)) {
    loginForm.elements.username.setCustomValidity("Bruk 3–32 bokstaver, tall, bindestreker eller understreker.");
    loginForm.reportValidity();
    loginForm.elements.username.setCustomValidity("");
    return;
  }
  loginButton.disabled = true;
  loginButton.textContent = "Logger inn …";
  showAuthMessage("Kobler til Firebase …", "success");
  try {
    const password = String(loginForm.elements.password.value);
    await signInWithEmailAndPassword(auth, `${username}@kjokkenet-cf65d.firebaseapp.com`, password);
  } catch (error) {
    console.error("Innlogging til Firebase mislyktes.", error);
    showAuthMessage(getAuthErrorMessage(error));
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "Logg inn";
  }
});

document.querySelector("#sign-out").addEventListener("click", () => {
  signOut(auth).catch((error) => {
    console.error("Kunne ikke logge ut av Firebase.", error);
    showNotice("Kunne ikke logge ut. Prøv igjen.");
  });
});

document.querySelector("#mobile-sign-out").addEventListener("click", () => {
  signOut(auth).catch((error) => {
    console.error("Kunne ikke logge ut av Firebase.", error);
    showNotice("Kunne ikke logge ut. Prøv igjen.");
  });
});

document.querySelector("#import-local").addEventListener("click", () => {
  importLegacyInventory().catch((error) => {
    console.error("Kunne ikke importere den lokale beholdningen.", error);
    showNotice(getDatabaseErrorMessage(error));
  });
});

onAuthStateChanged(auth, (user) => {
  if (unsubscribeInventory) unsubscribeInventory();
  if (unsubscribeConnection) unsubscribeConnection();
  unsubscribeInventory = null;
  unsubscribeConnection = null;
  if (!user) {
    state = { items: [], activity: [] };
    authScreen.hidden = false;
    appShell.hidden = true;
    return;
  }
  state = { items: [], activity: [] };
  render();
  authScreen.hidden = true;
  appShell.hidden = false;
  document.querySelector("#account-username").textContent = user.email?.split("@")[0] || "Innlogget";
  listenForInventory();
}, (error) => {
  console.error("Firebase Authentication kunne ikke initialiseres.", error);
  showAuthMessage(getAuthErrorMessage(error));
});

if (!firebaseConfigured) {
  showAuthMessage("Firebase-oppsettet mangler API-nøkkel eller app-ID. Se FIREBASE_SETUP.md.");
  loginButton.disabled = true;
}

todayLabel.textContent = new Date().toLocaleDateString("nb-NO", { weekday: "short", day: "numeric", month: "short" });
setView("all");
render();
