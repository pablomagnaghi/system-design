import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { Walkthrough, WalkthroughStage } from '../content/types';
import {
  edgeGeometry,
  edgeKey,
  LANE_X,
  LANE_Y,
  nodeBox,
  percentX,
  percentY,
  VIEW,
} from '../lib/walkthrough-layout';
import { hasMetrics, loadLevel, metricItems } from '../lib/walkthrough-metrics';
import {
  DOTS_PER_PACKET,
  dotProgress,
  dotsForLength,
  legendFor,
  packetsFor,
  streamOffsets,
  visibleAt,
  type Packet,
} from '../lib/walkthrough-motion';
import { initPlayer, playerReducer, playLabel } from '../lib/walkthrough-player';
import styles from './Walkthrough.module.css';

interface Props {
  walkthrough: Walkthrough;
}

/** Time each stage stays on screen while playing, and how long a dot takes to travel. */
const STAGE_MS = 9000;
const TRAVEL_MS = 1600;

const DOT_CLASS: Record<Packet['kind'], string | undefined> = {
  request: styles.dotRequest,
  heavy: styles.dotHeavy,
  health: styles.dotHealth,
  failed: styles.dotFailed,
};

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Nodes and edges reached in any stage up to and including `index`. */
function reached(stages: readonly WalkthroughStage[], index: number) {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  for (const stage of stages.slice(0, index + 1)) {
    for (const id of stage.nodes) nodes.add(id);
    for (const edge of stage.travel) edges.add(edgeKey(edge));
  }
  return { nodes, edges };
}

