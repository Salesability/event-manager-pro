import { describe, expect, it } from 'vitest';
import { QUICK_REPLIES } from './quick-replies';

// The chip contract (0110): bodies fill the reply box verbatim and ride the
// normal `replyToThread` path — so they must be send-ready standalone SMS
// text, not templates, and short enough to leave room for staff edits.

describe('QUICK_REPLIES', () => {
  it('is a curated non-empty set with unique labels and bodies', () => {
    expect(QUICK_REPLIES.length).toBeGreaterThanOrEqual(6);
    expect(new Set(QUICK_REPLIES.map((q) => q.label)).size).toBe(QUICK_REPLIES.length);
    expect(new Set(QUICK_REPLIES.map((q) => q.body)).size).toBe(QUICK_REPLIES.length);
  });

  it('bodies are send-ready single SMS texts', () => {
    for (const q of QUICK_REPLIES) {
      expect(q.label.trim()).toBe(q.label);
      expect(q.body.trim()).toBe(q.body);
      expect(q.label.length).toBeGreaterThan(0);
      expect(q.body.length).toBeGreaterThan(0);
      expect(q.body.length).toBeLessThanOrEqual(300);
      // Replies never run the launch template renderer — no variables.
      expect(q.body).not.toMatch(/\{\{/);
      // Single message: no newlines.
      expect(q.body).not.toContain('\n');
    }
  });
});
