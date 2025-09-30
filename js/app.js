// Modo UMD: `L` y `turf` vienen de scripts en index.html
// Diagnóstico rápido
console.log("[app] globals:", { leaflet: !!window.L, turf: !!window.turf });

/* Persistencia: API backend (PHP) o localStorage */
// Usar ruta relativa para que funcione según dónde se hospede el proyecto (p. ej., http://localhost/2/)
const API_URL = "./php-api";
// Activa almacenamiento local para trabajar sin servidor. Cambia a false para usar API.
const USE_LOCAL = true;
async function api(path, opts = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  if (res.status === 204) return null;
  return await res.json();
}
async function loadOrdersFromApi() {
  try {
    state.orders = await api('/orders.php');
    renderOrders();
  } catch (e) {
    console.error('Error cargando órdenes', e);
    alert('No se pudieron cargar órdenes del servidor');
  }
}

/* Persistencia local */
function loadOrdersFromLocal() {
  state.orders = loadLS("orders", []);
  renderOrders();
}
function upsertOrderLocal(order) {
  const idx = state.orders.findIndex(x => x.id === order.id);
  if (idx >= 0) { state.orders[idx] = order; } else { state.orders.push(order); }
  saveLS("orders", state.orders);
}
function deleteOrderLocal(id) {
  const idx = state.orders.findIndex(x => x.id === id);
  if (idx >= 0) {
    state.orders.splice(idx, 1);
    saveLS("orders", state.orders);
  }
}
function loadOrders() { USE_LOCAL ? loadOrdersFromLocal() : loadOrdersFromApi(); }

/* Roles y permisos */
const ROLES = {
  admin: { create: true, edit: true, delete: true, route: true, status: true, layers: true },
  operador: { create: true, edit: true, delete: false, route: true, status: true, layers: true },
  supervisor: { create: false, edit: true, delete: false, route: false, status: true, layers: true }
};

/* Usuarios de ejemplo */
const USERS = [
  { id: "admin", name: "Admin", role: "admin" },
  { id: "op1", name: "Operador 1", role: "operador" },
  { id: "sup1", name: "Supervisor", role: "supervisor" }
];

/* Estado global y utilidades */
const state = {
  session: null,
  orders: [],
  layers: [],
  routeEditing: false,
  routePoints: [],
  areaEditing: false,
  areaPoints: []
};
function saveLS(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function loadLS(key, def) { try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; } }
function uid() { return Math.random().toString(36).slice(2, 9); }

/* UI refs */
const loginSelect = document.getElementById("loginSelect");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const roleBadge = document.getElementById("roleBadge");

const statusFilter = document.getElementById("statusFilter");
const newOrderBtn = document.getElementById("newOrderBtn");
const ordersList = document.getElementById("ordersList");

const orderForm = document.getElementById("orderForm");
const orderId = document.getElementById("orderId");
const orderTitle = document.getElementById("orderTitle");
const orderLocation = document.getElementById("orderLocation");
const orderPilot = document.getElementById("orderPilot");
const orderDroneId = document.getElementById("orderDroneId");
const orderSchedule = document.getElementById("orderSchedule");
const orderStatus = document.getElementById("orderStatus");
const saveOrderBtn = document.getElementById("saveOrderBtn");
const deleteOrderBtn = document.getElementById("deleteOrderBtn");

const startRouteBtn = document.getElementById("startRouteBtn");
const finishRouteBtn = document.getElementById("finishRouteBtn");
const clearRouteBtn = document.getElementById("clearRouteBtn");
const routeStats = document.getElementById("routeStats");

const startAreaBtn = document.getElementById("startAreaBtn");
const finishAreaBtn = document.getElementById("finishAreaBtn");
const clearAreaBtn = document.getElementById("clearAreaBtn");
const areaStats = document.getElementById("areaStats");

const qgisFileInput = document.getElementById("qgisFileInput");
const layersList = document.getElementById("layersList");

/* Map init (Leaflet) */
const map = L.map("map", { preferCanvas: true, zoomControl: true, attributionControl: true }).setView([4.5709, -74.2973], 6);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap contributors"
}).addTo(map);

const routeLayer = L.layerGroup().addTo(map);
const qgisLayerGroup = L.layerGroup().addTo(map);
const areaLayer = L.layerGroup().addTo(map);

/* Ensure map renders after DOM ready */
window.addEventListener("load", () => { map.invalidateSize(); });

