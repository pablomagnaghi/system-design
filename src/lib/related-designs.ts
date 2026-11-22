/**
 * The other designs, starting with the one right after `currentSlug` and wrapping
 * around, so the carousel on each page opens on "what comes next" instead of
 * always showing the first designs in the list.
 */
export function relatedAfter<T extends { slug: string }>(
  items: readonly T[],
  currentSlug: string,
): T[] {
  const index = items.findIndex((item) => item.slug === currentSlug);
  if (index === -1) return [...items];
  return [...items.slice(index + 1), ...items.slice(0, index)];
}

/**
 * Keeps a scroll offset inside one copy of a looping strip. The carousel renders its cards twice, so an
 * offset past the first copy (or before it) shows exactly the same cards once wrapped into [0, loop).
 */
export function wrapOffset(offset: number, loop: number): number {
  if (loop <= 0) return 0;
  return ((offset % loop) + loop) % loop;
}

/** Share of a card (0 to 1) that lies inside the visible window, used to fade and shrink cards at the edges. */
export function visibleFraction(
  start: number,
  end: number,
  viewStart: number,
  viewEnd: number,
): number {
  const width = end - start;
  if (width <= 0) return 0;
  const inside = Math.min(end, viewEnd) - Math.max(start, viewStart);
  return Math.min(1, Math.max(0, inside / width));
}

/** Ease-out cubic: fast start, gentle stop, so an arrow press moves at once and settles softly. */
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);
