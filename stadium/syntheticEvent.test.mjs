import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyntheticEvent, eventSnapshot, groupAt, formatEventTime } from './syntheticEvent.js';

test('the same scenario generates the same event and distinct group records', () => {
  const first = createSyntheticEvent({ groupCount: 280 });
  const again = createSyntheticEvent({ groupCount: 280 });
  assert.deepEqual(first, again);
  assert.equal(first.groups.length, 280);
  assert.equal(new Set(first.groups.map((group) => group.id)).size, 280);
  assert.ok(first.transactions.length > first.groups.length);
  assert.ok(first.transactions.every((item) => item.source === 'Synthetic'));
});

test('visitors and transactions advance through the event timeline', () => {
  const event = createSyntheticEvent();
  const before = eventSnapshot(event, -90 * 60);
  const middle = eventSnapshot(event, -35 * 60);
  const after = eventSnapshot(event, 90 * 60);
  assert.equal(before.transactions.length, 0);
  assert.equal(before.admitted, 0);
  assert.ok(middle.transactions.length > 0);
  assert.ok(after.transactions.length > middle.transactions.length);
  assert.equal(after.admitted, event.people);
  assert.equal(after.transactions.length, event.transactions.length);
  assert.ok(after.spend >= middle.spend);
  assert.ok(event.groups.some((group) => groupAt(group, -35 * 60).position));
  assert.equal(formatEventTime(-35 * 60), 'T-35:00');
});

test('interior visitor movement stays around the playing field', () => {
  const event = createSyntheticEvent();
  for (const group of event.groups) {
    for (const minutesAfterArrival of [19, 21, 23, 25, 35]) {
      const { position } = groupAt(group, group.arrival + minutesAfterArrival * 60);
      const radius = Math.hypot((position[0] + 73.84578) / .00068, (position[1] - 40.75703) / .00052);
      assert.ok(radius >= 1.1, `${group.id} entered the playing field`);
    }
  }
});
