/**
 * Counts things that happened recently, by key, to stop guessing and spamming.
 * Held in memory, so each server instance counts for itself (fine for one instance; see the roadmap for more).
 */
export class Limiter {
  private hits = new Map<string, number[]>();

  constructor(private now: () => number = Date.now) {}

  /** Count this attempt. Returns false once there have already been `max` within `windowMs`. */
  take(key: string, max: number, windowMs: number): boolean {
    const recent = this.recent(key, windowMs);
    if (recent.length >= max) return false;
    recent.push(this.now());
    this.hits.set(key, recent);
    this.sweep();
    return true;
  }

  /** How many have been counted within `windowMs`. */
  count(key: string, windowMs: number): number {
    return this.recent(key, windowMs).length;
  }

  /** Note one (for example a failed sign-in) without checking a limit. */
  strike(key: string, windowMs: number): void {
    const recent = this.recent(key, windowMs);
    recent.push(this.now());
    this.hits.set(key, recent);
    this.sweep();
  }

  private recent(key: string, windowMs: number): number[] {
    const t = this.now();
    return (this.hits.get(key) ?? []).filter((x) => t - x < windowMs);
  }

  /** Keep memory bounded: forget old keys, and if still huge, the oldest half. */
  private sweep(): void {
    if (this.hits.size <= 5000) return;
    const t = this.now();
    for (const [key, list] of this.hits) {
      if (!list.length || t - list[list.length - 1]! > 3_600_000) this.hits.delete(key);
    }
    let excess = this.hits.size - 2500;
    for (const key of this.hits.keys()) {
      if (excess-- <= 0) break;
      this.hits.delete(key);
    }
  }

  /** How many keys are being tracked (for tests). */
  get size(): number {
    return this.hits.size;
  }
}
