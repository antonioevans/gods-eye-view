import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import themes from './theme/index.json';
import { createGameDay } from './gameDay.js';

const CENTER = { lat: 40.7570308, lon: -73.8457626 };
const STORAGE = 'noble-citi-field-demo-v1';
const SETTINGS = 'noble-citi-field-settings-v1';
const defaults = {
  zones: [
    { id: 'field', name: 'Field level', lat: 40.75689, lon: -73.84612, archived: false },
    { id: 'north', name: 'North perimeter', lat: 40.75804, lon: -73.84567, archived: false },
    { id: 'east', name: 'East concourse', lat: 40.75702, lon: -73.84476, archived: false },
    { id: 'south', name: 'South entry', lat: 40.75610, lon: -73.84524, archived: false },
    { id: 'west', name: 'West perimeter', lat: 40.75705, lon: -73.84702, archived: false },
  ],
  issues: [
    { id: 'demo-1', title: 'Gate readiness check', zone: 'south', priority: 'High', status: 'Open', owner: 'Venue team', notes: 'Sample pre-event walkthrough item.', archived: false },
    { id: 'demo-2', title: 'Concourse inspection', zone: 'east', priority: 'Medium', status: 'Acknowledged', owner: 'Facilities', notes: 'Sample facilities review item.', archived: false },
    { id: 'demo-3', title: 'Field equipment check', zone: 'field', priority: 'Low', status: 'Open', owner: 'Operations', notes: 'Sample equipment checklist item.', archived: false },
  ],
};
const clone = (value) => structuredClone(value);
function load(key, fallback) {
  try { const value = JSON.parse(localStorage.getItem(key)); return value && typeof value === 'object' ? value : clone(fallback); }
  catch { return clone(fallback); }
}
let data = load(STORAGE, defaults);
if (!Array.isArray(data.zones) || !Array.isArray(data.issues)) data = clone(defaults);
let settings = load(SETTINGS, { theme: 'midnight', imagery: 'esri' });
let selectedZone = null;
let filter = 'open';
let editingIssue = null;
let editingZone = null;
let viewer;
let zoneEntities = [];
let gameDay;

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const persist = () => localStorage.setItem(STORAGE, JSON.stringify(data));
const persistSettings = () => localStorage.setItem(SETTINGS, JSON.stringify(settings));
const activeZones = () => data.zones.filter((zone) => !zone.archived);
const activeIssues = () => data.issues.filter((issue) => !issue.archived);
const zoneName = (id) => data.zones.find((zone) => zone.id === id)?.name || 'Archived zone';

function renderZones() {
  $('#zone-list').innerHTML = activeZones().map((zone, index) => {
    const count = activeIssues().filter((issue) => issue.zone === zone.id && issue.status !== 'Resolved').length;
    return `<div class="zone-row ${selectedZone === zone.id ? 'selected' : ''}" data-zone="${esc(zone.id)}" title="Focus the map on ${esc(zone.name)}">
      <span class="zone-index">${String(index + 1).padStart(2, '0')}</span>
      <span class="zone-name">${esc(zone.name)}</span>
      <span class="zone-actions"><span class="zone-issue-count" title="Open issues in this zone">${count}</span><button class="zone-edit" data-edit-zone="${esc(zone.id)}" aria-label="Edit ${esc(zone.name)}" title="Edit this demo zone">⋯</button></span>
    </div>`;
  }).join('') || '<div class="empty-state">No zones are active.</div>';
  $('#zone-list').querySelectorAll('[data-zone]').forEach((row) => row.addEventListener('click', (event) => {
    if (event.target.closest('[data-edit-zone]')) return;
    focusZone(row.dataset.zone);
  }));
  $('#zone-list').querySelectorAll('[data-edit-zone]').forEach((button) => button.addEventListener('click', () => openZone(button.dataset.editZone)));
  $('#issue-zone').innerHTML = activeZones().map((zone) => `<option value="${esc(zone.id)}">${esc(zone.name)}</option>`).join('');
  const archived = data.zones.filter((zone) => zone.archived);
  $('#archived-zones').innerHTML = archived.length ? `<h3 title="Restore archived demo zones">Archived zones <span class="hint-mark" title="Archived zones stay in the demo and can be restored">?</span></h3>${archived.map((zone) => `<button class="quiet-button" data-restore-zone="${esc(zone.id)}" title="Restore ${esc(zone.name)}">Restore ${esc(zone.name)}</button>`).join('')}` : '';
  $('#archived-zones').querySelectorAll('[data-restore-zone]').forEach((button) => button.addEventListener('click', () => {
    const zone = data.zones.find((item) => item.id === button.dataset.restoreZone);
    if (!zone) return;
    zone.archived = false; persist(); renderZones(); renderIssues(); renderMapZones();
  }));
}

