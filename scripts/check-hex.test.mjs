import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSkippedDir, scanText } from './check-hex.mjs';

const flagged = (s) => scanText(s).map((h) => h.text);

test('flags real colors', () => {
  assert.deepEqual(flagged('a { color: #fff; }'), ['#fff']);
  assert.deepEqual(flagged('a { color: #FFFFFF; }'), ['#FFFFFF']);
  assert.deepEqual(flagged('const c = "#1a2b3c";'), ['#1a2b3c']);
  assert.deepEqual(flagged('fill="#ff000080"'), ['#ff000080']);
  assert.deepEqual(flagged('bg: #abcd'), ['#abcd']);
  assert.deepEqual(flagged('a { color: #123; }'), ['#123']);
  assert.deepEqual(flagged('box-shadow: 0 0 1px #000, 0 0 2px #111;'), ['#000', '#111']);
  assert.deepEqual(flagged("const c = '#112233';"), ['#112233']);
  assert.deepEqual(flagged('stroke="#000"'), ['#000']);
});

test('reports line and column', () => {
  assert.deepEqual(scanText('x\n  a: #fff'), [{ line: 2, col: 6, text: '#fff' }]);
});

test('ignores anchors, issue refs, entities, id selectors', () => {
  assert.deepEqual(flagged('<a href="#main">skip</a>'), []);
  assert.deepEqual(flagged('<a href="#fade">x</a>'), []);
  assert.deepEqual(flagged('<use href="#abc"/>'), []);
  assert.deepEqual(flagged('fill: url(#abc)'), []);
  assert.deepEqual(flagged('// fixes #123 and #1234'), []);
  assert.deepEqual(flagged('Closes #123.'), []);
  assert.deepEqual(flagged('it("parses #123", () => {})'), []);
  assert.deepEqual(flagged('&#x27; &#39; &#xABC;'), []);
  assert.deepEqual(flagged('.foo#bar { margin: 0 }'), []);
  assert.deepEqual(flagged('.foo#add { margin: 0 }'), []);
  assert.deepEqual(flagged('#add { margin: 0 }'), []);
  assert.deepEqual(flagged('#abc.active { margin: 0 }'), []);
  assert.deepEqual(flagged('https://example.com/page#abc'), []);
  assert.deepEqual(flagged('const label = "ENG-1#2"'), []);
  assert.deepEqual(flagged('#12345 is not a color length'), []);
  assert.deepEqual(flagged('const x = "#ffffffgg"'), []);
});

test('escape hatch', () => {
  assert.deepEqual(flagged('a: #fff // check-hex-ignore'), []);
});

test('skips generated output dirs, including Playwright slot runs', () => {
  assert.equal(isSkippedDir('node_modules'), true);
  assert.equal(isSkippedDir('dist'), true);
  assert.equal(isSkippedDir('test-results'), true);
  assert.equal(isSkippedDir('test-results_1'), true);
  assert.equal(isSkippedDir('playwright-report'), true);
  assert.equal(isSkippedDir('playwright-report_3'), true);
  assert.equal(isSkippedDir('src'), false);
  assert.equal(isSkippedDir('test-results-notes'), false);
});
