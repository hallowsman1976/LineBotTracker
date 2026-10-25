// In-memory RecurringStore for tests.
import type { RecurringIncome, RecurringStore } from '../src/recurring';

export function memRecurring(initial: (RecurringIncome & { userId: string })[] = []) {
  const rows = initial.map((r) => ({ ...r }));
  const store: RecurringStore = {
    list: (userId) => rows.filter((r) => r.userId === userId).map(({ userId: _u, ...r }) => r),
    add: (userId, rule) => void rows.push({ ...rule, userId }),
    update: (userId, rule) => {
      const row = rows.find((r) => r.userId === userId && r.id === rule.id);
      if (!row) return false;
      Object.assign(row, rule);
      return true;
    },
    remove: (userId, id) => {
      const i = rows.findIndex((r) => r.userId === userId && r.id === id);
      if (i < 0) return false;
      rows.splice(i, 1);
      return true;
    },
  };
  return { store, rows };
}
