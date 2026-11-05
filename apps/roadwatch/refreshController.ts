// Refresh bookkeeping for RoadWatch, kept free of React so it can be tested directly.
//
// Every effect run attaches as its own "consumer" and owns the requests it starts.
// Only the active consumer's requests can change what is shown, and a result is
// applied only if it is newer than the last applied one. An effect restart
// therefore never waits on, or gets overwritten by, a request from an earlier run.

export type RefreshSnapshot<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
};

export type RefreshController<T> = {
  /** Starts a new consumer and makes it the only one whose results are shown. */
  attach(): number;
  /** Ends a consumer. Its pending requests can no longer change the snapshot. */
  detach(consumer: number): void;
  /** Starts a request for the consumer unless it is inactive or already has one pending. */
  refresh(consumer: number): Promise<void>;
  snapshot(): RefreshSnapshot<T>;
};

export const initialRefreshSnapshot: RefreshSnapshot<never> = { data: null, loading: false, error: null, lastUpdated: null };

export function createRefreshController<T>(
  load: () => Promise<T>,
  onChange: (snapshot: RefreshSnapshot<T>) => void,
  now: () => Date = () => new Date(),
): RefreshController<T> {
  let activeConsumer = 0;
  let lastConsumer = 0;
  let lastRequest = 0;
  let appliedRequest = 0;
  const pending = new Map<number, number>(); // request id -> owning consumer
  let current: RefreshSnapshot<T> = { data: null, loading: false, error: null, lastUpdated: null };

  const activeHasPending = () => activeConsumer !== 0 && [...pending.values()].includes(activeConsumer);

  const publish = (changes: Partial<RefreshSnapshot<T>> = {}) => {
    const next = { ...current, ...changes, loading: activeHasPending() };
    if (next.data === current.data && next.loading === current.loading && next.error === current.error && next.lastUpdated === current.lastUpdated) return;
    current = next;
    onChange(current);
  };

  return {
    attach() {
      activeConsumer = ++lastConsumer;
      publish();
      return activeConsumer;
    },
    detach(consumer) {
      if (consumer !== activeConsumer) return;
      activeConsumer = 0;
      publish();
    },
    async refresh(consumer) {
      if (consumer === 0 || consumer !== activeConsumer) return;
      if ([...pending.values()].includes(consumer)) return;
      const request = ++lastRequest;
      pending.set(request, consumer);
      publish({ error: null });
      let outcome: { ok: true; value: T } | { ok: false; error: string };
      try {
        outcome = { ok: true, value: await load() };
      } catch (reason) {
        outcome = { ok: false, error: String(reason) };
      }
      pending.delete(request);
      const owned = consumer === activeConsumer && request > appliedRequest;
      if (!owned) {
        publish();
        return;
      }
      appliedRequest = request;
      publish(outcome.ok ? { data: outcome.value, lastUpdated: now() } : { error: outcome.error });
    },
    snapshot() {
      return current;
    },
  };
}
