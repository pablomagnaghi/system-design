/**
 * Pure state machine for the walkthrough player.
 * `stage` is -1 before the first run (the intro), then 0..last.
 */
export interface PlayerState {
  readonly stage: number;
  readonly playing: boolean;
  readonly last: number;
}

export type PlayerAction =
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'tick' }
  | { readonly type: 'next' }
  | { readonly type: 'prev' }
  | { readonly type: 'goto'; readonly stage: number };

export function initPlayer(stageCount: number): PlayerState {
  return { stage: -1, playing: false, last: Math.max(stageCount - 1, 0) };
}

const clamp = (value: number, last: number): number => Math.min(Math.max(value, 0), last);

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case 'play':
      // Starting from the intro or the end replays from the first stage.
      if (state.stage < 0 || state.stage >= state.last)
        return { ...state, stage: 0, playing: true };
      return { ...state, playing: true };
    case 'pause':
      return { ...state, playing: false };
    case 'tick':
      if (!state.playing) return state;
      if (state.stage >= state.last) return { ...state, playing: false };
      return { ...state, stage: state.stage + 1 };
    case 'next':
      return { ...state, stage: clamp(state.stage + 1, state.last), playing: false };
    case 'prev':
      return { ...state, stage: clamp(state.stage - 1, state.last), playing: false };
    case 'goto':
      return { ...state, stage: clamp(action.stage, state.last), playing: false };
  }
}

/** The label for the main button, derived from state so the UI never disagrees with it. */
export function playLabel(state: PlayerState, startLabel: string): string {
  if (state.playing) return 'Pause';
  if (state.stage < 0) return startLabel;
  if (state.stage >= state.last) return 'Replay';
  return 'Resume';
}
