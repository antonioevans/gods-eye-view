import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyntheticEvent, groupAt } from './syntheticEvent.js';
import { DEFAULT_RULES, GATES, NETWORK_EDGES, NETWORK_NODES, ORIGINS, gateBarrier, nearestEdge, nearestNode, planEvent } from './pathNetwork.js';

const base = createSyntheticEvent();

test('generated visitor routes stay on mapped pedestrian segments until the entry', () => {
  const planned = planEvent(base);
  const valid = new Set(NETWORK_EDGES.map((edge) => edge.id));
  assert.equal(planned.unreachable, 0);
  for (const group of planned.groups) {
    assert.ok(group.pathEdges.length > 0);
    assert.ok(group.pathEdges.every((edge) => valid.has(edge)));
    const midway = groupAt(group, group.pathStart + group.walkSeconds / 2);
    assert.equal(midway.stage, 'approaching');
    assert.ok(midway.edgeId && group.pathEdges.includes(midway.edgeId));
    assert.ok(nearestEdge(midway.position).distance < 1);
  }
});

test('closing a perimeter entry diverts visitors and changes walk and queue time', () => {
  const open = planEvent(base);
  const westClosed = planEvent(base, { ...DEFAULT_RULES, closedGates: ['west'] }, [gateBarrier('west')]);
  assert.equal(westClosed.gateLoad.west, 0);
  assert.equal(westClosed.unreachable, 0);
  assert.ok(westClosed.averageWalk > open.averageWalk);
  assert.ok(westClosed.averageWait > open.averageWait);
  assert.ok(westClosed.groups.some((group) => group.gateId !== open.groups.find((entry) => entry.id === group.id).gateId));
});

test('a placed segment closure is excluded from every route', () => {
  const original = planEvent(base);
  const segment = original.groups.find((group) => group.route === 'west').pathEdges[0];
  const edge = NETWORK_EDGES.find((item) => item.id === segment);
  const blocked = planEvent(base, DEFAULT_RULES, [{ id: 'test', edgeId: segment, kind: 'closed', position: edge.a, color: '#ff0000' }]);
  assert.ok(blocked.groups.every((group) => !group.pathEdges?.includes(segment)));
  assert.ok(blocked.groups.some((group) => group.unreachable || group.pathDistance !== original.groups.find((item) => item.id === group.id).pathDistance));
  assert.deepEqual(nearestEdge(NETWORK_NODES[edge.from]).position, NETWORK_NODES[edge.from]);
});

test('a slowdown increases travel time without inventing off-network movement', () => {
  const open = planEvent(base);
  const segment = open.groups.find((group) => group.route === 'west').pathEdges[2];
  const edge = NETWORK_EDGES.find((item) => item.id === segment);
  const slowed = planEvent(base, DEFAULT_RULES, [{ id: 'slow', edgeId: segment, kind: 'slow', position: edge.a, color: '#cc44aa' }]);
  assert.equal(slowed.unreachable, 0);
  assert.ok(slowed.averageWalk > open.averageWalk);
  assert.ok(slowed.groups.some((group) => group.pathEdges.includes(segment) && group.walkSeconds > open.groups.find((entry) => entry.id === group.id).walkSeconds));
});

test('street route templates and dragged markers recalculate mapped paths', () => {
  const westToSouth = planEvent(base, { ...DEFAULT_RULES, routeTemplateId: 'west-south' });
  assert.ok(westToSouth.groups.filter((group) => group.route === 'west').every((group) => group.gateId === 'south'));
  const moved = planEvent(base, { ...DEFAULT_RULES, originNodes: { west: ORIGINS.south }, gateNodes: { west: GATES.south.node }, groupStartNodes: { G001: ORIGINS.transit } });
  assert.deepEqual(moved.groups.find((group) => group.id === 'G001').path[0], NETWORK_NODES[ORIGINS.transit]);
  assert.ok(moved.groups.filter((group) => group.route === 'west' && group.id !== 'G001' && !group.unreachable).every((group) => group.path[0] === NETWORK_NODES[ORIGINS.south]));
  assert.equal(nearestNode(NETWORK_NODES[ORIGINS.transit]).id, ORIGINS.transit);
});
