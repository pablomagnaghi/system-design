import type { PacketKind, Walkthrough, WalkthroughStage } from '../content/types';
import { edgeKey } from './walkthrough-layout';

/**
 * Node ids and edge keys on screen at a stage. A node shows from its `appearsAt` stage on, so
 * the design grows as the story goes; the intro (stage -1) shows what the first stage shows.
 * An edge shows once both of its ends do.
 */
export function visibleAt(walkthrough: Walkthrough, stage: number) {
  const at = Math.max(stage, 0);
  const nodes = new Set(
    walkthrough.nodes.filter((node) => (node.appearsAt ?? 0) <= at).map((node) => node.id),
  );
  const edges = new Set(
    walkthrough.edges.filter(([from, to]) => nodes.has(from) && nodes.has(to)).map(edgeKey),
  );
  return { nodes, edges };
}

export interface Packet {
  readonly edge: readonly [from: string, to: string];
  readonly kind: PacketKind;
}

/** What moves during a stage: plain requests along `travel`, then the stage's extra `traffic`. */
export function packetsFor(stage: WalkthroughStage | undefined): Packet[] {
  if (!stage) return [];
  const requests = stage.travel.map(([from, to]): Packet => ({
    edge: [from, to],
    kind: 'request',
  }));
  return [...requests, ...(stage.traffic ?? [])];
}

const LEGEND: readonly (readonly [PacketKind, string])[] = [
  ['request', 'request'],
  ['heavy', 'heavy request'],
  ['health', 'health check'],
  ['failed', 'failed request'],
];

/**
 * Legend entries for the kinds a walkthrough uses. Empty when it only moves plain requests,
 * because a legend with a single entry explains nothing.
 */
export function legendFor(stages: readonly WalkthroughStage[]) {
  const kinds = new Set(stages.flatMap((stage) => packetsFor(stage).map((p) => p.kind)));
  if (kinds.size <= 1) return [];
  return LEGEND.filter(([kind]) => kinds.has(kind)).map(([kind, label]) => ({ kind, label }));
}

/** Most dots a packet stream shows, spread evenly along the edge so the stream reads as traffic. */
export const DOTS_PER_PACKET = 3;

/** Diagram units each dot needs along an edge; shorter edges get fewer dots so they never pile up. */
const UNITS_PER_DOT = 70;

/** How many dots a stream shows on an edge of this length: one to DOTS_PER_PACKET. */
export function dotsForLength(length: number): number {
  return Math.min(DOTS_PER_PACKET, Math.max(1, Math.floor(length / UNITS_PER_DOT)));
}

/**
 * Each packet's offset, as a fraction of the spacing between its dots, so two streams on the
 * same edge (a request and a health check, say) interleave instead of drawing on top of each other.
 */
export function streamOffsets(packets: readonly Packet[]): number[] {
  const totals = new Map<string, number>();
  for (const packet of packets) {
    const key = edgeKey(packet.edge);
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return packets.map((packet) => {
    const key = edgeKey(packet.edge);
    const ordinal = seen.get(key) ?? 0;
    seen.set(key, ordinal + 1);
    return ordinal / (totals.get(key) ?? 1);
  });
}

/**
 * Where a dot is along its edge (0 to 1) after `elapsed` ms. The `count` dots of a stream loop
 * evenly spaced, shifted by `offset` of that spacing. A failed request never arrives: it stops
 * short of the target.
 */
export function dotProgress(
  elapsed: number,
  index: number,
  kind: PacketKind,
  travelMs: number,
  count = DOTS_PER_PACKET,
  offset = 0,
) {
  const loop = (elapsed / travelMs + (index + offset) / count) % 1;
  return kind === 'failed' ? loop * 0.8 : loop;
}