/* Session/Login */
function initLogin() {
  loginSelect.innerHTML = USERS.map(u => `<option value="${u.id}">${u.name} (${u.role})</option>`).join("");
  const last = loadLS("session", null);
  if (last) setSession(last);
}
function setSession(user) {
  state.session = user;
  saveLS("session", user);
  loginBtn.hidden = true;
  logoutBtn.hidden = false;
  roleBadge.hidden = false;
  roleBadge.textContent = user.role;
  loginSelect.value = user.id;
  refreshUI();
  loadOrders();
}
function clearSession() {
  state.session = null;
  localStorage.removeItem("session");
  loginBtn.hidden = false;
  logoutBtn.hidden = true;
  roleBadge.hidden = true;
  refreshUI();
  state.orders = []; renderOrders();
}

/* Permissions helper */
function can(action) {
  if (!state.session) return false;
  return !!ROLES[state.session.role]?.[action];
}

/* Orders rendering */
function renderOrders() {
  const filter = statusFilter.value;
  const list = (filter ? state.orders.filter(o => o.status === filter) : state.orders)
    .sort((a,b)=> (a.schedule||"") > (b.schedule||"") ? 1 : -1);
  ordersList.innerHTML = list.map(o => `
    <li>
      <div>
        <div class="order-title">${o.title}</div>
        <div class="muted">Piloto: ${o.pilot} · Dron: ${o.droneId} · ${o.schedule || ""}</div>
      </div>
      <div class="order-actions">
        <span class="badge">${o.status}</span>
        <button data-id="${o.id}" class="open">Abrir</button>
      </div>
    </li>`).join("");
  ordersList.querySelectorAll("button.open").forEach(btn => btn.addEventListener("click", () => openOrder(btn.dataset.id)));
}

/* Order form */
function openOrder(id) {
  const o = state.orders.find(x => x.id === id);
  if (!o) return;
  orderId.value = o.id;
  orderTitle.value = o.title;
  orderLocation.value = o.location || "";
  orderPilot.value = o.pilot;
  orderDroneId.value = o.droneId;
  orderSchedule.value = o.schedule || "";
  orderStatus.value = o.status;
  loadRoute(o.route);
  loadArea(o.area);
}
function resetOrderForm() {
  orderForm.reset();
  orderId.value = "";
  orderLocation.value = "";
  clearRoute();
  routeStats.textContent = "Sin ruta";
  clearArea();
  areaStats.textContent = "Sin área";
}

/* Route editing */
function startRoute() {
  if (!can("route")) return alert("Sin permiso para editar rutas");
  state.routeEditing = true;
  startRouteBtn.disabled = true;
  finishRouteBtn.classList.remove("ghost");
  clearRouteBtn.classList.remove("ghost");
  map.on("click", addRoutePoint);
}
function finishRoute() {
  state.routeEditing = false;
  startRouteBtn.disabled = false;
  finishRouteBtn.classList.add("ghost");
  map.off("click", addRoutePoint);
  updateRouteStats();
  attachRouteToOrder();
}
function clearRoute() {
  state.routePoints = [];
  routeLayer.clearLayers();
  updateRouteStats();
}
function addRoutePoint(e) {
  const { lat, lng } = e.latlng;
  state.routePoints.push([lng, lat]);
  drawRoute();
  updateRouteStats();
}
function drawRoute() {
  routeLayer.clearLayers();
  state.routePoints.forEach(([lng, lat]) => {
    L.circleMarker([lat, lng], { radius: 5, color: "#111", weight: 2, fillColor: "#111", fillOpacity: 1 })
      .addTo(routeLayer);
  });
  if (state.routePoints.length >= 2) {
    const latlngs = state.routePoints.map(([lng, lat]) => [lat, lng]);
    L.polyline(latlngs, { color: "#111", weight: 3 }).addTo(routeLayer);
  }
}
function updateRouteStats() {
  if (state.routePoints.length < 2) { routeStats.textContent = "Sin ruta"; return; }
  const line = turf.lineString(state.routePoints);
  const lengthKm = turf.length(line, { units: "kilometers" });
  routeStats.textContent = `Puntos: ${state.routePoints.length} · Longitud: ${lengthKm.toFixed(2)} km`;
}
function attachRouteToOrder() {
  const id = orderId.value;
  if (!id) return;
  const o = state.orders.find(x => x.id === id);
  if (!o) return;
  o.route = state.routePoints.length >= 2 ? { type: "LineString", coordinates: state.routePoints } : null;
  if (USE_LOCAL) {
    upsertOrderLocal(o);
  } else {
    (async () => { try { await api('/orders.php', { method: 'POST', body: JSON.stringify({ ...o, _op: 'update' }) }); } catch {} })();
  }
}
function loadArea(area) {
  clearArea();
  if (!area || area.type !== "Polygon") return;
  state.areaPoints = area.coordinates[0].slice(0, -1).map(p=>p.slice()); // exclude closing
  drawArea(); updateAreaStats();
}

