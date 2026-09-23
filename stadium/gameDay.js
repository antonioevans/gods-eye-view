import * as Cesium from 'cesium';
import { createSyntheticEvent, eventSnapshot, formatEventTime, groupAt, VIEWPOINTS } from './syntheticEvent.js';
import { DEFAULT_RULES, GATES, TEMPLATES, gateBarrier, planEvent } from './pathNetwork.js';
import { createFlowMap } from './flowMap.js';

const $ = (selector) => document.querySelector(selector);
const money = (amount) => `$${amount.toLocaleString('en-US', { minimumFractionDigits: amount % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const FLOW_STORAGE = 'noble-citi-field-flow-v1';
function loadFlow() {
  try {
    const saved = JSON.parse(localStorage.getItem(FLOW_STORAGE));
    if (saved && typeof saved === 'object' && Array.isArray(saved.barriers)) return {
      templateId: TEMPLATES.some((item) => item.id === saved.templateId) ? saved.templateId : 'custom',
      rules: { ...DEFAULT_RULES, ...saved.rules, closedGates: Array.isArray(saved.rules?.closedGates) ? saved.rules.closedGates : [] },
      barriers: saved.barriers.filter((item) => item && typeof item.edgeId === 'string' && Array.isArray(item.position)),
      showPaths: saved.showPaths !== false,
      auto3D: saved.auto3D !== false,
    };
  } catch { /* Use the default flow when browser storage is unavailable. */ }
  return { templateId: 'open', rules: { ...DEFAULT_RULES, closedGates: [] }, barriers: [], showPaths: true, auto3D: true };
}
const colors = {
  approaching: Cesium.Color.fromCssColorString('#4ce5d6'),
  parking: Cesium.Color.fromCssColorString('#b3ec74'),
  queue: Cesium.Color.fromCssColorString('#ffb84d'),
  admitted: Cesium.Color.fromCssColorString('#e09aff'),
  concourse: Cesium.Color.fromCssColorString('#e09aff'),
  seated: Cesium.Color.fromCssColorString('#8bb7ff'),
  blocked: Cesium.Color.fromCssColorString('#ef5b5b'),
};

export function createGameDay() {
  let baseEvent = createSyntheticEvent();
  let baseline = planEvent(baseEvent);
  let flow = loadFlow();
  let event = planEvent(baseEvent, flow.rules, getBarriers());
  let time = -35 * 60;
  let playing = true;
  let speed = 4;
  let sortKey = 'time';
  let sortDirection = -1;
  let filter = 'all';
  let viewer;
  let collection;
  let points = [];
  let placing = false;
  let last3D = false;
  let camera = { ...VIEWPOINTS.overview };
  let lastTick = performance.now();
  let lastPanel = 0;
  const flowMap = createFlowMap((match) => {
    if (!placing) return;
    if (!match) { status('Click within 30 m of a mapped pedestrian path.'); return; }
    const previous = new Map(event.groups.map((group) => [group.id, { gate: group.gateId, path: group.pathEdges?.join(','), walk: group.walkSeconds }]));
    flow.barriers.push({ id: crypto.randomUUID(), name: `Barrier ${flow.barriers.length + 1}`, edgeId: match.edge.id, position: match.position, kind: $('#barrier-kind').value, color: $('#barrier-color').value, archived: false });
    setPlacing(false);
    saveFlow();
    replan();
    const affected = event.groups.reduce((sum, group) => {
      const before = previous.get(group.id);
      return sum + (before && (before.gate !== group.gateId || before.path !== group.pathEdges?.join(',') || before.walk !== group.walkSeconds) ? group.party : 0);
    }, 0);
    status(affected ? `Barrier placed. ${affected} visitors affected.` : 'Barrier placed. No current visitor route uses that segment.');
  });

  function getBarriers() {
    return [...flow.barriers, ...(flow.rules.closedGates || []).map(gateBarrier).filter(Boolean)];
  }
  function saveFlow() { localStorage.setItem(FLOW_STORAGE, JSON.stringify(flow)); }
  function status(message) { $('#barrier-status').hidden = !message; $('#barrier-status').textContent = message; }
  function setPlacing(value) {
    placing = value;
    flowMap.setPlaceMode(value);
    $('#barrier-place').classList.toggle('placing', value);
    $('#barrier-place').textContent = value ? 'Cancel placement' : 'Place on map';
    status(value ? 'Click a mapped pedestrian path on the map.' : '');
  }

  function renderBarrierList() {
    const entries = getBarriers();
    $('#barrier-list').innerHTML = entries.map((barrier) => {
      if (barrier.template) return `<div class="barrier-item" style="--barrier-color:${escapeHtml(barrier.color)}" title="Template gate closure"><div class="barrier-color-bar"></div><div class="barrier-item-body"><strong>${escapeHtml(barrier.name)}</strong><span class="derived">Template rule (locked)</span></div></div>`;
      return `<div class="barrier-item ${barrier.archived ? 'archived' : ''}" style="--barrier-color:${escapeHtml(barrier.color)}" title="Edit this synthetic barrier"><div class="barrier-color-bar"></div><div class="barrier-item-body"><input data-barrier-name="${escapeHtml(barrier.id)}" type="text" maxlength="40" aria-label="Barrier name" title="Rename this barrier" value="${escapeHtml(barrier.name)}" /><div class="barrier-item-actions"><input data-barrier-color="${escapeHtml(barrier.id)}" type="color" value="${escapeHtml(barrier.color)}" aria-label="Barrier color" title="Change barrier color" /><select data-barrier-effect="${escapeHtml(barrier.id)}" aria-label="Barrier effect" title="Change routing effect"><option value="closed" ${barrier.kind === 'closed' ? 'selected' : ''}>Closed</option><option value="slow" ${barrier.kind === 'slow' ? 'selected' : ''}>Slow</option></select><button data-barrier-archive="${escapeHtml(barrier.id)}" title="${barrier.archived ? 'Restore' : 'Archive'} this barrier">${barrier.archived ? 'Restore' : 'Archive'}</button></div></div></div>`;
    }).join('') || '<div class="tx-empty">No barriers placed.</div>';
    const update = (id, key, value) => {
      const barrier = flow.barriers.find((item) => item.id === id);
      if (!barrier) return;
      barrier[key] = value;
      saveFlow();
      replan();
    };
    $('#barrier-list').querySelectorAll('[data-barrier-name]').forEach((input) => input.addEventListener('change', () => update(input.dataset.barrierName, 'name', input.value.trim() || 'Barrier')));
    $('#barrier-list').querySelectorAll('[data-barrier-color]').forEach((input) => input.addEventListener('change', () => update(input.dataset.barrierColor, 'color', input.value)));
    $('#barrier-list').querySelectorAll('[data-barrier-effect]').forEach((input) => input.addEventListener('change', () => update(input.dataset.barrierEffect, 'kind', input.value)));
    $('#barrier-list').querySelectorAll('[data-barrier-archive]').forEach((button) => button.addEventListener('click', () => {
      const barrier = flow.barriers.find((item) => item.id === button.dataset.barrierArchive);
      if (!barrier) return;
      barrier.archived = !barrier.archived;
      saveFlow();
      replan();
    }));
  }

  function renderFlow() {
    $('#flow-template').value = flow.templateId;
    $('#flow-gate-rule').value = flow.rules.gatePolicy;
    $('#flow-capacity').value = String(flow.rules.capacity);
    $('#flow-avoid-steps').checked = flow.rules.avoidSteps;
    $('#flow-show-paths').checked = flow.showPaths;
    $('#flow-auto-3d').checked = flow.auto3D;
    const baselineGates = new Map(baseline.groups.map((group) => [group.id, group.gateId]));
    const diverted = event.groups.reduce((sum, group) => sum + (group.gateId !== baselineGates.get(group.id) ? group.party : 0), 0);
    const blocked = event.groups.reduce((sum, group) => sum + (group.unreachable ? group.party : 0), 0);
    $('#flow-diverted').textContent = diverted.toLocaleString();
    $('#flow-walk').textContent = `${(event.averageWalk / 60).toFixed(1)}m`;
    $('#flow-queue').textContent = `${(event.averageWait / 60).toFixed(1)}m`;
    $('#flow-blocked').textContent = blocked.toLocaleString();
    const max = Math.max(1, ...Object.values(event.gateLoad));
    $('#flow-gates').innerHTML = Object.keys(GATES).map((gate) => `<div class="flow-gate ${flow.rules.closedGates?.includes(gate) ? 'closed' : ''}" title="${escapeHtml(GATES[gate].name)} synthetic visitor assignments"><span>${gate.toUpperCase()}</span><div class="flow-track"><i style="width:${event.gateLoad[gate] / max * 100}%"></i></div><b>${event.gateLoad[gate]}</b></div>`).join('');
    renderBarrierList();
  }

  function replan() {
    event = planEvent(baseEvent, flow.rules, getBarriers());
    buildMapPoints();
    flowMap.render(event, getBarriers(), flow.showPaths);
    renderFlow();
    renderPanel();
  }

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
    collection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
    points = event.groups.map((group) => collection.add({
      id: group.id,
      position: Cesium.Cartesian3.fromDegrees(group.path[0][0], group.path[0][1], 12),
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
    baseEvent = createSyntheticEvent({ kind, groupCount });
    baseline = planEvent(baseEvent);
    time = -35 * 60;
    playing = true;
    replan();
  }

  $('#sim-play').addEventListener('click', () => { playing = !playing; lastTick = performance.now(); renderPanel(); });
  $('#sim-reset').addEventListener('click', () => { time = -35 * 60; playing = true; updateMapPoints(); renderPanel(); });
  $('#sim-speed').addEventListener('change', () => { speed = Number($('#sim-speed').value); });
  $('#sim-kind').addEventListener('change', rebuild);
  $('#sim-groups').addEventListener('change', rebuild);
  $('#flow-template').addEventListener('change', () => {
    const template = TEMPLATES.find((item) => item.id === $('#flow-template').value);
    if (!template) { flow.templateId = 'custom'; saveFlow(); renderFlow(); return; }
    flow.templateId = template.id;
    flow.rules = structuredClone(template.rules);
    saveFlow();
    replan();
  });
  $('#flow-gate-rule').addEventListener('change', () => {
    flow.templateId = 'custom';
    flow.rules.gatePolicy = $('#flow-gate-rule').value;
    saveFlow();
    replan();
  });
  $('#flow-capacity').addEventListener('change', () => {
    flow.templateId = 'custom';
    flow.rules.capacity = Math.max(2, Math.min(60, Math.round(Number($('#flow-capacity').value) || 12)));
    saveFlow();
    replan();
  });
  $('#flow-avoid-steps').addEventListener('change', () => {
    flow.templateId = 'custom';
    flow.rules.avoidSteps = $('#flow-avoid-steps').checked;
    saveFlow();
    replan();
  });
  $('#flow-show-paths').addEventListener('change', () => {
    flow.showPaths = $('#flow-show-paths').checked;
    saveFlow();
    flowMap.render(event, getBarriers(), flow.showPaths);
  });
  $('#flow-auto-3d').addEventListener('change', () => {
    flow.auto3D = $('#flow-auto-3d').checked;
    saveFlow();
    last3D = !flow.auto3D;
    flowMap.set3D(flow.auto3D && (camera.key === 'venue3d' || viewer?.camera.positionCartographic.height < 400));
  });
  $('#barrier-place').addEventListener('click', () => {
    if (!viewer) { status('The map must load before you place a barrier.'); return; }
    setPlacing(!placing);
  });
  document.addEventListener('keydown', (key) => { if (key.key === 'Escape' && placing) setPlacing(false); });
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
    if (now - lastPanel >= 400) {
      renderPanel();
      if (viewer) {
        $('#building-status').dataset.cameraHeight = String(Math.round(viewer.camera.positionCartographic.height));
        const close = flow.auto3D && (camera.key === 'venue3d' || viewer.camera.positionCartographic.height < 400);
        if (close !== last3D) { flowMap.set3D(close); last3D = close; }
      }
      lastPanel = now;
    }
    requestAnimationFrame(tick);
  }
  renderFlow();
  renderPanel();
  requestAnimationFrame(tick);
  return { attachViewer(mapViewer) { viewer = mapViewer; flowMap.attach(viewer); buildMapPoints(); flowMap.render(event, getBarriers(), flow.showPaths); } };
}
