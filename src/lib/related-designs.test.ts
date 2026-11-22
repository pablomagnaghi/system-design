import { describe, expect, it } from 'vitest';
import { designs } from '../content';
import { easeOutCubic, relatedAfter, visibleFraction, wrapOffset } from './related-designs';

const items = ['a', 'b', 'c', 'd'].map((slug) => ({ slug }));
const slugs = (list: { slug: string }[]) => list.map((item) => item.slug);

describe('relatedAfter', () => {
  it('starts after the current item and wraps around', () => {
    expect(slugs(relatedAfter(items, 'b'))).toEqual(['c', 'd', 'a']);
  });

  it('handles the first and the last item', () => {
    expect(slugs(relatedAfter(items, 'a'))).toEqual(['b', 'c', 'd']);
    expect(slugs(relatedAfter(items, 'd'))).toEqual(['a', 'b', 'c']);
  });

  it('returns everything when the slug is unknown', () => {
    expect(slugs(relatedAfter(items, 'zzz'))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('lists every other design exactly once for every real design', () => {
    for (const design of designs) {
      const related = slugs(relatedAfter(designs, design.slug));
      expect(related).toHaveLength(designs.length - 1);
      expect(new Set(related).size).toBe(designs.length - 1);
      expect(related).not.toContain(design.slug);
    }
  });
});

describe('wrapOffset', () => {
  it('keeps an offset inside one copy of the strip', () => {
    expect(wrapOffset(120, 1000)).toBe(120);
    expect(wrapOffset(1000, 1000)).toBe(0);
    expect(wrapOffset(1250, 1000)).toBe(250);
  });

  it('wraps a negative offset to the end of the copy', () => {
    expect(wrapOffset(-100, 1000)).toBe(900);
  });

  it('returns zero when there is nothing to loop', () => {
    expect(wrapOffset(500, 0)).toBe(0);
  });
});

describe('visibleFraction', () => {
  it('is 1 for a card fully inside, 0 outside, and partial at an edge', () => {
    expect(visibleFraction(100, 300, 0, 1000)).toBe(1);
    expect(visibleFraction(1100, 1300, 0, 1000)).toBe(0);
    expect(visibleFraction(900, 1100, 0, 1000)).toBe(0.5);
    expect(visibleFraction(-50, 150, 0, 1000)).toBe(0.75);
  });
});

describe('easeOutCubic', () => {
  it('starts at 0, ends at 1 and moves most of the way early', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.8);
    expect(easeOutCubic(2)).toBe(1);
  });
});
