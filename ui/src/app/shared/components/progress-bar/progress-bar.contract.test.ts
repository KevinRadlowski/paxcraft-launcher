import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PROGRESS_BAR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'progress-bar.component.ts',
);

test('progress fill has no lagging width transition (> telemetry cadence)', () => {
  const src = fs.readFileSync(PROGRESS_BAR, 'utf8');
  assert.match(src, /\[style\.width\.%\]/);
  assert.doesNotMatch(src, /transition:\s*width/);
  assert.doesNotMatch(src, /sc-duration-slow/);
  assert.doesNotMatch(src, /requestAnimationFrame|interpolat/i);
});

test('progress bar value binding is authoritative percent input only', () => {
  const src = fs.readFileSync(PROGRESS_BAR, 'utf8');
  assert.match(src, /readonly value = input\(0\)/);
  assert.match(src, /indeterminate\(\) \? 100 : value\(\)/);
});
