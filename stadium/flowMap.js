import * as Cesium from 'cesium';
import { BUILDINGS, GATES, NETWORK_EDGES, NETWORK_NODES, nearestEdge } from './pathNetwork.js';

const color = (value, alpha = 1) => Cesium.Color.fromCssColorString(value).withAlpha(alpha);

export function createFlowMap(onPlace) {
  let viewer;
  let lines;
  let nodePoints;
  let markers = [];
  let buildings = [];
  let osmBuildings;
  let requestedOsm = false;
  let placeMode = false;
  let active3D = false;

  function clearMarkers() {
    if (!viewer) return;
    markers.forEach((entity) => viewer.entities.remove(entity));
    markers = [];
  }

  function render(event, barriers, showPaths) {
    if (!viewer) return;
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
      lines.add({ positions: Cesium.Cartesian3.fromDegreesArrayHeights([edge.a[0], edge.a[1], 10, edge.b[0], edge.b[1], 10]), width: barrier ? 8 : flow > 60 ? 3 : flow ? 2 : 1, material: Cesium.Material.fromType('Color', { color: color(tint, opacity) }) });
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
        nodePoints.add({ position: Cesium.Cartesian3.fromDegrees(position[0], position[1], 13), color: color(current.flow > 250 ? '#b17af8' : current.flow > 90 ? '#f7b45a' : '#48dfd1', .95), outlineColor: color('#091423'), outlineWidth: 1, pixelSize: current.flow > 180 ? 7 : 5, disableDepthTestDistance: Number.POSITIVE_INFINITY });
      }
    }
    for (const [gate, item] of Object.entries(GATES)) {
      const position = NETWORK_NODES[item.node];
      markers.push(viewer.entities.add({ id: `flow-gate-${gate}`, position: Cesium.Cartesian3.fromDegrees(position[0], position[1], 15), point: { pixelSize: 11, color: color('#edc878'), outlineColor: color('#091423'), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY }, label: { text: gate.toUpperCase(), font: '700 10px IBM Plex Mono', fillColor: Cesium.Color.WHITE, outlineColor: color('#091423'), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -22), disableDepthTestDistance: Number.POSITIVE_INFINITY } }));
    }
    for (const barrier of active) {
      const position = barrier.position;
      markers.push(viewer.entities.add({ id: `flow-barrier-${barrier.id}`, position: Cesium.Cartesian3.fromDegrees(position[0], position[1], 17), point: { pixelSize: 17, color: color(barrier.color), outlineColor: color('#091423'), outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY }, label: { text: '×', font: '700 17px IBM Plex Mono', fillColor: Cesium.Color.WHITE, outlineColor: color('#091423'), outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -2), disableDepthTestDistance: Number.POSITIVE_INFINITY } }));
    }
    viewer.scene.requestRender();
  }

  function setPlaceMode(enabled) {
    placeMode = enabled;
    document.querySelector('.map-shell').classList.toggle('placing-barrier', enabled);
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
      if (!placeMode) return;
      const cartesian = viewer.camera.pickEllipsoid(movement.position, viewer.scene.globe.ellipsoid);
      if (!cartesian) return onPlace(null);
      const point = Cesium.Cartographic.fromCartesian(cartesian);
      const match = nearestEdge([Cesium.Math.toDegrees(point.longitude), Cesium.Math.toDegrees(point.latitude)]);
      onPlace(match && match.distance <= 30 ? match : null);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  return { attach, render, setPlaceMode, set3D };
}
