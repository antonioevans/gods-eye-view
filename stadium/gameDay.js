import * as Cesium from 'cesium';
import { createSyntheticEvent, eventSnapshot, formatEventTime, groupAt, VIEWPOINTS } from './syntheticEvent.js';
import { BUILDINGS, DEFAULT_RULES, GATES, NETWORK_EDGES, NETWORK_NODES, ORIGINS, ROUTE_TEMPLATES, TEMPLATES, gateBarrier, planEvent } from './pathNetwork.js';
import { createFlowMap } from './flowMap.js';
import { decodeScenario, publicScenarioUrl } from './shareState.js';

const $ = (selector) => document.querySelector(selector);
const money = (amount) => `$${amount.toLocaleString('en-US', { minimumFractionDigits: amount % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const FLOW_STORAGE = 'noble-citi-field-flow-v1';
const MODE_STORAGE = 'noble-citi-field-mode-v1';
const sharedScenario = decodeScenario(location.search);
const validEdges = new Set(NETWORK_EDGES.map((edge) => edge.id));
function nodeMap(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(([, id]) => typeof id === 'string' && NETWORK_NODES[id]));
}
function normalizeFlow(saved) {
  if (!saved || typeof saved !== 'object') return null;
  const rules = saved.rules || {};
  return {
    templateId: TEMPLATES.some((item) => item.id === saved.templateId) ? saved.templateId : 'custom',
    rules: {
      ...DEFAULT_RULES,
      gatePolicy: ['nearest', 'balanced', 'west', 'south', 'east'].includes(rules.gatePolicy) ? rules.gatePolicy : 'nearest',
      capacity: Math.max(2, Math.min(60, Math.round(Number(rules.capacity) || 12))),
      avoidSteps: rules.avoidSteps !== false,
      closedGates: Array.isArray(rules.closedGates) ? rules.closedGates.filter((gate) => Object.hasOwn(GATES, gate)) : [],
      routeTemplateId: ROUTE_TEMPLATES.some((item) => item.id === rules.routeTemplateId) ? rules.routeTemplateId : 'nearest',
      originNodes: nodeMap(rules.originNodes), gateNodes: nodeMap(rules.gateNodes), groupStartNodes: nodeMap(rules.groupStartNodes),
    },
    barriers: Array.isArray(saved.barriers) ? saved.barriers.slice(0, 100).filter((item) => item && validEdges.has(item.edgeId)).map((item, index) => ({
      id: typeof item.id === 'string' ? item.id.slice(0, 50) : `barrier-${index}`,
      name: typeof item.name === 'string' ? item.name.slice(0, 40) : `Barrier ${index + 1}`,
      edgeId: item.edgeId, position: Array.isArray(item.position) && item.position.length === 2 && item.position.every(Number.isFinite) && item.position[0] > -73.87 && item.position[0] < -73.83 && item.position[1] > 40.74 && item.position[1] < 40.77 ? item.position : NETWORK_EDGES.find((edge) => edge.id === item.edgeId)?.a,
      kind: item.kind === 'slow' ? 'slow' : 'closed', color: /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : '#ef5b5b', archived: item.archived === true,
    })) : [],
    showPaths: saved.showPaths !== false, auto3D: saved.auto3D !== false,
  };
}
function loadFlow() {
  try {
    const saved = sharedScenario?.flow || JSON.parse(localStorage.getItem(FLOW_STORAGE));
    const normalized = normalizeFlow(saved);
    if (normalized) return normalized;
  } catch { /* Use the default flow when browser storage is unavailable. */ }
  return { templateId: 'open', rules: structuredClone(DEFAULT_RULES), barriers: [], showPaths: true, auto3D: true };
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

export function createGameDay({ getZones = () => [], getZone = () => null, moveZone = () => {}, editZone = () => {} } = {}) {
  const initialKind = sharedScenario?.kind === 'show' ? 'show' : 'game';
  const initialGroups = Math.max(50, Math.min(500, Math.round(Number(sharedScenario?.groups) || 280)));
  let baseEvent = createSyntheticEvent({ kind: initialKind, groupCount: initialGroups });
  let baseline = planEvent(baseEvent);
  let flow = loadFlow();
  let event = planEvent(baseEvent, flow.rules, getBarriers());
  let time = Number.isFinite(sharedScenario?.time) ? Math.max(-5400, Math.min(5400, sharedScenario.time)) : -35 * 60;
  let playing = true;
  let speed = 4;
  let sortKey = 'time';
  let sortDirection = -1;
  let filter = 'all';
  let viewer;
  let collection;
  let points = [];
  let placing = false;
  let draggingGroup = null;
  let mode = sharedScenario?.mode === 'advanced' || sharedScenario?.mode === 'simple' ? sharedScenario.mode : localStorage.getItem(MODE_STORAGE) === 'advanced' ? 'advanced' : 'simple';
  let last3D = false;
  let camera = { ...VIEWPOINTS.overview };
  let lastTick = performance.now();
  let lastPanel = 0;
  const flowMap = createFlowMap({
    onPlace(match) {
      if (!placing) return;
      if (!match) { status('Click within 30 m of a mapped pedestrian path.'); return; }
      addBarrier(match, $('#barrier-kind').value);
    },
    onMove(descriptor, destination) {
      draggingGroup = null;
      if (!destination) { status('Move the marker onto a mapped path or junction.'); replan(); return; }
      if (descriptor.type === 'zone') { moveZone(descriptor.id, destination.position); status('Zone moved.'); return; }
      if (descriptor.type === 'barrier') {
        const barrier = flow.barriers.find((item) => item.id === descriptor.id && !item.archived);
        if (!barrier) return;
        barrier.position = destination.position;
        barrier.edgeId = destination.edgeId;
      } else if (descriptor.type === 'gate') flow.rules.gateNodes[descriptor.id] = destination.nodeId;
      else if (descriptor.type === 'origin') flow.rules.originNodes[descriptor.id] = destination.nodeId;
      else if (descriptor.type === 'group') flow.rules.groupStartNodes[descriptor.id] = destination.nodeId;
      else return;
      saveFlow(); replan(); status(`${describe({ type: descriptor.type, id: descriptor.id }).title} moved to a mapped path.`);
    },
    onDragStart(descriptor) { if (descriptor.type === 'group') { draggingGroup = descriptor.id; playing = false; renderPanel(); } },
    onSelect() {},
    onAction(action, descriptor) {
      if (action === 'block' || action === 'slow') {
        const edge = NETWORK_EDGES.find((item) => item.id === descriptor.id);
        if (!edge) return;
        addBarrier({ edge, position: [(edge.a[0] + edge.b[0]) / 2, (edge.a[1] + edge.b[1]) / 2] }, action === 'block' ? 'closed' : 'slow');
      } else if (action === 'archive') {
        const barrier = flow.barriers.find((item) => item.id === descriptor.id);
        if (barrier) { barrier.archived = true; saveFlow(); replan(); status(`${barrier.name} archived.`); flowMap.select(null); }
      } else if (action === 'edit-zone') editZone(descriptor.id);
      else if (action === 'reset') {
        if (descriptor.type === 'gate') delete flow.rules.gateNodes[descriptor.id];
        if (descriptor.type === 'origin') delete flow.rules.originNodes[descriptor.id];
        if (descriptor.type === 'group') delete flow.rules.groupStartNodes[descriptor.id];
        saveFlow(); replan(); status('Marker returned to its original mapped location.');
      }
    },
    describe,
  });

  function addBarrier(match, kind) {
    const previous = new Map(event.groups.map((group) => [group.id, { gate: group.gateId, path: group.pathEdges?.join(','), walk: group.walkSeconds }]));
    flow.barriers.push({ id: crypto.randomUUID(), name: `Barrier ${flow.barriers.length + 1}`, edgeId: match.edge.id, position: match.position, kind, color: $('#barrier-color').value, archived: false });
    setPlacing(false);
    saveFlow();
    replan();
    const affected = event.groups.reduce((sum, group) => {
      const before = previous.get(group.id);
      return sum + (before && (before.gate !== group.gateId || before.path !== group.pathEdges?.join(',') || before.walk !== group.walkSeconds) ? group.party : 0);
    }, 0);
    status(affected ? `Barrier placed. ${affected} visitors affected.` : 'Barrier placed. No current visitor route uses that segment.');
  }

  function getBarriers() {
    return [...flow.barriers, ...(flow.rules.closedGates || []).map((gate) => gateBarrier(gate, flow.rules.gateNodes[gate] || GATES[gate].node)).filter(Boolean)];
  }
  function saveFlow() { localStorage.setItem(FLOW_STORAGE, JSON.stringify(flow)); }
  function status(message) {
    for (const selector of ['#barrier-status', '#simple-status']) { $(selector).hidden = !message; $(selector).textContent = message; }
  }
  function setMode(value) {
    mode = value;
    document.body.dataset.mode = value;
    $('#mode-toggle').textContent = value === 'simple' ? 'Advanced mode' : 'Simple mode';
    $('#mode-toggle').title = value === 'simple' ? 'Show every simulation control' : 'Show the easy play controls';
    localStorage.setItem(MODE_STORAGE, value);
  }
  function describe(descriptor) {
    const { type, id } = descriptor;
    if (type === 'zone') {
      const zone = getZone(id);
      return zone && !zone.archived ? { title: zone.name, kind: 'Demo zone', detail: 'Editable location', draggable: true, actions: [{ id: 'edit-zone', label: 'Edit zone' }] } : null;
    }
    if (type === 'barrier') {
      const barrier = getBarriers().find((item) => item.id === id && !item.archived);
      return barrier ? { title: barrier.name, kind: 'Barrier', detail: barrier.kind === 'slow' ? 'Slows visitors on this path' : 'Closes this path', draggable: !barrier.template, actions: barrier.template ? [] : [{ id: 'archive', label: 'Archive barrier' }] } : null;
    }
    if (type === 'gate' && GATES[id]) return { title: GATES[id].name, kind: 'Simulated entry', detail: `${event.gateLoad[id] || 0} visitors assigned`, draggable: true, actions: [{ id: 'reset', label: 'Reset location' }] };
    if (type === 'origin' && ORIGINS[id]) return { title: `${id[0].toUpperCase()}${id.slice(1)} start`, kind: 'Visitor start', detail: 'Drag to a mapped path junction', draggable: true, actions: [{ id: 'reset', label: 'Reset location' }] };
    if (type === 'group') {
      const group = event.groups.find((item) => item.id === id);
      return group ? { title: `Group ${id}`, kind: 'Synthetic visitors', detail: `${group.party} people · ${groupAt(group, time).stage} · ${group.gateId ? GATES[group.gateId].name : 'No route'}`, draggable: true, actions: [{ id: 'reset', label: 'Reset start' }] } : null;
    }
    if (type === 'path') {
      const edge = NETWORK_EDGES.find((item) => item.id === id);
      return edge ? { title: edge.name || edge.kind.replaceAll('_', ' '), kind: 'Mapped path', detail: `${Math.round(edge.distance)} m · ${event.flow.get(id) || 0} synthetic visitors`, draggable: false, actions: [{ id: 'block', label: 'Block path' }, { id: 'slow', label: 'Slow path' }] } : null;
    }
    if (type === 'junction' && NETWORK_NODES[id]) return { title: 'Path junction', kind: 'Mapped path', detail: 'Connected street or walkway point', draggable: false };
    if (type === 'building') {
      const building = BUILDINGS.find((item) => item.id === id);
      return building ? { title: building.kind === 'grandstand' ? 'Citi Field grandstand' : building.name || 'Mapped building', kind: '3D shape', detail: building.kind === 'grandstand' ? 'Illustrative height' : `${building.height} m mapped height`, draggable: false } : null;
    }
    return null;
  }
  function setPlacing(value) {
    placing = value;
    flowMap.setPlaceMode(value);
    $('#barrier-place').classList.toggle('placing', value);
    $('#barrier-place').textContent = value ? 'Cancel placement' : 'Place on map';
    $('#simple-barrier').classList.toggle('placing', value);
    $('#simple-barrier').textContent = value ? 'Cancel barrier' : 'Add barrier';
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
    $('#simple-scenario').value = flow.templateId;
    $('#simple-route').value = flow.rules.routeTemplateId;
    $('#flow-route-template').value = flow.rules.routeTemplateId;
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
    $('#simple-diverted').textContent = diverted.toLocaleString();
    $('#simple-walk').textContent = `${(event.averageWalk / 60).toFixed(1)}m`;
    $('#simple-queue').textContent = `${(event.averageWait / 60).toFixed(1)}m`;
    $('#simple-blocked').textContent = blocked.toLocaleString();
    const max = Math.max(1, ...Object.values(event.gateLoad));
    $('#flow-gates').innerHTML = Object.keys(GATES).map((gate) => `<div class="flow-gate ${flow.rules.closedGates?.includes(gate) ? 'closed' : ''}" title="${escapeHtml(GATES[gate].name)} synthetic visitor assignments"><span>${gate.toUpperCase()}</span><div class="flow-track"><i style="width:${event.gateLoad[gate] / max * 100}%"></i></div><b>${event.gateLoad[gate]}</b></div>`).join('');
    renderBarrierList();
  }

  function replan() {
    event = planEvent(baseEvent, flow.rules, getBarriers());
    buildMapPoints();
    flowMap.render(event, getBarriers(), flow.showPaths, flow.rules);
    renderFlow();
    renderPanel();
  }

  function renderPanel() {
    const snapshot = eventSnapshot(event, time);
    $('#sim-clock').textContent = formatEventTime(time);
    $('#sim-scrubber').value = String(Math.round(time / 30) * 30);
    $('#simple-scrubber').value = String(Math.round(time / 30) * 30);
    $('#sim-play').textContent = playing ? 'Pause' : 'Play';
    $('#simple-play').textContent = playing ? 'Pause' : 'Play';
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
      id: { type: 'group', id: group.id },
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
      if (draggingGroup === group.id) return;
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

  const togglePlaying = () => { playing = !playing; lastTick = performance.now(); renderPanel(); };
  $('#sim-play').addEventListener('click', togglePlaying);
  $('#simple-play').addEventListener('click', togglePlaying);
  $('#sim-reset').addEventListener('click', () => { time = -35 * 60; playing = true; updateMapPoints(); renderPanel(); });
  $('#sim-speed').addEventListener('change', () => { speed = Number($('#sim-speed').value); });
  $('#sim-kind').addEventListener('change', rebuild);
  $('#sim-groups').addEventListener('change', rebuild);
  function applyTemplate(id) {
    const template = TEMPLATES.find((item) => item.id === id);
    if (!template) { flow.templateId = 'custom'; saveFlow(); renderFlow(); return; }
    flow.templateId = template.id;
    flow.rules = { ...structuredClone(template.rules), routeTemplateId: flow.rules.routeTemplateId, originNodes: flow.rules.originNodes, gateNodes: flow.rules.gateNodes, groupStartNodes: flow.rules.groupStartNodes };
    saveFlow();
    replan();
  }
  $('#flow-template').addEventListener('change', () => applyTemplate($('#flow-template').value));
  $('#simple-scenario').addEventListener('change', () => applyTemplate($('#simple-scenario').value));
  function applyRouteTemplate(id) {
    flow.rules.routeTemplateId = id;
    saveFlow(); replan();
  }
  $('#simple-route').addEventListener('change', () => applyRouteTemplate($('#simple-route').value));
  $('#flow-route-template').addEventListener('change', () => applyRouteTemplate($('#flow-route-template').value));
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
    flowMap.render(event, getBarriers(), flow.showPaths, flow.rules);
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
  $('#simple-barrier').addEventListener('click', () => {
    if (!viewer) { status('The map must load before you place a barrier.'); return; }
    $('#barrier-kind').value = 'closed';
    setPlacing(!placing);
  });
  document.addEventListener('keydown', (key) => { if (key.key === 'Escape' && placing) setPlacing(false); });
  for (const selector of ['#sim-scrubber', '#simple-scrubber']) $(selector).addEventListener('input', () => { time = Number($(selector).value); updateMapPoints(); renderPanel(); });
  $('#tx-filter').addEventListener('change', () => { filter = $('#tx-filter').value; renderPanel(); });
  document.querySelectorAll('[data-sort]').forEach((button) => button.addEventListener('click', () => {
    if (sortKey === button.dataset.sort) sortDirection *= -1;
    else { sortKey = button.dataset.sort; sortDirection = button.dataset.sort === 'time' ? -1 : 1; }
    renderPanel();
  }));
  document.querySelectorAll('[data-camera]').forEach((button) => button.addEventListener('click', () => flyTo({ ...VIEWPOINTS[button.dataset.camera], key: button.dataset.camera })));
  $('#simple-3d').addEventListener('click', () => flyTo({ ...VIEWPOINTS.venue3d, key: 'venue3d' }));
  $('#mode-toggle').addEventListener('click', () => setMode(mode === 'simple' ? 'advanced' : 'simple'));
  $('#share-demo').addEventListener('click', () => {
    const link = publicScenarioUrl({ flow, zones: getZones(), kind: $('#sim-kind').value, groups: Number($('#sim-groups').value), time, mode });
    $('#share-url').value = link;
    $('#share-feedback').hidden = true;
    $('#share-dialog').showModal();
  });
  $('#copy-share').addEventListener('click', async () => {
    const link = $('#share-url').value;
    try { await navigator.clipboard.writeText(link); $('#share-feedback').textContent = 'Link copied.'; }
    catch { $('#share-url').focus(); $('#share-url').select(); $('#share-feedback').textContent = 'Select the link and copy it.'; }
    $('#share-feedback').hidden = false;
  });
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
  $('#sim-kind').value = initialKind;
  $('#sim-groups').value = String(initialGroups);
  setMode(mode);
  renderFlow();
  renderPanel();
  requestAnimationFrame(tick);
  return { attachViewer(mapViewer) { viewer = mapViewer; flowMap.attach(viewer); buildMapPoints(); flowMap.render(event, getBarriers(), flow.showPaths, flow.rules); } };
}
