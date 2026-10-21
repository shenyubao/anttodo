export type SaveQueueState =
  | { status: "idle" | "saved" | "saving" }
  | { status: "error"; error: Error };

export class SerialSaveQueue<T> {
  private latest: T;
  private saved: T;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | null = null;
  private stopped = false;

  constructor(
    initialValue: T,
    private readonly save: (value: T) => Promise<void>,
    private readonly onState: (state: SaveQueueState) => void,
    private readonly delay = 500,
  ) {
    this.latest = initialValue;
    this.saved = initialValue;
  }

  acceptExternal(value: T) {
    if (this.inFlight || !Object.is(this.latest, this.saved)) return false;
    this.latest = value;
    this.saved = value;
    return true;
  }

  schedule(value: T) {
    if (this.stopped) return;
    this.latest = value;
    if (Object.is(this.latest, this.saved)) {
      this.clearTimer();
      this.onState({ status: "saved" });
      return;
    }

    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.persist().catch(() => undefined);
    }, this.delay);
  }

  async flush() {
    if (this.stopped) return;
    this.clearTimer();
    await this.persist();
  }

  retry() {
    return this.flush();
  }

  stop({ flush = false } = {}) {
    if (flush && !this.stopped) void this.flush().catch(() => undefined);
    this.stopped = true;
    this.clearTimer();
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async persist(): Promise<void> {
    if (this.stopped || Object.is(this.latest, this.saved)) return;
    if (this.inFlight) {
      await this.inFlight;
      return this.persist();
    }

    const value = this.latest;
    this.onState({ status: "saving" });
    this.inFlight = this.save(value)
      .then(() => {
        this.saved = value;
        this.onState({ status: "saved" });
      })
      .catch((reason: unknown) => {
        const error = reason instanceof Error ? reason : new Error("保存失败");
        this.onState({ status: "error", error });
        throw error;
      })
      .finally(() => {
        this.inFlight = null;
      });

    await this.inFlight;
    if (!Object.is(this.latest, this.saved)) await this.persist();
  }
}
