/**
 * PauseController - manages pausing/resuming of indexing operations
 *
 * Used to temporarily pause indexing during high-priority MCP requests
 * to ensure responsive tool handling.
 */
export class PauseController {
    paused = false;
    resumePromise = null;
    resumeResolve = null;
    pendingRequestCount = 0;
    /**
     * Request a pause - increments pending count and sets paused state
     */
    pause() {
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
    resume() {
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
    async shouldYield() {
        if (this.paused && this.resumePromise) {
            await this.resumePromise;
        }
    }
    /**
     * Check if currently paused
     */
    isPaused() {
        return this.paused;
    }
}