function renderIssues() {
  const filtered = (filter === 'archived' ? data.issues.filter((issue) => issue.archived) : activeIssues()).filter((issue) => (filter === 'all' || filter === 'archived' || (filter === 'resolved' ? issue.status === 'Resolved' : issue.status !== 'Resolved')) && (!selectedZone || issue.zone === selectedZone));
  $('#incident-list').innerHTML = filtered.map((issue) => `<article class="incident-card" title="Demo operational issue">
    <div class="incident-kind ${issue.priority.toLowerCase()}" title="${esc(issue.priority)} priority">${esc(issue.priority)} PRIORITY</div>
    <div class="incident-body">
      <div class="incident-header"><button class="incident-title" data-edit-issue="${esc(issue.id)}" title="Edit issue">${esc(issue.title)}</button><span class="status-pill ${issue.status.toLowerCase()}" title="Current issue status">${issue.archived ? 'Archived' : esc(issue.status)}</span></div>
      <div class="incident-notes">${esc(issue.notes || 'No notes')}</div>
      <div class="incident-meta"><span title="Operating zone">${esc(zoneName(issue.zone))}</span><span title="Assigned owner">${esc(issue.owner || 'Unassigned')}</span></div>
      <div class="incident-actions">${issue.archived ? `<button data-restore-issue="${esc(issue.id)}" title="Restore this issue">Restore</button>` : `<button data-focus-issue="${esc(issue.id)}" title="Focus this issue's zone on the map">Locate</button>${issue.status !== 'Resolved' ? `<button data-next-issue="${esc(issue.id)}" title="${issue.status === 'Open' ? 'Acknowledge' : 'Resolve'} this issue">${issue.status === 'Open' ? 'Acknowledge' : 'Resolve'}</button>` : ''}`}</div>
    </div></article>`).join('') || '<div class="empty-state">No issues match this view.</div>';
  $('#incident-list').querySelectorAll('[data-edit-issue]').forEach((button) => button.addEventListener('click', () => openIssue(button.dataset.editIssue)));
  $('#incident-list').querySelectorAll('[data-focus-issue]').forEach((button) => button.addEventListener('click', () => {
    const issue = data.issues.find((item) => item.id === button.dataset.focusIssue);
    if (issue) focusZone(issue.zone);
  }));
  $('#incident-list').querySelectorAll('[data-next-issue]').forEach((button) => button.addEventListener('click', () => {
    const issue = data.issues.find((item) => item.id === button.dataset.nextIssue);
    if (!issue) return;
    issue.status = issue.status === 'Open' ? 'Acknowledged' : 'Resolved';
    persist(); renderZones(); renderIssues();
  }));
  $('#incident-list').querySelectorAll('[data-restore-issue]').forEach((button) => button.addEventListener('click', () => {
    const issue = data.issues.find((item) => item.id === button.dataset.restoreIssue);
    if (!issue) return;
    issue.archived = false; persist(); renderZones(); renderIssues();
  }));
}

function renderMapZones() {
  if (!viewer) return;
  zoneEntities.forEach((entity) => viewer.entities.remove(entity));
  zoneEntities = activeZones().map((zone, index) => viewer.entities.add({
    id: `zone-${zone.id}`,
    position: Cesium.Cartesian3.fromDegrees(zone.lon, zone.lat, 35),
    point: { pixelSize: selectedZone === zone.id ? 33 : 28, color: Cesium.Color.fromCssColorString(selectedZone === zone.id ? '#f5c46b' : '#48dfd1'), outlineColor: Cesium.Color.fromCssColorString('#0b1725'), outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    label: { text: String(index + 1).padStart(2, '0'), font: '700 12px IBM Plex Mono', style: Cesium.LabelStyle.FILL_AND_OUTLINE, fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.fromCssColorString('#0b1725'), outlineWidth: 4, pixelOffset: new Cesium.Cartesian2(0, -30), verticalOrigin: Cesium.VerticalOrigin.BOTTOM, horizontalOrigin: Cesium.HorizontalOrigin.CENTER, disableDepthTestDistance: Number.POSITIVE_INFINITY },
  }));
}

function focusZone(id) {
  selectedZone = selectedZone === id ? null : id;
  const zone = activeZones().find((item) => item.id === selectedZone);
  $('#map-view-label').textContent = zone ? zone.name.toUpperCase() : 'VENUE OVERVIEW';
  renderZones(); renderIssues(); renderMapZones();
  if (zone && viewer) viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(zone.lon, zone.lat), 1), { offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(12), Cesium.Math.toRadians(-63), 850), duration: 1.3 });
  else if (!zone) resetView();
}
function resetView() {
  selectedZone = null;
  $('#map-view-label').textContent = 'VENUE OVERVIEW';
  renderZones(); renderIssues(); renderMapZones();
  if (viewer) viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(CENTER.lon, CENTER.lat), 1), { offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(18), Cesium.Math.toRadians(-66), 1300), duration: 1.3 });
}

