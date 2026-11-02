import { REREGISTER_MS, reregisterDue } from '@/lib/pushDue';

describe('the push token registered again (Round 53 review)', () => {
  it('is due when this process never registered, and again after 6 hours, not before', () => {
    const t = Date.parse('2026-11-02T08:00:00Z');
    expect(reregisterDue(t, 0)).toBe(true);
    expect(reregisterDue(t, t - 60_000)).toBe(false);
    expect(reregisterDue(t, t - REREGISTER_MS + 1)).toBe(false);
    expect(reregisterDue(t, t - REREGISTER_MS)).toBe(true);
  });
});
