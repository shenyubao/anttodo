const FIVE_MINUTES = 5 * 60 * 1000;

export function createReminderScheduler({ now = () => Date.now(), schedule = setTimeout, cancel = clearTimeout, show }) {
  const timers = new Map();
  const entries = new Map();
  const shown = new Set();
  const acknowledged = new Set();

  function cancelTimer(id) {
    const timer = timers.get(id);
    if (timer !== undefined) cancel(timer);
    timers.delete(id);
  }

  function fire(entry) {
    cancelTimer(entry.id);
    if (shown.has(entry.id) || acknowledged.has(entry.reminderId)) return;
    shown.add(entry.id);
    show(entry, () => acknowledge(entry.reminderId));
  }

  function arm(entry, allowRecovery = false) {
    cancelTimer(entry.id);
    if (shown.has(entry.id) || acknowledged.has(entry.reminderId)) return;
    const delay = new Date(entry.triggerAt).getTime() - now();
    if (!Number.isFinite(delay)) return;
    if (delay <= 0) {
      if (allowRecovery && delay >= -FIVE_MINUTES) fire(entry);
      return;
    }
    timers.set(entry.id, schedule(() => fire(entry), delay));
  }

  function sync(nextEntries, allowRecovery = true) {
    const ids = new Set(nextEntries.map((entry) => entry.id));
    for (const id of entries.keys()) {
      if (!ids.has(id)) {
        cancelTimer(id);
        entries.delete(id);
      }
    }
    for (const entry of nextEntries) {
      entries.set(entry.id, entry);
      arm(entry, allowRecovery);
    }
  }

  function acknowledge(reminderId) {
    acknowledged.add(reminderId);
    for (const [id, entry] of entries) {
      if (entry.reminderId === reminderId) cancelTimer(id);
    }
  }

  function resume() {
    for (const entry of entries.values()) arm(entry, true);
  }

  function dispose() {
    for (const id of timers.keys()) cancelTimer(id);
    entries.clear();
  }

  return { sync, acknowledge, resume, dispose };
}