async function setImagery(source) {
  settings.imagery = source;
  persistSettings();
  if (!viewer) return;
  try {
    const provider = source === 'esri'
      ? await Cesium.ArcGisMapServerImageryProvider.fromUrl('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer', { enablePickFeatures: false })
      : new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/', credit: '© OpenStreetMap contributors' });
    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.addImageryProvider(provider);
    $('#manual-credits').innerHTML = source === 'esri'
      ? '<a href="https://www.esri.com" target="_blank" rel="noopener">Imagery: Esri, Maxar, Earthstar Geographics</a>'
      : '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>';
    $('#map-error').hidden = true;
  } catch (error) {
    $('#map-error').hidden = false;
    $('#map-error').textContent = `Map imagery unavailable: ${error.message}`;
  }
}

function initMap() {
  try {
    viewer = new Cesium.Viewer('globe', {
      animation: false, timeline: false, baseLayerPicker: false, geocoder: false,
      homeButton: false, sceneModePicker: false, navigationHelpButton: false,
      fullscreenButton: false, infoBox: false, selectionIndicator: false,
      baseLayer: false, terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      creditContainer: $('#cesium-credits'),
    });
    viewer.scene.globe.enableLighting = false;
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#101826');
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 12;
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 50000;
    viewer.camera.lookAt(Cesium.Cartesian3.fromDegrees(CENTER.lon, CENTER.lat), new Cesium.HeadingPitchRange(Cesium.Math.toRadians(18), Cesium.Math.toRadians(-66), 1300));
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    viewer.selectedEntityChanged.addEventListener((entity) => {
      if (entity?.id?.startsWith('zone-')) focusZone(entity.id.slice(5));
    });
    renderMapZones();
    gameDay.attachViewer(viewer);
    setImagery(settings.imagery === 'osm' ? 'osm' : 'esri');
  } catch (error) {
    $('#map-error').hidden = false;
    $('#map-error').textContent = `3D map unavailable: ${error.message}`;
    console.error(error);
  }
}

function openIssue(id = null) {
  editingIssue = id;
  const issue = data.issues.find((item) => item.id === id);
  $('#issue-dialog-title').innerHTML = `${issue ? 'Edit issue' : 'New issue'} <span class="hint-mark" title="Issue details are saved in this browser">?</span>`;
  const form = $('#issue-form');
  form.reset();
  if (issue) for (const key of ['title', 'zone', 'priority', 'status', 'owner', 'notes']) form.elements[key].value = issue[key] || '';
  else { form.elements.zone.value = selectedZone || activeZones()[0]?.id || ''; form.elements.status.value = 'Open'; }
  $('#archive-issue').hidden = !issue;
  $('#issue-dialog').showModal();
}
function openZone(id = null) {
  editingZone = id;
  const zone = data.zones.find((item) => item.id === id);
  $('#zone-dialog-title').innerHTML = `${zone ? 'Edit zone' : 'New zone'} <span class="hint-mark" title="Zone locations are illustrative and editable">?</span>`;
  const form = $('#zone-form'); form.reset();
  form.elements.name.value = zone?.name || '';
  form.elements.lat.value = zone?.lat ?? CENTER.lat;
  form.elements.lon.value = zone?.lon ?? CENTER.lon;
  $('#archive-zone').hidden = !zone;
  $('#zone-dialog').showModal();
}

const weatherText = (code) => {
  if (code === 0) return 'Clear';
  if ([1, 2, 3].includes(code)) return 'Cloudy';
  if ([45, 48].includes(code)) return 'Fog';
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return 'Rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow';
  if ([95, 96, 99].includes(code)) return 'Thunderstorm';
  return 'Current conditions';
};
async function refreshWeather() {
  $('#weather-source-status').textContent = 'Loading';
  $('#refresh-weather').disabled = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(CENTER.lat));
    url.searchParams.set('longitude', String(CENTER.lon));
    url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m');
    url.searchParams.set('temperature_unit', 'fahrenheit');
    url.searchParams.set('wind_speed_unit', 'mph');
    url.searchParams.set('precipitation_unit', 'inch');
    url.searchParams.set('timezone', 'America/New_York');
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const current = payload.current;
    if (!current || !Number.isFinite(current.temperature_2m)) throw new Error('No current reading');
    $('#weather-temp').textContent = `${Math.round(current.temperature_2m)}°`;
    $('#weather-condition').textContent = weatherText(current.weather_code);
    $('#weather-wind').textContent = `${Math.round(current.wind_speed_10m)} mph`;
    $('#weather-rain').textContent = `${Number(current.precipitation || 0).toFixed(2)} in`;
    $('#weather-humidity').textContent = `${Math.round(current.relative_humidity_2m)}%`;
    $('#weather-updated').textContent = `MODEL TIME ${current.time.replace('T', ' ')} ET · OPEN-METEO`;
    $('#weather-source-status').textContent = 'Current';
  } catch (error) {
    $('#weather-condition').textContent = 'Weather unavailable';
    $('#weather-updated').textContent = `SOURCE ERROR · ${error.message}`;
    $('#weather-source-status').textContent = 'Unavailable';
  } finally { clearTimeout(timeout); $('#refresh-weather').disabled = false; }
}