/* Load saved route into map */
function loadRoute(route) {
  clearRoute();
  if (!route || route.type !== "LineString" || !Array.isArray(route.coordinates)) return;
  state.routePoints = route.coordinates.slice();
  drawRoute();
  updateRouteStats();
}

/* QGIS GeoJSON layers */
function addQgisLayer(geojson, name = "Capa QGIS") {
  const layer = L.geoJSON(geojson, {
    style: { color: "#555", weight: 2 },
    pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 4, color: "#333", fillColor: "#333", fillOpacity: 0.8 })
  }).addTo(qgisLayerGroup);
  state.layers.push({ id: uid(), name, layer });
  renderLayersList();
  try {
    const b = layer.getBounds();
    if (b.isValid()) map.fitBounds(b, { padding: [20,20] });
  } catch {}
}
function renderLayersList() {
  layersList.innerHTML = state.layers.map(l => `
    <li>
      <span>${l.name}</span>
      <div class="order-actions">
        <button data-id="${l.id}" class="toggle">Ocultar</button>
        <button data-id="${l.id}" class="remove">Quitar</button>
      </div>
    </li>`).join("");
  layersList.querySelectorAll("button.toggle").forEach(btn => btn.addEventListener("click", () => {
    const layer = state.layers.find(x => x.id === btn.dataset.id);
    if (!layer) return;
    const onMap = qgisLayerGroup.hasLayer(layer.layer);
    if (onMap) qgisLayerGroup.removeLayer(layer.layer); else qgisLayerGroup.addLayer(layer.layer);
    btn.textContent = onMap ? "Mostrar" : "Ocultar";
  }));
  layersList.querySelectorAll("button.remove").forEach(btn => btn.addEventListener("click", () => {
    const idx = state.layers.findIndex(x => x.id === btn.dataset.id);
    if (idx >= 0) {
      qgisLayerGroup.removeLayer(state.layers[idx].layer);
      state.layers.splice(idx, 1);
      renderLayersList();
    }
  }));
}

/* Event wiring */
loginBtn.addEventListener("click", () => {
  const u = USERS.find(x => x.id === loginSelect.value) || USERS[0];
  setSession(u);
});
logoutBtn.addEventListener("click", clearSession);

newOrderBtn.addEventListener("click", () => {
  if (!can("create")) return alert("Sin permiso para crear");
  resetOrderForm();
  orderStatus.value = "programada";
});
statusFilter.addEventListener("change", renderOrders);

orderForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const data = {
    id: orderId.value || uid(),
    title: orderTitle.value.trim(),
    location: orderLocation.value.trim(),
    pilot: orderPilot.value.trim(),
    droneId: orderDroneId.value.trim(),
    schedule: orderSchedule.value,
    status: orderStatus.value,
    route: (orderId.value ? state.orders.find(x => x.id === orderId.value)?.route : (state.routePoints.length>=2 ? { type: "LineString", coordinates: state.routePoints } : null)) || null,
    area: (orderId.value ? state.orders.find(x => x.id === orderId.value)?.area : (state.areaPoints.length>=3 ? { type:"Polygon", coordinates:[[...state.areaPoints, state.areaPoints[0]]] } : null)) || null
  };
  (async () => {
    try {
      const exists = state.orders.findIndex(x => x.id === data.id) >= 0;
      if (USE_LOCAL) {
        if (exists && !can('edit')) return alert('Sin permiso para editar');
        if (!exists && !can('create')) return alert('Sin permiso para crear');
        upsertOrderLocal(data);
        loadOrdersFromLocal();
      } else {
        if (exists) {
          if (!can('edit')) return alert('Sin permiso para editar');
          await api('/orders.php', { method: 'POST', body: JSON.stringify({ ...data, _op: 'update' }) });
        } else {
          if (!can('create')) return alert('Sin permiso para crear');
          await api('/orders.php', { method: 'POST', body: JSON.stringify({ ...data, _op: 'create' }) });
        }
        await loadOrdersFromApi();
      }
      openOrder(data.id);
    } catch (err) {
      console.error(err);
      alert('No se pudo guardar la orden');
    }
  })();
});

deleteOrderBtn.addEventListener("click", () => {
  if (!can("delete")) return alert("Sin permiso para eliminar");
  const id = orderId.value;
  if (!id) return;
  (async () => {
    try {
      if (USE_LOCAL) {
        deleteOrderLocal(id);
        loadOrdersFromLocal();
      } else {
        await api('/orders.php', { method: 'POST', body: JSON.stringify({ id, _op: 'delete' }) });
        await loadOrdersFromApi();
      }
      resetOrderForm();
    } catch (e) {
      alert('No se pudo eliminar');
    }
  })();
});

