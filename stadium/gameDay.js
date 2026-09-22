import * as Cesium from 'cesium';
import { createSyntheticEvent, eventSnapshot, formatEventTime, groupAt, ROUTES, VIEWPOINTS } from './syntheticEvent.js';

const $ = (selector) => document.querySelector(selector);
const money = (amount) => `$${amount.toLocaleString('en-US', { minimumFractionDigits: amount % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const colors = {
  approaching: Cesium.Color.fromCssColorString('#4ce5d6'),
  parking: Cesium.Color.fromCssColorString('#b3ec74'),
  queue: Cesium.Color.fromCssColorString('#ffb84d'),
  admitted: Cesium.Color.fromCssColorString('#e09aff'),
  concourse: Cesium.Color.fromCssColorString('#e09aff'),
  seated: Cesium.Color.fromCssColorString('#8bb7ff'),
};

export function createGameDay() {
  let event = createSyntheticEvent();
  let time = -35 * 60;
  let playing = true;
  let speed = 4;
  let sortKey = 'time';
  let sortDirection = -1;
  let filter = 'all';
  let viewer;
  let collection;
  let points = [];
  let routeEntities = [];
  let camera = { ...VIEWPOINTS.overview };
  let lastTick = performance.now();
  let lastPanel = 0;

  function renderPanel() {
    const snapshot = eventSnapshot(event, time);
    $('#sim-clock').textContent = formatEventTime(time);
    $('#sim-scrubber').value = String(Math.round(time / 30) * 30);
    $('#sim-play').textContent = playing ? 'Pause' : 'Play';
    $('#metric-people').textContent = event.people.toLocaleString();
    $('#metric-cars').textContent = snapshot.cars.toLocaleString();
    $('#metric-queue').textContent = snapshot.counts.queue.toLocaleString();
    $('#metric-admitted').textContent = snapshot.admitted.toLocaleString();
    $('#metric-spend').textContent = money(snapshot.spend);
    $('#metric-transactions').textContent = snapshot.transactions.length.toLocaleString();
    const transactions = snapshot.transactions.filter((entry) => filter === 'all' || entry.type === filter);
    transactions.sort((a, b) => {
      const first = a[sortKey];
      const second = b[sortKey];
      const result = typeof first === 'number' ? first - second : String(first).localeCompare(String(second));
      return sortDirection * (result || a.time - b.time);
    });
    $('#tx-rows').innerHTML = transactions.length
      ? transactions.slice(0, 90).map((entry) => `<div class="tx-row" role="row" title="Synthetic ${entry.type.toLowerCase()} event for group ${entry.groupId}, ${entry.party} people, ${entry.method}"><span>${formatEventTime(entry.time)}</span><span>${entry.type}</span><span>${entry.zone}</span><span>${entry.amount ? money(entry.amount) : 'Scan'}</span></div>`).join('')
      : '<div class="tx-empty">No transactions at this time.</div>';
    document.querySelectorAll('[data-sort]').forEach((button) => button.classList.toggle('active', button.dataset.sort === sortKey));
  }

  function buildMapPoints() {
    if (!viewer) return;
    if (collection) viewer.scene.primitives.remove(collection);
    routeEntities.forEach((entity) => viewer.entities.remove(entity));
    routeEntities = Object.values(ROUTES).map((route) => viewer.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights([route.start[0], route.start[1], 8, route.approach[0], route.approach[1], 8, route.gate[0], route.gate[1], 8, route.concourse[0], route.concourse[1], 8]),
        width: 2,
        material: Cesium.Color.fromCssColorString('#4ce5d6').withAlpha(.46),
        clampToGround: false,
      },
    }));
    collection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
    points = event.groups.map((group) => collection.add({
      id: group.id,
      position: Cesium.Cartesian3.fromDegrees(group.start[0], group.start[1], 12),
      color: colors.approaching,
      outlineColor: Cesium.Color.fromCssColorString('#0b1725'),
      outlineWidth: 1,
      pixelSize: Math.min(11, 5 + group.party),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      show: false,
    }));
    updateMapPoints();
  }

  function updateMapPoints() {
    if (!collection) return;
    event.groups.forEach((group, index) => {
      const state = groupAt(group, time);
      const point = points[index];
      point.show = Boolean(state.position);
      if (!state.position) return;
      point.position = Cesium.Cartesian3.fromDegrees(state.position[0], state.position[1], 12);
      point.color = colors[state.stage];
    });
    viewer.scene.requestRender();
  }

  function flyTo(view) {
    camera = { ...view };
    document.querySelectorAll('[data-camera]').forEach((button) => button.classList.toggle('active', button.dataset.camera === view.key));
    if (!viewer) return;
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(view.lon, view.lat), 1), {
      offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(view.heading), Cesium.Math.toRadians(view.pitch), view.range),
      duration: 1.1,
    });
    $('#map-view-label').textContent = view.label.toUpperCase();
  }

  function rebuild() {
    const kind = $('#sim-kind').value;
    const groupCount = Math.max(50, Math.min(500, Math.round(Number($('#sim-groups').value) || 280)));
    $('#sim-groups').value = String(groupCount);
    event = createSyntheticEvent({ kind, groupCount });
    time = -35 * 60;
    playing = true;
    buildMapPoints();
    renderPanel();
  }

  $('#sim-play').addEventListener('click', () => { playing = !playing; lastTick = performance.now(); renderPanel(); });
  $('#sim-reset').addEventListener('click', () => { time = -35 * 60; playing = true; updateMapPoints(); renderPanel(); });
  $('#sim-speed').addEventListener('change', () => { speed = Number($('#sim-speed').value); });
  $('#sim-kind').addEventListener('change', rebuild);
  $('#sim-groups').addEventListener('change', rebuild);
  $('#sim-scrubber').addEventListener('input', () => { time = Number($('#sim-scrubber').value); updateMapPoints(); renderPanel(); });
  $('#tx-filter').addEventListener('change', () => { filter = $('#tx-filter').value; renderPanel(); });
  document.querySelectorAll('[data-sort]').forEach((button) => button.addEventListener('click', () => {
    if (sortKey === button.dataset.sort) sortDirection *= -1;
    else { sortKey = button.dataset.sort; sortDirection = button.dataset.sort === 'time' ? -1 : 1; }
    renderPanel();
  }));
  document.querySelectorAll('[data-camera]').forEach((button) => button.addEventListener('click', () => flyTo({ ...VIEWPOINTS[button.dataset.camera], key: button.dataset.camera })));
  $('#camera-closer').addEventListener('click', () => flyTo({ ...camera, key: 'close', label: 'Close view', range: Math.max(22, Math.round(camera.range * .55)) }));
  $('#tab-activity').addEventListener('click', () => {
    $('#activity-section').hidden = false; $('#operations-section').hidden = true;
    $('#tab-activity').classList.add('active'); $('#tab-operations').classList.remove('active');
  });
  $('#tab-operations').addEventListener('click', () => {
    $('#activity-section').hidden = true; $('#operations-section').hidden = false;
    $('#tab-activity').classList.remove('active'); $('#tab-operations').classList.add('active');
  });

  function tick(now) {
    const elapsed = Math.min(.2, (now - lastTick) / 1000);
    lastTick = now;
    if (playing) {
      time = Math.min(event.lastTime, time + elapsed * speed * 12);
      if (time >= event.lastTime) playing = false;
      updateMapPoints();
    }
    if (now - lastPanel >= 400) { renderPanel(); lastPanel = now; }
    requestAnimationFrame(tick);
  }
  renderPanel();
  requestAnimationFrame(tick);
  return { attachViewer(mapViewer) { viewer = mapViewer; buildMapPoints(); } };
}