function applyTheme(brand) {
  const theme = themes.find((item) => item.brand === brand) || themes[0];
  settings.theme = theme.brand;
  document.documentElement.dataset.theme = theme.brand;
  $('#theme-stylesheet').href = new URL(theme.file, window.location.href).href;
  persistSettings();
  renderThemeOptions();
}
function renderThemeOptions() {
  const query = $('#theme-search').value.trim().toLowerCase();
  $('#theme-options').innerHTML = themes.filter((item) => item.name.toLowerCase().includes(query)).map((theme) => `<button class="theme-choice ${settings.theme === theme.brand ? 'active' : ''}" data-theme-choice="${theme.brand}" title="Use ${theme.name} theme"><span class="swatch">${theme.swatches.map((color) => `<i style="background:${color}"></i>`).join('')}</span><span>${theme.name}</span></button>`).join('') || '<div class="empty-state">No themes match.</div>';
  $('#theme-options').querySelectorAll('[data-theme-choice]').forEach((button) => button.addEventListener('click', () => applyTheme(button.dataset.themeChoice)));
}

function initControls() {
  $('#reset-view').addEventListener('click', resetView);
  $('#add-zone').addEventListener('click', () => openZone());
  $('#add-incident').addEventListener('click', () => openIssue());
  $('#refresh-weather').addEventListener('click', refreshWeather);
  $('#settings-open').addEventListener('click', () => $('#settings-dialog').showModal());
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));
  document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => {
    filter = button.dataset.filter;
    document.querySelectorAll('.filter').forEach((item) => item.classList.toggle('active', item === button));
    renderIssues();
  }));
  $('#issue-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const issue = data.issues.find((item) => item.id === editingIssue);
    if (issue) Object.assign(issue, values);
    else data.issues.unshift({ id: crypto.randomUUID(), ...values, archived: false });
    persist(); renderZones(); renderIssues(); $('#issue-dialog').close();
  });
  $('#archive-issue').addEventListener('click', () => {
    const issue = data.issues.find((item) => item.id === editingIssue);
    if (!issue || !confirm(`Archive ${issue.title}? You can restore it from the Archived view.`)) return;
    issue.archived = true; persist(); renderZones(); renderIssues(); $('#issue-dialog').close();
  });
  $('#zone-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const zone = data.zones.find((item) => item.id === editingZone);
    if (zone) Object.assign(zone, { ...values, lat: Number(values.lat), lon: Number(values.lon) });
    else data.zones.push({ id: crypto.randomUUID(), name: values.name, lat: Number(values.lat), lon: Number(values.lon), archived: false });
    persist(); renderZones(); renderIssues(); renderMapZones(); $('#zone-dialog').close();
  });
  $('#archive-zone').addEventListener('click', () => {
    const zone = data.zones.find((item) => item.id === editingZone);
    if (!zone || !confirm(`Archive ${zone.name}? Issues in this zone will remain in the demo.`)) return;
    zone.archived = true;
    if (selectedZone === zone.id) selectedZone = null;
    persist(); renderZones(); renderIssues(); renderMapZones(); $('#zone-dialog').close();
  });
  $('#imagery-select').value = settings.imagery === 'osm' ? 'osm' : 'esri';
  $('#imagery-select').addEventListener('change', (event) => setImagery(event.target.value));
  $('#theme-search').addEventListener('input', renderThemeOptions);
  $('#export-data').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ venue: 'Citi Field', exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'noble-citi-field-demo.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('#reset-demo').addEventListener('click', () => {
    if (!confirm('Restore the original demo zones and issues?')) return;
    data = clone(defaults); selectedZone = null; persist(); renderZones(); renderIssues(); renderMapZones(); resetView(); $('#settings-dialog').close();
  });
}

function updateClock() {
  $('#map-clock').textContent = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).format(new Date()).toUpperCase() + ' ET';
}
initControls();
gameDay = createGameDay();
renderZones(); renderIssues(); renderThemeOptions(); applyTheme(settings.theme);
updateClock(); setInterval(updateClock, 30000);
initMap(); refreshWeather(); setInterval(refreshWeather, 15 * 60 * 1000);