orderStatus.addEventListener("change", () => {
  if (!can("status")) { alert("Sin permiso para cambiar estado"); orderStatus.value = "programada"; return; }
  const id = orderId.value;
  if (!id) return;
  (async () => {
    try {
      const o = state.orders.find(x => x.id === id);
      if (!o) return;
      o.status = orderStatus.value;
      await api('/orders.php', { method: 'POST', body: JSON.stringify({ ...o, _op: 'update' }) });
      await loadOrdersFromApi();
    } catch (e) { alert('No se pudo actualizar el estado'); }
  })();
});

startRouteBtn.addEventListener("click", startRoute);
finishRouteBtn.addEventListener("click", finishRoute);
clearRouteBtn.addEventListener("click", () => { if (!can("route")) return alert("Sin permiso"); clearRoute(); attachRouteToOrder(); });

startAreaBtn.addEventListener("click", startArea);
finishAreaBtn.addEventListener("click", finishArea);
clearAreaBtn.addEventListener("click", () => { if (!can("route")) return alert("Sin permiso"); clearArea(); attachAreaToOrder(); });

qgisFileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!can("layers")) return alert("Sin permiso para cargar capas");
  const text = await file.text();
  try {
    const geojson = JSON.parse(text);
    addQgisLayer(geojson, file.name);
  } catch {
    alert("Archivo GeoJSON inválido");
  } finally {
    qgisFileInput.value = "";
  }
});

orderLocation.addEventListener("change", async () => {
  const query = orderLocation.value.trim();
  if (!query) return;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
    const data = await res.json();
    if (data && data[0]) {
      const { lat, lon } = data[0];
      map.setView([lat, lon], 12);
    } else {
      alert("Ubicación no encontrada");
    }
  } catch {
    alert("Error al buscar ubicación");
  }
});

/* Initial render */
function refreshUI() {
  const logged = !!state.session;
  [newOrderBtn, saveOrderBtn, deleteOrderBtn, startRouteBtn, clearRouteBtn, startAreaBtn, finishAreaBtn, clearAreaBtn].forEach(btn => btn.disabled = !logged);
  renderOrders();
}
initLogin();
refreshUI();

/* Area editing */
function startArea() {
  if (!can("route")) return alert("Sin permiso para editar área");
  state.areaEditing = true;
  startAreaBtn.disabled = true;
  finishAreaBtn.classList.remove("ghost");
  clearAreaBtn.classList.remove("ghost");
  map.on("click", addAreaPoint);
}
function finishArea() {
  state.areaEditing = false;
  startAreaBtn.disabled = false;
  finishAreaBtn.classList.add("ghost");
  map.off("click", addAreaPoint);
  updateAreaStats();
  attachAreaToOrder();
}
function clearArea() {
  state.areaPoints = [];
  areaLayer.clearLayers();
  updateAreaStats();
}
function addAreaPoint(e) {
  const { lat, lng } = e.latlng;
  state.areaPoints.push([lng, lat]);
  drawArea(); updateAreaStats();
}
function drawArea() {
  areaLayer.clearLayers();
  state.areaPoints.forEach(([lng, lat]) => {
    L.circleMarker([lat, lng], { radius: 5, color: "#111", weight: 2, fillColor: "#111", fillOpacity: 1 })
      .addTo(areaLayer);
  });
  if (state.areaPoints.length >= 3) {
    const ring = [...state.areaPoints, state.areaPoints[0]];
    const latlngs = ring.map(([lng, lat]) => [lat, lng]);
    L.polygon(latlngs, { color: "#111", weight: 2, fillOpacity: 0.08 }).addTo(areaLayer);
  }
}
function updateAreaStats() {
  if (state.areaPoints.length < 3) { areaStats.textContent = "Sin área"; return; }
  const polygon = turf.polygon([[...state.areaPoints, state.areaPoints[0]]]);
  const m2 = turf.area(polygon);
  const km2 = m2 / 1e6;
  areaStats.textContent = `Puntos: ${state.areaPoints.length} · Área: ${km2.toFixed(3)} km²`;
}
function attachAreaToOrder() {
  const id = orderId.value; if (!id) return;
  const o = state.orders.find(x => x.id === id); if (!o) return;
  if (state.areaPoints.length >= 3) {
    o.area = { type: "Polygon", coordinates: [[...state.areaPoints, state.areaPoints[0]]] };
  } else { o.area = null; }
  if (USE_LOCAL) {
    upsertOrderLocal(o);
  } else {
    (async () => { try { await api('/orders.php', { method: 'POST', body: JSON.stringify({ ...o, _op: 'update' }) }); } catch {} })();
  }
}