export default function Walkthrough({ walkthrough }: Props) {
  const { nodes, edges, stages, lanes, label, intro } = walkthrough;
  const [state, dispatch] = useReducer(playerReducer, stages.length, initPlayer);
  const current = stages[state.stage];
  const svgRef = useRef<SVGSVGElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const dotRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const boxes = useMemo(() => new Map(nodes.map((node) => [node.id, nodeBox(node)])), [nodes]);
  const connectors = useMemo(
    () =>
      edges.flatMap((edge) => {
        const from = boxes.get(edge[0]);
        const to = boxes.get(edge[1]);
        if (!from || !to) return [];
        return [{ key: edgeKey(edge), label: edge[2], geometry: edgeGeometry(from, to) }];
      }),
    [edges, boxes],
  );
  const done = useMemo(() => reached(stages, state.stage - 1), [stages, state.stage]);
  const activeNodes = new Set(current?.nodes);
  const packets = useMemo(() => packetsFor(current), [current]);
  const activeEdges = new Set(packets.map((packet) => edgeKey(packet.edge)));
  const visible = useMemo(() => visibleAt(walkthrough, state.stage), [walkthrough, state.stage]);
  const legend = useMemo(() => legendFor(stages), [stages]);
  const showMetrics = useMemo(() => hasMetrics(stages), [stages]);
  const metrics = metricItems(current?.metrics, stages[state.stage - 1]?.metrics);
  const labelled = stages.some((stage) => stage.short);

  // Advance to the next stage while playing.
  useEffect(() => {
    if (!state.playing) return;
    const timer = window.setTimeout(() => dispatch({ type: 'tick' }), STAGE_MS);
    return () => window.clearTimeout(timer);
  }, [state.playing, state.stage]);

  // On narrow screens the canvas scrolls sideways: keep the active nodes in view.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !current || scroller.scrollWidth <= scroller.clientWidth) return;
    const active = current.nodes
      .map((id) => scroller.querySelector<HTMLElement>(`[data-node="${id}"]`))
      .filter((element): element is HTMLElement => element !== null);
    if (active.length === 0) return;
    const left = Math.min(...active.map((element) => element.offsetLeft));
    const right = Math.max(...active.map((element) => element.offsetLeft + element.offsetWidth));
    const target = (left + right) / 2 - scroller.clientWidth / 2;
    scroller.scrollTo({ left: target, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [current]);

  // Stream dots along every edge with traffic in this stage, looping until the stage changes.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || packets.length === 0) return;
    const paths = packets.map((packet) =>
      svg.querySelector<SVGPathElement>(`[data-edge="${edgeKey(packet.edge)}"]`),
    );
    const lengths = paths.map((path) => path?.getTotalLength() ?? 0);
    const offsets = streamOffsets(packets);
    const place = (elapsed: number) => {
      packets.forEach((packet, p) => {
        const path = paths[p];
        if (!path) return;
        const length = lengths[p] ?? 0;
        const count = dotsForLength(length);
        for (let d = 0; d < DOTS_PER_PACKET; d++) {
          const dot = dotRefs.current[p * DOTS_PER_PACKET + d];
          if (!dot) continue;
          // Short edges show fewer dots; the spare ones stay hidden.
          if (d >= count) {
            dot.style.opacity = '0';
            continue;
          }
          const progress = dotProgress(elapsed, d, packet.kind, TRAVEL_MS, count, offsets[p]);
          const point = path.getPointAtLength(length * progress);
          dot.style.left = percentX(point.x);
          dot.style.top = percentY(point.y);
          // A failed request fades out where it gives up.
          dot.style.opacity =
            packet.kind === 'failed' ? String(Math.min(1, (0.8 - progress) / 0.2)) : '1';
        }
      });
    };
    if (prefersReducedMotion()) {
      place(0);
      return;
    }
    let frame = 0;
    const startedAt = performance.now();
    const step = (now: number) => {
      place(now - startedAt);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [packets]);

  const nodeClass = (id: string): string => {
    const load = current?.load?.[id];
    return [
      styles.node,
      activeNodes.has(id) && styles.active,
      done.nodes.has(id) && styles.done,
      load !== undefined && loadLevel(load) === 'hot' && styles.hot,
    ]
      .filter(Boolean)
      .join(' ');
  };
  const edgeClass = (key: string): string =>
    [styles.edge, activeEdges.has(key) && styles.edgeActive, done.edges.has(key) && styles.edgeDone]
      .filter(Boolean)
      .join(' ');

  return (
    <figure className={styles.walkthrough} aria-label={label}>
      {showMetrics && (
        <dl className={styles.metrics} aria-label="System metrics">
          {metrics.length > 0 ? (
            metrics.map((metric) => (
              <div key={metric.key} className={styles[metric.status]} title={metric.hint}>
                <dt>{metric.label}</dt>
                <dd>{metric.value}</dd>
              </div>
            ))
          ) : (
            <div className={styles.normal}>
              <dt>Metrics</dt>
              <dd>Press play</dd>
            </div>
          )}
        </dl>
      )}
      <div ref={scrollerRef} className={styles.scroller}>
        <div className={styles.canvas} style={{ aspectRatio: `${VIEW.width} / ${VIEW.height}` }}>
          <svg
            ref={svgRef}
            className={styles.edges}
            viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {connectors.map(({ key, geometry }) =>
              visible.edges.has(key) ? (
                <path key={key} data-edge={key} d={geometry.d} className={edgeClass(key)} />
              ) : null,
            )}
          </svg>

          {connectors.map(({ key, label, geometry }) =>
            label && visible.edges.has(key) ? (
              <span
                key={`label-${key}`}
                className={[
                  styles.edgeLabel,
                  geometry.labelSide === 'right' ? styles.labelRight : styles.labelAbove,
                  activeEdges.has(key) && styles.edgeLabelActive,
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ left: percentX(geometry.mid.x), top: percentY(geometry.mid.y) }}
              >
                {label}
              </span>
            ) : null,
          )}

          {lanes?.top && (
            <span
              className={styles.lane}
              style={{ left: percentX(LANE_X), top: percentY(LANE_Y.top) }}
            >
              {lanes.top}
            </span>
          )}
          {lanes?.bottom && (
            <span
              className={styles.lane}
              style={{ left: percentX(LANE_X), top: percentY(LANE_Y.bottom) }}
            >
              {lanes.bottom}
            </span>
          )}

          {nodes.map((node) => {
            const box = boxes.get(node.id);
            if (!box || !visible.nodes.has(node.id)) return null;
            // Nodes that join later animate in, so the reader sees the design grow.
            const grows = (node.appearsAt ?? 0) > 0;
            return (
              <div
                key={node.id}
                data-node={node.id}
                className={[nodeClass(node.id), grows && styles.enter].filter(Boolean).join(' ')}
                style={{
                  left: percentX(box.x),
                  top: percentY(box.y),
                  width: percentX(box.width),
                  height: percentY(box.height),
                }}
              >
                <strong>{node.title}</strong>
                <span>{node.detail}</span>
                {current?.load?.[node.id] !== undefined && (
                  <LoadBar percent={current.load[node.id] ?? 0} />
                )}
              </div>
            );
          })}

          {packets.flatMap((packet, p) =>
            Array.from({ length: DOTS_PER_PACKET }, (_, d) => (
              <span
                key={`${state.stage}-${p}-${d}`}
                ref={(element) => {
                  dotRefs.current[p * DOTS_PER_PACKET + d] = element;
                }}
                className={[styles.dot, DOT_CLASS[packet.kind]].filter(Boolean).join(' ')}
                aria-hidden="true"
              />
            )),
          )}
        </div>
      </div>

      {legend.length > 0 && (
        <ul className={styles.legend} aria-label="Legend">
          {legend.map(({ kind, label: name }) => (
            <li key={kind}>
              <span
                className={[styles.swatch, DOT_CLASS[kind]].filter(Boolean).join(' ')}
                aria-hidden="true"
              />
              {name}
            </li>
          ))}
        </ul>
      )}

      <figcaption className={styles.panel}>
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.primary}
            onClick={() => dispatch({ type: state.playing ? 'pause' : 'play' })}
          >
            {state.playing ? '❚❚ ' : '▶ '}
            {playLabel(state, label)}
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: 'prev' })}
            disabled={state.stage <= 0}
            aria-label="Previous stage"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: 'next' })}
            disabled={state.stage >= state.last}
            aria-label="Next stage"
          >
            →
          </button>
          {!labelled && (
            <ol className={styles.steps} aria-label="Stages">
              {stages.map((stage, i) => (
                <li key={stage.title}>
                  <button
                    type="button"
                    className={i === state.stage ? styles.stepCurrent : undefined}
                    aria-current={i === state.stage ? 'step' : undefined}
                    aria-label={`Stage ${i + 1}: ${stage.title}`}
                    onClick={() => dispatch({ type: 'goto', stage: i })}
                  >
                    {i + 1}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>

        {labelled && (
          <ol className={styles.timeline} aria-label="Stages">
            {stages.map((stage, i) => (
              <li
                key={stage.title}
                className={
                  i === state.stage ? styles.stepCurrent : i < state.stage ? styles.stepDone : ''
                }
              >
                <button
                  type="button"
                  aria-current={i === state.stage ? 'step' : undefined}
                  aria-label={`Stage ${i + 1}: ${stage.title}`}
                  onClick={() => dispatch({ type: 'goto', stage: i })}
                >
                  <span className={styles.stepNumber}>{i + 1}</span>
                  <span className={styles.stepLabel}>{stage.short ?? stage.title}</span>
                </button>
              </li>
            ))}
          </ol>
        )}

        <div className={styles.narration} aria-live="polite">
          {current ? (
            <>
              <p className={styles.stageTitle}>
                {state.stage + 1}/{stages.length} · {current.title}
              </p>
              <p>{current.narration}</p>
              <p className={styles.tradeoff}>
                <strong>Trade-off.</strong> {current.tradeoff}
              </p>
            </>
          ) : (
            <p className={styles.intro}>{intro}</p>
          )}
        </div>
      </figcaption>
    </figure>
  );
}

/** A small bar on a node showing how busy it is in the current stage. */
function LoadBar({ percent }: { percent: number }) {
  const level = loadLevel(percent);
  return (
    <span className={styles.load} aria-label={`Load ${percent}%`} title="How busy this part is">
      <span className={styles.loadLabel} aria-hidden="true">
        load
      </span>
      <span className={styles.loadTrack}>
        <span className={`${styles.loadFill} ${styles[level]}`} style={{ width: `${percent}%` }} />
      </span>
      <span className={styles.loadValue}>{percent}%</span>
    </span>
  );
}
