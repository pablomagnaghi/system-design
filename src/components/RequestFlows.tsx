import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { RequestFlow } from '../content/types';
import { arrowSpan, FLOW_KIND_LABEL, laneCenter, nextStep } from '../lib/request-flow';
import styles from './RequestFlows.module.css';

const STEP_MS = 2400;
const HOLD_MS = 4000;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const lastStep = (flow: RequestFlow | undefined) => (flow ? flow.steps.length - 1 : 0);

interface Props {
  readonly flows: readonly RequestFlow[];
}

/**
 * One tab per user action. Each tab is a sequence diagram: participants across the top, one arrow
 * per step, played in order with a dot that travels the current arrow and a note that explains it.
 */
export default function RequestFlows({ flows }: Props) {
  const [active, setActive] = useState(0);
  // Under reduced motion nothing plays: every arrow of the first flow shows at once.
  const [step, setStep] = useState(() => (prefersReducedMotion() ? lastStep(flows[0]) : 0));
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const [visible, setVisible] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();
  const flow = flows[active];
  const count = flow?.steps.length ?? 1;

  // Play only while on screen.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? false),
      {
        threshold: 0.35,
      },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !visible) return;
    const timer = setTimeout(
      () => setStep((s) => nextStep(s, count)),
      step === count - 1 ? HOLD_MS : STEP_MS,
    );
    return () => clearTimeout(timer);
  }, [playing, visible, step, count]);

  const choose = (index: number) => {
    setActive(index);
    setStep(prefersReducedMotion() ? lastStep(flows[index]) : 0);
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (index + delta + flows.length) % flows.length;
    choose(next);
    tabs.current[next]?.focus();
  };

  const goTo = (index: number) => {
    setPlaying(false);
    setStep((index + count) % count);
  };

  const current = flow?.steps[step];
  if (!flow || !current) return null;
  const n = flow.participants.length;

  return (
    <div className={styles.flows} ref={root}>
      <div className={styles.tabs} role="tablist" aria-label="Request flows">
        {flows.map((f, i) => (
          <button
            key={f.id}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${i}`}
            aria-selected={i === active}
            aria-controls={`${baseId}-panel`}
            tabIndex={i === active ? 0 : -1}
            className={styles.tab}
            onClick={() => choose(i)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            <span className={styles.tabTitle}>{f.title}</span>
            <span className={styles.kind} data-kind={f.kind}>
              {FLOW_KIND_LABEL[f.kind]}
            </span>
          </button>
        ))}
      </div>

      <div
        className={styles.panel}
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${active}`}
      >
        <p className={styles.summary}>
          {flow.summary} <span className={styles.runsOn}>Runs on: {flow.runsOn}</span>
        </p>

        <div className={styles.scroll}>
          <div className={styles.diagram} style={{ ['--lanes' as string]: n }}>
            <div className={styles.heads}>
              {flow.participants.map((p) => (
                <div key={p.id} className={styles.head}>
                  <strong>{p.label}</strong>
                  <span>{p.service}</span>
                </div>
              ))}
            </div>
            <div className={styles.body}>
              {flow.participants.map((p, i) => (
                <span
                  key={p.id}
                  className={styles.lifeline}
                  style={{ left: `${laneCenter(i, n)}%` }}
                  aria-hidden="true"
                />
              ))}
              <ol className={styles.rows} aria-label={`${flow.title} steps`}>
                {flow.steps.map((s, i) => {
                  const span = arrowSpan(flow, s);
                  const state = i < step ? 'done' : i === step ? 'current' : 'next';
                  return (
                    <li key={`${flow.id}-${i}`} className={styles.row} data-state={state}>
                      <button
                        type="button"
                        className={styles.rowButton}
                        onClick={() => goTo(i)}
                        aria-current={i === step ? 'step' : undefined}
                      >
                        <span
                          className={span.self ? styles.selfLabel : styles.label}
                          style={
                            span.self
                              ? { left: `calc(${span.left}% + 14px)` }
                              : { left: `${span.left}%`, width: `${span.width}%` }
                          }
                        >
                          <span className={styles.labelText}>
                            <span className={styles.number}>{i + 1}</span> {s.label}
                          </span>
                        </span>
                        {span.self ? (
                          <span
                            className={styles.activation}
                            style={{ left: `${span.left}%` }}
                            aria-hidden="true"
                          />
                        ) : (
                          <span
                            className={styles.arrow}
                            data-style={s.style ?? 'call'}
                            data-reversed={span.reversed}
                            style={{ left: `${span.left}%`, width: `${span.width}%` }}
                            aria-hidden="true"
                          >
                            {state === 'current' && (
                              <span
                                key={`${active}-${step}`}
                                className={styles.dot}
                                data-reversed={span.reversed}
                              />
                            )}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </div>

        <div className={styles.controls}>
          <button type="button" onClick={() => goTo(step - 1)} aria-label="Previous step">
            ←
          </button>
          <button
            type="button"
            className={styles.play}
            data-playing={playing}
            onClick={() => setPlaying((p) => !p)}
            aria-pressed={playing}
          >
            <span className={styles.playIcon} aria-hidden="true">
              {playing ? '❚❚' : '▶'}
            </span>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" onClick={() => goTo(step + 1)} aria-label="Next step">
            →
          </button>
          <span className={styles.counter}>
            Step {step + 1} of {count}
          </span>
        </div>
        {/* Time left on the current step while playing, so it is clear the flow is running. */}
        <div className={styles.progress} aria-hidden="true">
          {playing && visible && (
            <span
              key={`${active}-${step}`}
              className={styles.progressFill}
              style={{ animationDuration: `${step === count - 1 ? HOLD_MS : STEP_MS}ms` }}
            />
          )}
        </div>

        <div className={styles.note} aria-live="polite">
          <strong>
            {step + 1}. {current.label}
          </strong>
          <p>{current.note}</p>
        </div>
      </div>
    </div>
  );
}
