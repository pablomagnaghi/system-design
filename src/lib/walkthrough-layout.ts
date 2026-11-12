import type { WalkthroughEdge, WalkthroughNode } from '../content/types';

/** Diagram coordinates. The canvas scales, so everything is expressed in this space. */
export const VIEW = { width: 1000, height: 360 } as const;

const NODE = { width: 140, height: 76 } as const;
const COLUMN_STEP = 172;
const ROW_TOP: Record<WalkthroughNode['row'], number> = { top: 40, middle: 142, bottom: 244 };

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function nodeBox(node: Pick<WalkthroughNode, 'column' | 'row'>): Box {
  return { x: node.column * COLUMN_STEP, y: ROW_TOP[node.row], ...NODE };
}

/** Vertical spread between edges that leave the same side of a box, so they never overlap. */
const FAN_OFFSET = 14;

const centerX = (box: Box): number => box.x + box.width / 2;
const centerY = (box: Box): number => box.y + box.height / 2;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface EdgeGeometry {
  /** SVG path data. */
  readonly d: string;
  /** Halfway point along the curve, where an edge label sits. */
  readonly mid: Point;
}

/** A cubic Bezier from p0 to p3; its point at t = 0.5 is (p0 + 3p1 + 3p2 + p3) / 8. */
function cubic(p0: Point, p1: Point, p2: Point, p3: Point): EdgeGeometry {
  return {
    d: `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`,
    mid: { x: (p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8, y: (p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8 },
  };
}

function line(p0: Point, p1: Point): EdgeGeometry {
  return {
    d: `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y}`,
    mid: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 },
  };
}

/**
 * A smooth connector between two boxes, picking sides from their relative position:
 * forward (right edge to left edge), backward on the same row (left edge to right edge),
 * backward across rows (bottom or top edge to right edge) or vertical (same column).
 */
export function edgeGeometry(from: Box, to: Box): EdgeGeometry {
  if (to.x >= from.x + from.width) {
    const start = {
      x: from.x + from.width,
      y: centerY(from) + Math.sign(centerY(to) - centerY(from)) * FAN_OFFSET,
    };
    const end = { x: to.x, y: centerY(to) };
    const mid = start.x + (end.x - start.x) / 2;
    return cubic(start, { x: mid, y: start.y }, { x: mid, y: end.y }, end);
  }
  if (to.x + to.width <= from.x) {
    const end = { x: to.x + to.width, y: centerY(to) };
    if (centerY(to) === centerY(from)) return line({ x: from.x, y: centerY(from) }, end);
    const start = { x: centerX(from), y: to.y > from.y ? from.y + from.height : from.y };
    const corner = { x: start.x, y: end.y };
    return cubic(start, corner, corner, end);
  }
  const down = to.y > from.y;
  return line(
    { x: centerX(from), y: down ? from.y + from.height : from.y },
    { x: centerX(to), y: down ? to.y : to.y + to.height },
  );
}

export const edgePath = (from: Box, to: Box): string => edgeGeometry(from, to).d;

export const edgeKey = ([from, to]: WalkthroughEdge): string => `${from}>${to}`;

/** Converts diagram units to percentages so HTML boxes line up with the SVG. */
export const percentX = (value: number): string => `${(value / VIEW.width) * 100}%`;
export const percentY = (value: number): string => `${(value / VIEW.height) * 100}%`;
