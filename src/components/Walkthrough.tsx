import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { Walkthrough, WalkthroughStage } from '../content/types';
import {
  edgeGeometry,
  edgeKey,
  nodeBox,
  percentX,
  percentY,
  VIEW,
} from '../lib/walkthrough-layout';
import { initPlayer, playerReducer, playLabel } from '../lib/walkthrough-player';
import styles from './Walkthrough.module.css';

interface Props {
  walkthrough: Walkthrough;
}

/** Time each stage stays on screen while playing, and how long a dot takes to travel. */
const STAGE_MS = 9000;
const TRAVEL_MS = 1400;

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
  const activeEdges = new Set(current?.travel.map(edgeKey));

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

  // Move one dot along each edge the work travels in this stage.
  useEffect(() => {
    const svg = svgRef.current;
    const travel = current?.travel ?? [];
    if (!svg || travel.length === 0) return;
    const paths = travel.map((edge) =>
      svg.querySelector<SVGPathElement>(`[data-edge="${edgeKey(edge)}"]`),
    );
    const place = (progress: number) => {
      paths.forEach((path, i) => {
        const dot = dotRefs.current[i];
        if (!path || !dot) return;
        const point = path.getPointAtLength(path.getTotalLength() * progress);
        dot.style.left = percentX(point.x);
        dot.style.top = percentY(point.y);
      });
    };
    if (prefersReducedMotion()) {
      place(1);
      return;
    }
    let frame = 0;
    const startedAt = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - startedAt) / TRAVEL_MS, 1);
      place(1 - (1 - t) ** 3); // ease-out
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [current]);

  const nodeClass = (id: string): string =>
    [styles.node, activeNodes.has(id) && styles.active, done.nodes.has(id) && styles.done]
      .filter(Boolean)
      .join(' ');
  const edgeClass = (key: string): string =>
    [styles.edge, activeEdges.has(key) && styles.edgeActive, done.edges.has(key) && styles.edgeDone]
      .filter(Boolean)
      .join(' ');

  return (
    <figure className={styles.walkthrough} aria-label={label}>
      <div ref={scrollerRef} className={styles.scroller}>
        <div className={styles.canvas} style={{ aspectRatio: `${VIEW.width} / ${VIEW.height}` }}>
          <svg
            ref={svgRef}
            className={styles.edges}
            viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {connectors.map(({ key, geometry }) => (
              <path key={key} data-edge={key} d={geometry.d} className={edgeClass(key)} />
            ))}
          </svg>

          {connectors.map(({ key, label, geometry }) =>
            label ? (
              <span
                key={`label-${key}`}
                className={[styles.edgeLabel, activeEdges.has(key) && styles.edgeLabelActive]
                  .filter(Boolean)
                  .join(' ')}
                style={{ left: percentX(geometry.mid.x), top: percentY(geometry.mid.y) }}
              >
                {label}
              </span>
            ) : null,
          )}

          {lanes?.top && (
            <span className={styles.lane} style={{ top: percentY(8) }}>
              {lanes.top}
            </span>
          )}
          {lanes?.bottom && (
            <span className={styles.lane} style={{ top: percentY(330) }}>
              {lanes.bottom}
            </span>
          )}

          {nodes.map((node) => {
            const box = boxes.get(node.id);
            if (!box) return null;
            return (
              <div
                key={node.id}
                data-node={node.id}
                className={nodeClass(node.id)}
                style={{
                  left: percentX(box.x),
                  top: percentY(box.y),
                  width: percentX(box.width),
                  height: percentY(box.height),
                }}
              >
                <strong>{node.title}</strong>
                <span>{node.detail}</span>
              </div>
            );
          })}

          {current?.travel.map((edge, i) => (
            <span
              key={`${state.stage}-${edgeKey(edge)}`}
              ref={(element) => {
                dotRefs.current[i] = element;
              }}
              className={styles.dot}
              aria-hidden="true"
            />
          ))}
        </div>
      </div>

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
        </div>

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
