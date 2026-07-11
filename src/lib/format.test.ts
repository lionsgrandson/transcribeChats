import { describe, expect, it } from 'vitest';
import { formatDuration, formatTimestamp, inferDirection } from './format';

describe('format helpers', () => {
  it('formats media durations and timestamps', () => {
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatTimestamp(125_000)).toBe('2:05');
  });

  it('detects Hebrew independently of the UI locale', () => {
    expect(inferDirection('דנה תשלח את הדוח by Friday')).toBe('rtl');
    expect(inferDirection('Dana will send the report')).toBe('ltr');
  });
});
