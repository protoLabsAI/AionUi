/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ProcessConfig so we can control systemMaxConcurrency in tests
vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: {
    get: vi.fn(async () => undefined), // default: returns undefined → DEFAULT_MAX_CONCURRENCY (10)
  },
}));

import { GlobalAgentSemaphore } from '../../src/process/services/cron/GlobalAgentSemaphore';
import { ProcessConfig } from '@process/utils/initStorage';

function setCap(cap: number | undefined) {
  vi.mocked(ProcessConfig.get).mockResolvedValue(cap as never);
}

/** Flush microtask queue + one timer tick so async drain() can complete. */
async function flush() {
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

describe('GlobalAgentSemaphore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCap(undefined);
  });

  it('allows up to the cap concurrently and queues the rest', async () => {
    setCap(2);
    const sem = new GlobalAgentSemaphore();

    const release1 = await sem.acquire();
    const release2 = await sem.acquire();

    expect(sem.getActiveCount()).toBe(2);
    expect(sem.getQueueLength()).toBe(0);

    // Third acquire should block — it must not resolve until a slot opens
    let thirdResolved = false;
    let release3!: () => void;
    const p3 = sem.acquire().then((r) => {
      thirdResolved = true;
      release3 = r;
    });

    await Promise.resolve();
    expect(thirdResolved).toBe(false);
    expect(sem.getQueueLength()).toBe(1);

    // Free one slot — the queued acquire should resolve
    release1();
    await flush();
    await p3;

    expect(thirdResolved).toBe(true);
    expect(sem.getActiveCount()).toBe(2);
    expect(sem.getQueueLength()).toBe(0);

    release2();
    release3();
    expect(sem.getActiveCount()).toBe(0);
  });

  it('uses DEFAULT_MAX_CONCURRENCY (10) when config returns undefined', async () => {
    setCap(undefined);
    const sem = new GlobalAgentSemaphore();

    // Acquire 10 slots — all should succeed immediately
    const releases: Array<() => void> = [];
    for (let i = 0; i < 10; i++) {
      releases.push(await sem.acquire());
    }
    expect(sem.getActiveCount()).toBe(10);

    // 11th should queue
    let eleventhResolved = false;
    let release11!: () => void;
    const p11 = sem.acquire().then((r) => {
      eleventhResolved = true;
      release11 = r;
    });

    await Promise.resolve();
    expect(eleventhResolved).toBe(false);
    expect(sem.getQueueLength()).toBe(1);

    // Release one slot — drain() is async, needs a timer tick
    releases[0]();
    await flush();
    await p11;

    expect(eleventhResolved).toBe(true);
    expect(sem.getQueueLength()).toBe(0);

    for (const r of releases.slice(1)) r();
    release11();
    expect(sem.getActiveCount()).toBe(0);
  });

  it('release is idempotent — calling release twice does not decrement count twice', async () => {
    setCap(1);
    const sem = new GlobalAgentSemaphore();
    const release = await sem.acquire();
    expect(sem.getActiveCount()).toBe(1);

    release();
    release(); // second call should be a no-op
    expect(sem.getActiveCount()).toBe(0);
  });

  it('releases the slot on error path so queued jobs can proceed', async () => {
    // This mirrors the WorkerTaskManagerJobExecutor error path:
    // when getOrBuildTask throws, releaseSemaphore() is called so the queue drains.
    setCap(1);
    const sem = new GlobalAgentSemaphore();

    const firstRelease = await sem.acquire(); // occupy the single slot

    let queuedResolved = false;
    let queuedRelease!: () => void;
    const queued = sem.acquire().then((r) => {
      queuedResolved = true;
      queuedRelease = r;
    });

    await Promise.resolve();
    expect(queuedResolved).toBe(false);

    // Simulate error-path release
    firstRelease();
    await flush();
    await queued;

    expect(queuedResolved).toBe(true);
    queuedRelease();
    expect(sem.getActiveCount()).toBe(0);
  });

  it('enforces global cap across multiple concurrent acquires', async () => {
    const CAP = 3;
    setCap(CAP);
    const sem = new GlobalAgentSemaphore();

    const completedIndices: number[] = [];
    const acquiredReleases: Array<() => void> = [];

    // Launch 6 concurrent acquires; only CAP should start immediately
    const promises = Array.from({ length: 6 }, (_, i) =>
      sem.acquire().then((r) => {
        completedIndices.push(i);
        acquiredReleases.push(r);
      })
    );

    // Wait for immediate slots to fill
    await Promise.resolve();
    await Promise.resolve();

    expect(completedIndices.length).toBe(CAP);
    expect(sem.getActiveCount()).toBe(CAP);
    expect(sem.getQueueLength()).toBe(6 - CAP);

    // Release all current holders — queued ones should proceed
    const toRelease = acquiredReleases.splice(0, CAP);
    for (const r of toRelease) r();

    await flush();
    await Promise.all(promises);

    expect(completedIndices.length).toBe(6);
    expect(sem.getActiveCount()).toBe(6 - CAP); // 3 unreleased slots remain

    for (const r of acquiredReleases) r();
    expect(sem.getActiveCount()).toBe(0);
  });
});
