// Simple promise-based mutex
export default class Mutex {
  private _locked = false;
  private _waiters: Array<() => void> = [];

  /**
   * Acquire the lock.
   * Resolves with a release function that MUST be called once the critical section is done.
   */
  async lock(): Promise<() => void> {
    if (!this._locked) {
      this._locked = true;
      return this._makeReleaser();
    }

    return new Promise<() => void>((resolve) => {
      this._waiters.push(() => {
        this._locked = true;
        resolve(this._makeReleaser());
      });
    });
  }

  private _makeReleaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this._locked = false;
      const next = this._waiters.shift();
      if (next) next();
    };
  }
}