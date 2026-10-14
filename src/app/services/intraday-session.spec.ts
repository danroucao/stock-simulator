import {describe,it,expect} from 'vitest';
import {intradaySession} from './intraday-session';
describe('intraday session',()=>{
 it('uses the Taipei trading window',()=>{
  expect(intradaySession(new Date('2026-10-14T00:30:00Z')).state).toBe('preopen');
  expect(intradaySession(new Date('2026-10-14T01:00:00Z')).state).toBe('open');
  expect(intradaySession(new Date('2026-10-14T05:36:00Z')).state).toBe('closed');
 });
 it('does not enable weekends',()=>expect(intradaySession(new Date('2026-10-10T02:00:00Z')).state).toBe('nontrading'));
});
