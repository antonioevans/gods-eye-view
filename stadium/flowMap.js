import * as Cesium from 'cesium';
import { BUILDINGS, GATES, NETWORK_EDGES, NETWORK_NODES, ORIGINS, nearestEdge, nearestNode } from './pathNetwork.js';

const color = (value, alpha = 1) => Cesium.Color.fromCssColorString(value).withAlpha(alpha);

export function createFlowMap({ onPlace, onMove, onSelect, onAction, onDragStart, describe }) {
  let viewer;
  let lines;
  let nodePoints;
  let markers = [];
  let buildings = [];
  let osmBuildings;
  let requestedOsm = false;
  let placeMode = false;
  let active3D = false;
  let selected = null;
  let dragging = null;
  let ignoreClickUntil = 0;
  let currentEvent;

  function clearMarkers() {
    if (!viewer) return;
    markers.forEach((entity) => viewer.entities.remove(entity));
    markers = [];
  }

  function render(event, barriers, showPaths, rules = {}) {
    if (!viewer) return;
    currentEvent = event;
    if (lines) viewer.scene.primitives.remove(lines);
    if (nodePoints) viewer.scene.primitives.remove(nodePoints);
    clearMarkers();
    lines = viewer.scene.primitives.add(new Cesium.PolylineCollection());
    const active = barriers.filter((barrier) => !barrier.archived);
    const barrierByEdge = new Map(active.map((barrier) => [barrier.edgeId, barrier]));
    if (showPaths) for (const edge of NETWORK_EDGES) {
      const flow = event.flow?.get(edge.id) || 0;
      const barrier = barrierByEdge.get(edge.id);
      const tint = barrier ? barrier.color : flow > 175 ? '#b17af8' : flow > 60 ? '#f7b45a' : flow > 0 ? '#48dfd1' : '#8aa1b4';
      const opacity = barrier ? .96 : flow ? .73 : .20;
      lines.add({ id: { type: 'path', id: edge.id }, positions: Cesium.Cartesian3.fromDegreesArrayHeights([edge.a[0], edge.a[1], 10, edge.b[0], edge.b[1], 10]), width: barrier ? 8 : flow > 60 ? 3 : flow ? 2 : 1, material: Cesium.Material.fromType('Color', { color: color(tint, opacity) }) });
    }
    if (showPaths) {
      const nodes = new Map();
      for (const edge of NETWORK_EDGES) for (const id of [edge.from, edge.to]) {
        const current = nodes.get(id) || { degree: 0, flow: 0 };
        current.degree += 1;
        current.flow += event.flow?.get(edge.id) || 0;
        nodes.set(id, current);
      }
      nodePoints = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
      for (const [id, current] of nodes) {
        if (current.degree < 3 || !current.flow) continue;
        const position = NETWORK_NODES[id];
        nodePoints.add({ id: { type: 'junction', id }, position: Cesium.Cartesian3.fromDegrees(position[0], position[1], 13), color: color(current.flow > 250 ? '#b17af8' : current.flow > 90 ? '#f7b45a' : '#48dfd1', .95), outlineColor: color('#091423'), outlineWidth: 1, pixelSize: current.flow > 180 ? 7 : 5, disableDepthTestDistance: Number.POSITIVE_INFINITY });
      }
    }
    for (const [gate, item] of Object.entries(GATES)) {
      const position = NETWORK_NODES[rules.gateNodes?.[gate] || item.node];
      markers.push(viewer.entities.add({ id: `flow-gate-${gate}`, position: Cesium.Cartesian3.fromDegrees(position[0], position[1], 15), point: { pixelSize: 16, color: color('#edc878'), outlineColor: color('#091423'), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY }, label: { text: gate.toUpperCase(), font: '700 10px IBM Plex Mono', fillColor: Cesium.Color.WHITE, outlineColor: color('#091423'), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -24), disableDepthTestDistance: Number.POSITIVE_INFINITY } }));
    }
    for (const [origin, node] of Object.entries(ORIGINS)) {
      const position = NETWORK_NODES[rules.originNodes?.[origin] || node];
      markers.push(viewer.entities.add({ id: `flow-origin-${origin}`, position: Cesium.Cartesian3.fromDegrees(position[0], position[1], 15), point: { pixelSize: 14, color: color('#72cdf8'), outlineColor: color('#091423'), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY }, label: { text: `${origin.toUpperCase()} START`, font: '700 9px IBM Plex Mono', fillColor: Cesium.Color.WHITE, outlineColor: color('#091423'), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -23), disableDepthTestDistance: Number.POSITIVE_INFINITY } }));
    }
    for (const barrier of active) {
      const position = barrier.position;
      markers.push(viewer.entities.add({ id: `flow-barrier-${barrier.id}`, position: Cesium.Cartesian3.fromDegrees(position[0], position[1], 17), point: { pixelSize: 17, color: color(barrier.color), outlineColor: color('#091423'), outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY }, label: { text: '×', font: '700 17px IBM Plex Mono', fillColor: Cesium.Color.WHITE, outlineColor: color('#091423'), outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -2), disableDepthTestDistance: Number.POSITIVE_INFINITY } }));
    }
    viewer.scene.requestRender();
  }

  function setPlaceMode(enabled) {
    placeMode = enabled;
    if (enabled) select(null);
    document.querySelector('.map-shell').classList.toggle('placing-barrier', enabled);
  }

  function mapPosition(screen) {
    const cartesian = viewer.camera.pickEllipsoid(screen, viewer.scene.globe.ellipsoid);
    if (!cartesian) return null;
    const point = Cesium.Cartographic.fromCartesian(cartesian);
    return [Cesium.Math.toDegrees(point.longitude), Cesium.Math.toDegrees(point.latitude)];
  }

  function pickedItem(screen, includeNearbyPath = false) {
    const candidates = [];
    for (const picked of viewer.scene.drillPick(screen, 8)) {
      const value = picked?.id instanceof Cesium.Entity ? picked.id.id : picked?.id ?? picked?.primitive?.id;
      if (value && typeof value === 'object' && value.type) candidates.push({ descriptor: value, picked });
      if (typeof value === 'string') {
        const prefixes = [['zone-', 'zone'], ['flow-gate-', 'gate'], ['flow-origin-', 'origin'], ['flow-barrier-', 'barrier'], ['flow-building-', 'building']];
        const prefix = prefixes.find(([text]) => value.startsWith(text));
        if (prefix) candidates.push({ descriptor: { type: prefix[1], id: value.slice(prefix[0].length) }, picked });
      }
    }
    const priority = { zone: 1, barrier: 1, gate: 1, origin: 1, group: 2, path: 3, junction: 4, building: 5 };
    candidates.sort((a, b) => (priority[a.descriptor.type] || 9) - (priority[b.descriptor.type] || 9));
    if (candidates.length) return candidates[0];
    if (includeNearbyPath) {
      const position = mapPosition(screen);
      const match = position && nearestEdge(position);
      if (match?.distance <= 8) return { descriptor: { type: 'path', id: match.edge.id }, picked: null };
    }
    return null;
  }

  function select(descriptor) {
    selected = descriptor;
    const panel = document.querySelector('#map-inspector');
    const info = descriptor && describe(descriptor, currentEvent);
    panel.hidden = !info;
    if (!info) return;
    document.querySelector('#map-item-name').textContent = info.title;
    document.querySelector('#map-item-detail').textContent = `${info.kind} · ${info.detail}${info.draggable ? ' · Drag or click a new location to move' : ''}`;
    const actions = document.querySelector('#map-item-actions');
    actions.replaceChildren();
    for (const action of info.actions || []) {
      const button = document.createElement('button');
      button.className = 'quiet-button';
      button.textContent = action.label;
      button.title = action.title || action.label;
      button.addEventListener('click', () => onAction(action.id, descriptor));
      actions.append(button);
    }
    onSelect?.(descriptor);
  }

  function destination(descriptor, position) {
    if (!position) return null;
    if (descriptor.type === 'zone') return { position };
    if (descriptor.type === 'barrier') {
      const match = nearestEdge(position);
      return match?.distance <= 45 ? { position: match.position, edgeId: match.edge.id } : null;
    }
    const match = nearestNode(position);
    return match?.distance <= 60 ? { position: match.position, nodeId: match.id } : null;
  }

  function previewPosition(target, position) {
    if (!target || !position) return;
    const height = target.descriptor.type === 'zone' ? 35 : target.descriptor.type === 'barrier' ? 17 : 15;
    const cartesian = Cesium.Cartesian3.fromDegrees(position[0], position[1], height);
    if (target.picked?.id instanceof Cesium.Entity) target.picked.id.position = cartesian;
    else if (target.picked?.primitive?.position) target.picked.primitive.position = cartesian;
    viewer.scene.requestRender();
  }

  function addLocalBuildings() {
    if (buildings.length || !viewer) return;
    for (const footprint of BUILDINGS) {
      const illustrative = footprint.kind === 'grandstand';
      if (!footprint.height && !illustrative) continue;
      const height = footprint.height || 18;
      const flat = footprint.coordinates.flat();
      if (flat.length < 8) continue;
      buildings.push(viewer.entities.add({ id: `flow-building-${footprint.id}`, polygon: { hierarchy: Cesium.Cartesian3.fromDegreesArray(flat), height: 0, extrudedHeight: height, material: color(illustrative ? '#6aa9d8' : '#8c9bac', illustrative ? .38 : .60), outline: true, outlineColor: color('#b1d3e9', .72), show: true } }));
    }
  }

  async function enableOsmBuildings() {
    if (requestedOsm || !viewer) return;
    requestedOsm = true;
    try {
      osmBuildings = await Cesium.createOsmBuildingsAsync();
      viewer.scene.primitives.add(osmBuildings);
      osmBuildings.show = true;
      if (active3D) document.querySelector('#building-status').textContent = '3D: OSM buildings + illustrative venue';
    } catch {
      if (active3D) document.querySelector('#building-status').textContent = '3D: mapped heights + illustrative venue';
    }
  }

  function set3D(enabled) {
    if (!viewer) return;
    active3D = enabled;
    if (enabled) addLocalBuildings();
    buildings.forEach((entity) => { entity.show = enabled; });
    if (osmBuildings) osmBuildings.show = enabled;
    if (enabled) {
      document.querySelector('#building-status').textContent = osmBuildings ? '3D: OSM buildings + illustrative venue' : '3D: mapped heights + illustrative venue';
      enableOsmBuildings();
    }
    else document.querySelector('#building-status').textContent = '3D ready at close range';
  }

  function attach(mapViewer) {
    viewer = mapViewer;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    handler.setInputAction((movement) => {
      if (Date.now() < ignoreClickUntil) return;
      const position = mapPosition(movement.position);
      if (placeMode) {
        const match = position && nearestEdge(position);
        onPlace(match && match.distance <= 30 ? match : null);
        return;
      }
      if (selected && describe(selected, currentEvent)?.draggable) {
        const direct = pickedItem(movement.position);
        if (direct?.descriptor.type === selected.type && direct.descriptor.id === selected.id) return;
        onMove(selected, destination(selected, position));
        select(null);
        return;
      }
      const hit = pickedItem(movement.position, true);
      if (hit) { select(hit.descriptor); return; }
      select(null);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction((movement) => {
      if (placeMode) return;
      const hit = pickedItem(movement.position);
      if (hit && describe(hit.descriptor, currentEvent)?.draggable) dragging = { ...hit, start: movement.position, moved: false };
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);
    handler.setInputAction((movement) => {
      const tooltip = document.querySelector('#map-tooltip');
      if (dragging) {
        const distance = Cesium.Cartesian2.distance(dragging.start, movement.endPosition);
        if (!dragging.moved && distance > 4) {
          dragging.moved = true;
          viewer.scene.screenSpaceCameraController.enableInputs = false;
          onDragStart?.(dragging.descriptor);
        }
        if (dragging.moved) {
          const target = destination(dragging.descriptor, mapPosition(movement.endPosition));
          previewPosition(dragging, target?.position);
          tooltip.hidden = true;
          return;
        }
      }
      const hit = pickedItem(movement.endPosition, true);
      const info = hit && describe(hit.descriptor, currentEvent);
      tooltip.hidden = !info;
      if (!info) return;
      tooltip.textContent = `${info.title} · ${info.kind}${info.draggable ? ' · drag to move' : ''}`;
      tooltip.style.left = `${Math.min(movement.endPosition.x + 14, viewer.canvas.clientWidth - 250)}px`;
      tooltip.style.top = `${Math.max(8, movement.endPosition.y - 38)}px`;
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    handler.setInputAction((movement) => {
      if (!dragging) return;
      const current = dragging;
      dragging = null;
      viewer.scene.screenSpaceCameraController.enableInputs = true;
      if (!current.moved) return;
      ignoreClickUntil = Date.now() + 250;
      onMove(current.descriptor, destination(current.descriptor, mapPosition(movement.position)));
      select(null);
    }, Cesium.ScreenSpaceEventType.LEFT_UP);
    document.querySelector('#map-inspector-close').addEventListener('click', () => select(null));
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') select(null); });
  }

  return { attach, render, setPlaceMode, set3D, select };
}
