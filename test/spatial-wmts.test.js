import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWmtsTimeFrames, selectGibsDay } from '../src/spatial/wmts-parse.js';

test('parseWmtsTimeFrames extracts ISO times from capabilities XML', () => {
  const xml = `
    <Layer><Identifier>sea_water_velocity</Identifier>
    <Dimension name="time">2026-08-05T00:00:00.000Z,2026-08-05T06:00:00.000Z</Dimension>
    </Layer>`;
  const frames = parseWmtsTimeFrames(xml, 'sea_water_velocity');
  assert.equal(frames.length, 2);
  assert.match(frames[0], /2026-08-05T00:00:00/);
});

test('selectGibsDay returns newest and fallback candidates', () => {
  const days = selectGibsDay(['2026-08-01', '2026-08-03', '2026-08-05'], 2);
  assert.equal(days[0], '2026-08-05');
  assert.equal(days.length, 3);
});
