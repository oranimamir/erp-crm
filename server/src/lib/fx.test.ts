import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEurRate } from './fx.js';

test('EUR currency returns 1.0 immediately', async () => {
  const rate = await getEurRate('EUR', '2025-01-01');
  assert.strictEqual(rate, 1.0);
});

test('USD rate is a positive number', async () => {
  const rate = await getEurRate('USD', '2025-01-02');
  assert.ok(typeof rate === 'number', 'rate should be a number');
  assert.ok(rate > 0, 'rate should be positive');
});

test('fallback to 1.0 on bad currency', async () => {
  // 'XXX' is not a valid currency — Frankfurter will return an error
  const rate = await getEurRate('XXX', '2025-01-02');
  assert.strictEqual(rate, 1.0);
});
