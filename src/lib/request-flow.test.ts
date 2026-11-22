import { describe, expect, it } from 'vitest';
import type { RequestFlow } from '../content/types';
import { arrowSpan, laneCenter, nextStep, unknownParticipants } from './request-flow';

const send = {
  from: 'app',
  to: 'db',
  label: 'send',
  note: 'Forwarded to the store through the gateway.',
};
const ack = {
  from: 'db',
  to: 'app',
  label: 'ack',
  note: 'The ack returns after the write.',
  style: 'reply' as const,
};
const check = {
  from: 'gw',
  to: 'gw',
  label: 'check',
  note: 'Work done inside the gateway itself.',
};

const flow: RequestFlow = {
  id: 'send',
  title: 'Send',
  kind: 'sync',
  summary: 'A message goes from the app to the store and an ack comes back.',
  runsOn: 'App → Gateway → Store',
  participants: [
    { id: 'app', label: 'App', service: 'Phone' },
    { id: 'gw', label: 'Gateway', service: 'EC2' },
    { id: 'db', label: 'Store', service: 'DynamoDB' },
    { id: 'redis', label: 'Pub/sub', service: 'Redis' },
  ],
  steps: [send, ack, check],
};

describe('request flow layout', () => {
  it('centers each lifeline in its column', () => {
    expect(laneCenter(0, 4)).toBe(12.5);
    expect(laneCenter(3, 4)).toBe(87.5);
  });

  it('spans an arrow between the two lifelines, either direction', () => {
    expect(arrowSpan(flow, send)).toEqual({
      left: 12.5,
      width: 50,
      reversed: false,
      self: false,
    });
    expect(arrowSpan(flow, ack)).toEqual({
      left: 12.5,
      width: 50,
      reversed: true,
      self: false,
    });
  });

  it('marks work inside one participant as a self step with no width', () => {
    expect(arrowSpan(flow, check)).toEqual({
      left: 37.5,
      width: 0,
      reversed: false,
      self: true,
    });
  });

  it('rejects a step that names an undeclared participant', () => {
    const stray = { from: 'app', to: 'queue', label: 'x', note: 'y' };
    const broken = { ...flow, steps: [stray] };
    expect(unknownParticipants(broken)).toEqual(['queue']);
    expect(() => arrowSpan(broken, stray)).toThrow(/unknown participant/);
    expect(unknownParticipants(flow)).toEqual([]);
  });

  it('wraps to the first step after the last when playing', () => {
    expect(nextStep(0, 3)).toBe(1);
    expect(nextStep(2, 3)).toBe(0);
  });
});
