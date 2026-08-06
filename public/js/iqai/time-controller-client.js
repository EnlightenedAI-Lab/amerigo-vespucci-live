/**
 * Browser TimeController (mirrors server spatial/time-controller.js).
 */
export class TimeController {
  constructor() {
    this.frames = [];
    this.index = 0;
    this.playing = false;
    this._timer = null;
    this.validTime = null;
    this.modelRun = null;
    this.retrievalTime = null;
  }

  setFrames(isoTimes, target = null) {
    const parsed = (isoTimes || [])
      .map((t) => new Date(t))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => a - b);
    this.frames = parsed;
    this.retrievalTime = new Date().toISOString();
    if (!parsed.length) {
      this.index = 0;
      this.validTime = null;
      return;
    }
    const targetDate = target ? new Date(target) : parsed[parsed.length - 1];
    this.index = this.nearestIndex(targetDate);
    this.validTime = parsed[this.index]?.toISOString() || null;
  }

  nearestIndex(targetDate) {
    if (!this.frames.length) return 0;
    const t = targetDate.getTime();
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < this.frames.length; i++) {
      const diff = Math.abs(this.frames[i].getTime() - t);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    }
    return best;
  }

  step(delta) {
    if (!this.frames.length) return null;
    this.index = Math.max(0, Math.min(this.frames.length - 1, this.index + delta));
    this.validTime = this.frames[this.index].toISOString();
    return this.validTime;
  }

  play(intervalMs, onTick) {
    this.stop();
    this.playing = true;
    this._timer = setInterval(() => {
      if (this.index >= this.frames.length - 1) {
        this.stop();
        return;
      }
      this.step(1);
      onTick?.(this.validTime);
    }, intervalMs);
  }

  stop() {
    this.playing = false;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
}
