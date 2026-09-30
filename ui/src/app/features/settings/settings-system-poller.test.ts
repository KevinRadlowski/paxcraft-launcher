/**
 * SettingsSystemPoller — pure interval poller tests (fake timers).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DISK_POLL_INTERVAL_MS,
  SYSTEM_POLL_INTERVAL_MS,
  SettingsSystemPoller,
} from './settings-system-poller.js';

describe('SettingsSystemPoller', () => {
  it('start() fetches immediately then on interval', async () => {
    const calls: number[] = [];
    let now = 0;
    const timers = new Map<ReturnType<typeof setInterval>, { cb: () => void; ms: number }>();
    let timerId = 0;

    const poller = new SettingsSystemPoller({
      intervalMs: SYSTEM_POLL_INTERVAL_MS,
      fetch: async () => {
        calls.push(now);
        return { n: calls.length };
      },
      onSuccess: () => undefined,
      setIntervalFn: ((cb: () => void, ms: number) => {
        const id = (++timerId) as unknown as ReturnType<typeof setInterval>;
        timers.set(id, { cb, ms });
        return id;
      }) as typeof setInterval,
      clearIntervalFn: ((id: ReturnType<typeof setInterval>) => {
        timers.delete(id);
      }) as typeof clearInterval,
    });

    poller.start();
    await Promise.resolve();
    assert.equal(calls.length, 1);
    assert.equal(timers.size, 1);

    now = 5000;
    for (const t of timers.values()) t.cb();
    await Promise.resolve();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls, [0, 5000]);

    poller.stop();
    assert.equal(timers.size, 0);
    assert.equal(poller.isDisposed, true);
  });

  it('inFlight guard — no overlapping fetches', async () => {
    let resolveFetch!: (v: number) => void;
    let starts = 0;
    const poller = new SettingsSystemPoller({
      intervalMs: 1000,
      fetch: () => {
        starts++;
        return new Promise<number>((resolve) => {
          resolveFetch = resolve;
        });
      },
      onSuccess: () => undefined,
      setIntervalFn: ((cb: () => void) => {
        // stash for manual tick
        (poller as unknown as { _tick: () => void })._tick = cb;
        return 1 as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval,
      clearIntervalFn: (() => undefined) as typeof clearInterval,
    });

    poller.start();
    assert.equal(starts, 1);
    // second while in flight
    void poller.manualRefresh();
    assert.equal(starts, 1);
    resolveFetch!(1);
    await Promise.resolve();
    await Promise.resolve();
    void poller.manualRefresh();
    assert.equal(starts, 2);
    resolveFetch!(2);
    await Promise.resolve();
    poller.stop();
  });

  it('stop() prevents further success delivery', async () => {
    let resolveFetch!: (v: string) => void;
    const successes: string[] = [];
    const poller = new SettingsSystemPoller({
      intervalMs: 5000,
      fetch: () =>
        new Promise<string>((resolve) => {
          resolveFetch = resolve;
        }),
      onSuccess: (v) => successes.push(v),
      setIntervalFn: (() => 1 as unknown as ReturnType<typeof setInterval>) as typeof setInterval,
      clearIntervalFn: (() => undefined) as typeof clearInterval,
    });
    poller.start();
    poller.stop();
    resolveFetch!('late');
    await Promise.resolve();
    assert.deepEqual(successes, []);
  });

  it('failure calls onError and does not invent success (caller keeps lastGood)', async () => {
    const errors: unknown[] = [];
    const successes: number[] = [];
    let fail = false;
    const poller = new SettingsSystemPoller({
      intervalMs: 5000,
      fetch: async () => {
        if (fail) throw new Error('boom');
        return 42;
      },
      onSuccess: (v) => successes.push(v),
      onError: (e) => errors.push(e),
      setIntervalFn: (() => 1 as unknown as ReturnType<typeof setInterval>) as typeof setInterval,
      clearIntervalFn: (() => undefined) as typeof clearInterval,
    });
    poller.start();
    await Promise.resolve();
    assert.deepEqual(successes, [42]);
    fail = true;
    await poller.manualRefresh();
    assert.equal(errors.length, 1);
    assert.deepEqual(successes, [42]);
    poller.stop();
  });

  it('exports SYSTEM_POLL_INTERVAL_MS = 5000', () => {
    assert.equal(SYSTEM_POLL_INTERVAL_MS, 5000);
  });

  it('exports DISK_POLL_INTERVAL_MS = 60000', () => {
    assert.equal(DISK_POLL_INTERVAL_MS, 60_000);
  });
});
