/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProcessConfig } from '@process/utils/initStorage';

/**
 * Default global cap on simultaneously active agent processes.
 * Matches the value documented in the systemMaxConcurrency setting description.
 */
const DEFAULT_MAX_CONCURRENCY = 10;

/**
 * Queued waiter — called when a slot opens up.
 */
type SlotResolver = () => void;

/**
 * GlobalAgentSemaphore enforces a hard upper bound on the total number of
 * concurrently active agent processes across all apps/conversations.
 *
 * When the cap (read from `system.systemMaxConcurrency`, default 10) is
 * reached, `acquire()` suspends the caller until a slot is freed, effectively
 * queueing new launches instead of dropping them.
 *
 * Usage:
 *   const release = await globalAgentSemaphore.acquire();
 *   // ... launch and run agent ...
 *   release(); // call when agent becomes idle
 */
export class GlobalAgentSemaphore {
  private activeCount = 0;
  private readonly queue: SlotResolver[] = [];

  /**
   * Acquire a semaphore slot.
   *
   * - Returns immediately if the active count is below the cap.
   * - Otherwise, suspends until another holder calls its release function.
   *
   * The returned function MUST be called exactly once when the agent is done.
   */
  async acquire(): Promise<() => void> {
    const max = await this.readMax();

    if (this.activeCount < max) {
      this.activeCount++;
      return this.makeRelease();
    }

    // Cap reached — suspend the caller until a slot is freed.
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.activeCount++;
        resolve(this.makeRelease());
      });
    });
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeCount--;
      void this.drain();
    };
  }

  /**
   * Process queued waiters after a slot is freed.
   * Reads the cap fresh each time so config changes take effect immediately.
   */
  private async drain(): Promise<void> {
    const max = await this.readMax();
    while (this.queue.length > 0 && this.activeCount < max) {
      const next = this.queue.shift()!;
      next();
    }
  }

  private async readMax(): Promise<number> {
    const val = await ProcessConfig.get('system.systemMaxConcurrency');
    return typeof val === 'number' && val > 0 ? val : DEFAULT_MAX_CONCURRENCY;
  }

  /** Returns the number of currently active agent slots (for testing / monitoring). */
  getActiveCount(): number {
    return this.activeCount;
  }

  /** Returns the number of launches waiting for a slot (for testing / monitoring). */
  getQueueLength(): number {
    return this.queue.length;
  }
}

/** Singleton used by WorkerTaskManagerJobExecutor. */
export const globalAgentSemaphore = new GlobalAgentSemaphore();
