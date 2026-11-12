import { describe, expect, it } from 'vitest';
import { edgeGeometry, edgeKey, edgePath, nodeBox, VIEW } from './walkthrough-layout';
import { initPlayer, playerReducer, playLabel, type PlayerState } from './walkthrough-player';

describe('playerReducer', () => {
  const start = initPlayer(3);
  const at = (stage: number, playing = false): PlayerState => ({ ...start, stage, playing });

  it('starts at the intro, and play jumps to the first stage', () => {
    expect(start).toEqual({ stage: -1, playing: false, last: 2 });
    expect(playerReducer(start, { type: 'play' })).toEqual(at(0, true));
  });

  it('advances on tick only while playing, and stops at the last stage', () => {
    expect(playerReducer(at(0, true), { type: 'tick' })).toEqual(at(1, true));
    expect(playerReducer(at(0), { type: 'tick' })).toEqual(at(0));
    expect(playerReducer(at(2, true), { type: 'tick' })).toEqual(at(2));
  });

  it('replays from the start when played at the end', () => {
    expect(playerReducer(at(2), { type: 'play' })).toEqual(at(0, true));
    expect(playerReducer(at(1), { type: 'play' })).toEqual(at(1, true));
  });

  it('pauses on manual navigation and clamps to the stage range', () => {
    expect(playerReducer(at(1, true), { type: 'next' })).toEqual(at(2));
    expect(playerReducer(at(2), { type: 'next' })).toEqual(at(2));
    expect(playerReducer(at(0), { type: 'prev' })).toEqual(at(0));
    expect(playerReducer(at(0, true), { type: 'goto', stage: 9 })).toEqual(at(2));
  });

  it('labels the main button from state', () => {
    expect(playLabel(start, 'Run')).toBe('Run');
    expect(playLabel(at(1, true), 'Run')).toBe('Pause');
    expect(playLabel(at(1), 'Run')).toBe('Resume');
    expect(playLabel(at(2), 'Run')).toBe('Replay');
  });
});

describe('layout', () => {
  it('keeps every grid position inside the canvas', () => {
    for (const row of ['top', 'middle', 'bottom'] as const) {
      const box = nodeBox({ column: 5, row });
      expect(box.x + box.width).toBeLessThanOrEqual(VIEW.width);
      expect(box.y + box.height).toBeLessThanOrEqual(VIEW.height);
    }
  });

  it('connects the right edge of one box to the left edge of the next', () => {
    const path = edgePath(
      nodeBox({ column: 0, row: 'middle' }),
      nodeBox({ column: 1, row: 'top' }),
    );
    expect(path.startsWith('M 140 166')).toBe(true);
    expect(path.endsWith('172 78')).toBe(true);
    expect(edgeKey(['a', 'b'])).toBe('a>b');
  });

  it('fans forward edges apart, and routes vertical and backward edges', () => {
    const hub = nodeBox({ column: 2, row: 'middle' });
    const up = edgePath(hub, nodeBox({ column: 3, row: 'top' }));
    const down = edgePath(hub, nodeBox({ column: 3, row: 'bottom' }));
    expect(up.startsWith('M 484 166')).toBe(true);
    expect(down.startsWith('M 484 194')).toBe(true);
    expect(
      edgePath(nodeBox({ column: 1, row: 'middle' }), nodeBox({ column: 1, row: 'top' })),
    ).toBe('M 242 142 L 242 116');
    const back = edgePath(nodeBox({ column: 3, row: 'top' }), hub);
    expect(back.startsWith('M 586 116')).toBe(true);
    expect(back.endsWith('484 180')).toBe(true);
  });

  it('draws same-row backward edges straight, and finds the midpoint for labels', () => {
    const same = edgeGeometry(
      nodeBox({ column: 3, row: 'top' }),
      nodeBox({ column: 2, row: 'top' }),
    );
    expect(same.d).toBe('M 516 78 L 484 78');
    expect(same.mid).toEqual({ x: 500, y: 78 });
    const back = edgeGeometry(
      nodeBox({ column: 3, row: 'top' }),
      nodeBox({ column: 2, row: 'middle' }),
    );
    expect(back.mid).toEqual({ x: 573.25, y: 172 });
  });
});
