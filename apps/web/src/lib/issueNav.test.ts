import { afterEach, describe, expect, it } from 'vitest';
import { clearListMemory, forgetListMemory, listReturnPath, navStateFor, peekListMemory, readNavState, rememberList, updateListFocus } from './issueNav';
import { DEFAULT_DISPLAY } from './viewState';

const source = { listId: 'l1', label: 'Engineering', returnTo: '/team/ENG/active', params: { scope: { teamId: 't' }, filter: '', display: DEFAULT_DISPLAY, collapsed: [] } };

afterEach(() => clearListMemory());

describe('issue page list context', () => {
  it('round-trips through history state and rejects junk', () => {
    expect(readNavState(navStateFor({ source, depth: 2 }))).toEqual({ source, depth: 2 });
    expect(readNavState(null)).toBeNull();
    expect(readNavState({ issueNav: { source: { listId: 1 } } })).toBeNull();
    expect(readNavState({ issueNav: { source, depth: -1 } })?.depth).toBe(0);
    expect(navStateFor(null)).toBeUndefined();
  });
  it('drops only the peek parameter from the return path', () => {
    expect(listReturnPath('/team/ENG/active', '?issue=abc&filter=x')).toBe('/team/ENG/active?filter=x');
    expect(listReturnPath('/inbox', '?issue=abc')).toBe('/inbox');
  });
  it('remembers scroll and focus for the matching location only', () => {
    rememberList('l1', { returnTo: '/team/ENG/active', scrollTop: 640, focusedId: 'a' });
    updateListFocus('l1', 'b');
    expect(peekListMemory('l1', '/team/WEB/active')).toBeNull();
    expect(peekListMemory('l1', '/team/ENG/active')).toEqual({ returnTo: '/team/ENG/active', scrollTop: 640, focusedId: 'b' });
    forgetListMemory('l1');
    expect(peekListMemory('l1', '/team/ENG/active')).toBeNull();
  });
});
