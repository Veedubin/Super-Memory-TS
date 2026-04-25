/**
 * PauseController - manages pausing/resuming of indexing operations
 * 
 * Used to temporarily pause indexing during high-priority MCP requests
 * to ensure responsive tool handling.
 */

export class PauseController {
  private paused: boolean = false;
  private resumePromise: Promise<void> | null = null;
  private resumeResolve: (() => void) | null = null;
  private pendingRequestCount: number = 0;

  /**
   * Request a pause - increments pending count and sets paused state
   */
  pause(): void {
    this.pendingRequestCount++;
    if (!this.paused) {
      this.paused = true;
      this.resumePromise = new Promise((resolve) => {
        this.resumeResolve = resolve;
      });
    }
  }

  /**
   * Release a pause - decrements pending count and resumes when zero
   */
  resume(): void {
    this.pendingRequestCount = Math.max(0, this.pendingRequestCount - 1);
    if (this.pendingRequestCount === 0 && this.paused) {
      this.paused = false;
      this.resumeResolve?.();
      this.resumeResolve = null;
      this.resumePromise = null;
    }
  }

  /**
   * Yield to event loop if paused - awaits resume signal
   */
  async shouldYield(): Promise<void> {
    if (this.paused && this.resumePromise) {
      await this.resumePromise;
    }
  }

  /**
   * Check if currently paused
   */
  isPaused(): boolean {
    return this.paused;
  }
}