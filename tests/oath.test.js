/* The prayer oath: a real attempt must always count, a wrong word never must. */
import { describe, it, expect } from 'vitest';
import { isOath, normalizeArabic, OATH_AR } from '../src/core.jsx';

describe('isOath', () => {
  it('accepts the plain oath', () => {
    expect(isOath('والله')).toBe(true);
    expect(isOath(OATH_AR)).toBe(true);
  });
  it('accepts it with surrounding whitespace', () => {
    expect(isOath('  والله  ')).toBe(true);
  });
  it('accepts it with diacritics (harakat)', () => {
    expect(isOath('وَاللَّهِ')).toBe(true);
    expect(isOath('وَاللّٰهِ')).toBe(true);
  });
  it('accepts the ﷲ ligature form', () => {
    expect(isOath('و\uFDF2')).toBe(true);
  });
  it('accepts tatweel stretching', () => {
    expect(isOath('واللـــه')).toBe(true);
  });
  it('rejects the empty string', () => {
    expect(isOath('')).toBe(false);
    expect(isOath('   ')).toBe(false);
  });
  it('rejects other words, including near-misses', () => {
    expect(isOath('الله')).toBe(false);      // no waw
    expect(isOath('وال')).toBe(false);       // truncated
    expect(isOath('بالله')).toBe(false);     // different oath particle
    expect(isOath('wallah')).toBe(false);    // transliteration is not the oath
    expect(isOath('صلّيت')).toBe(false);
  });
  it('normalizeArabic folds alef variants', () => {
    expect(normalizeArabic('أ')).toBe('ا');
    expect(normalizeArabic('إ')).toBe('ا');
    expect(normalizeArabic('آ')).toBe('ا');
  });
});
