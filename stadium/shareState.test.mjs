import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeScenario, encodeScenario } from './shareState.js';

test('scenario links round trip editable names and route state', () => {
  const scenario = { mode: 'simple', kind: 'game', groups: 280, zones: [{ id: 'west', name: 'West arrivée', lat: 40.757, lon: -73.847 }], flow: { rules: { routeTemplateId: 'west-south' }, barriers: [{ name: 'South closure', edgeId: 'sample:1' }] } };
  const link = `?scenario=${encodeScenario(scenario)}`;
  assert.deepEqual(decodeScenario(link), { version: 1, ...scenario });
  assert.equal(decodeScenario('?scenario=not-valid!'), null);
});
