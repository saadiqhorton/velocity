import { describe, expect, it } from 'vitest';
import { findImportedReferenceKeys, rewriteImportedReferences } from '../../src/lib/import-reference-rewrite';

const DESTINATION_ID = '0f3c2a1e-0000-4000-8000-000000000001';
const LINEAR_LINK = 'https://linear.app/saadiqhorton/issue/SAA-77/spec-tool-catalog-auto-discovery-output-cap-phase-1';
const CANONICAL_LINK = '[DEZ-72](/issue/' + DESTINATION_ID + ')';
const mappedLink = (label: string): string => '[' + label + '](' + LINEAR_LINK + ')';

describe('rewriteImportedReferences', () => {
  const mapping = new Map([
    ['ENG-12', { id: 'issue-12', identifier: 'OPS-4' }],
    ['OPS-3', { id: 'issue-3', identifier: 'OPS-5' }],
    ['ENG-13', null],
  ]);
  const linkMapping = new Map([
    ['SAA-77', { id: DESTINATION_ID, identifier: 'DEZ-72' }],
    ['ENG-12', { id: 'issue-12', identifier: 'OPS-4' }],
  ]);

  it('rewrites exact adjacent and repeated references across teams', () => {
    expect(rewriteImportedReferences('ENG-12,OPS-3 ENG-12', mapping).text).toBe('OPS-4,OPS-5 OPS-4');
  });

  it('leaves code, URLs, and whole external Markdown links unchanged', () => {
    const source = [
      'ENG-12',
      '\u0060ENG-12\u0060',
      '    ENG-12',
      String.fromCharCode(96, 96, 96) + 'md',
      'ENG-12',
      String.fromCharCode(96, 96, 96),
      '[ENG-12](https://example.test/ENG-12)',
      'https://example.test/ENG-12',
      'OPS-3',
    ].join('\n');
    const result = rewriteImportedReferences(source, mapping);
    expect(result.text).toBe(source.replace(/^ENG-12$/m, 'OPS-4').replace(/^OPS-3$/m, 'OPS-5'));
    expect(result.skippedCodeReferences).toBeGreaterThanOrEqual(3);
  });

  it('preserves network-path URL query references while rewriting prose', () => {
    const source = '//example.test/?ref=ENG-12\nSee ENG-12';

    expect(rewriteImportedReferences(source, mapping).text).toBe('//example.test/?ref=ENG-12\nSee OPS-4');
  });

  it('protects complete bare URLs when Markdown-like text partially overlaps them', () => {
    const source = [
      '<https://example.test/?q=[label](value)&ref=ENG-12>',
      '//example.test/?q=[label](value)&ref=ENG-12',
      'www.example.test/?q=[label](value)&ref=ENG-12',
      'See ENG-12',
    ].join('\n');

    expect(rewriteImportedReferences(source, mapping).text).toBe(
      source.replace(/\nSee ENG-12$/, '\nSee OPS-4'),
    );
  });

  it('does not infer from a suffix, prefix, or a missing map entry', () => {
    const result = rewriteImportedReferences('ENG-13 ENG-12x XENG-12', mapping);
    expect(result.text).toBe('ENG-13 ENG-12x XENG-12');
    expect(result.unmapped).toEqual(['ENG-13', 'XENG-12']);
  });

  it('preserves surrounding bytes and returns stable before/after edits', () => {
    expect(rewriteImportedReferences('  (ENG-12)!\r\n', mapping)).toMatchObject({
      text: '  (OPS-4)!\r\n',
      edits: [{ sourceKey: 'ENG-12', destinationId: 'issue-12', identifier: 'OPS-4', before: 'ENG-12', after: 'OPS-4' }],
    });
  });

  it('maps cross-team source keys exactly and warns for a different numeric suffix', () => {
    const crossTeam = new Map([
      ['ENG-12', { id: 'uuid-eng-12', identifier: 'ALPHA-1' }],
      ['WEB-3', { id: 'uuid-web-3', identifier: 'OMEGA-1' }],
    ]);
    expect(rewriteImportedReferences('ENG-12 WEB-3 WEB-30', crossTeam)).toMatchObject({
      text: 'ALPHA-1 OMEGA-1 WEB-30',
      unmapped: ['WEB-30'],
      edits: [
        { sourceKey: 'ENG-12', destinationId: 'uuid-eng-12', identifier: 'ALPHA-1' },
        { sourceKey: 'WEB-3', destinationId: 'uuid-web-3', identifier: 'OMEGA-1' },
      ],
    });
  });

  it('reports a source-style reference absent from the exact run map without rewriting it', () => {
    expect(rewriteImportedReferences('See OTHER-123 and repo/app#8.', mapping)).toMatchObject({
      text: 'See OTHER-123 and repo/app#8.',
      unmapped: ['OTHER-123', 'repo/app#8'],
    });
  });

  it('preserves bare www URLs, blockquoted fences, and reference definitions', () => {
    const source = [
      'www.example.com/ENG-12',
      '> ' + String.fromCharCode(96, 96, 96) + 'md',
      '> ENG-12',
      '> ' + String.fromCharCode(96, 96, 96),
      '[ENG-12]: https://example.test/ENG-12 "ENG-12"',
      'ENG-12',
    ].join('\n');
    const result = rewriteImportedReferences(source, mapping);
    expect(result.text).toBe(source.replace(/\nENG-12$/, '\nOPS-4'));
  });

  it('preserves blockquoted reference labels and destinations while rewriting prose', () => {
    const source = '> [ENG-12]: /ENG-12 "ENG-12"\n> ENG-12\nENG-12';
    const proseReference = source.indexOf('> ENG-12') + 2;
    const plainReference = source.lastIndexOf('ENG-12');
    const result = rewriteImportedReferences(source, mapping);

    expect(result.text).toBe('> [ENG-12]: /ENG-12 "ENG-12"\n> OPS-4\nOPS-4');
    expect(result.edits.map(({ start, end }) => [start, end])).toEqual([
      [proseReference, proseReference + 'ENG-12'.length],
      [plainReference, plainReference + 'ENG-12'.length],
    ]);
  });

  it('preserves indented code nested in blockquotes while rewriting blockquote prose', () => {
    const source = ['>     ENG-12', '> >     ENG-12', '> ENG-12', 'ENG-12'].join('\n');

    expect(rewriteImportedReferences(source, mapping)).toMatchObject({
      text: ['>     ENG-12', '> >     ENG-12', '> OPS-4', 'OPS-4'].join('\n'),
      edits: [
        { sourceKey: 'ENG-12', destinationId: 'issue-12', identifier: 'OPS-4', before: 'ENG-12', after: 'OPS-4' },
        { sourceKey: 'ENG-12', destinationId: 'issue-12', identifier: 'OPS-4', before: 'ENG-12', after: 'OPS-4' },
      ],
    });
  });

  it('masks URI destinations while rewriting an exact mapped reference before a colon suffix', () => {
    const source = [
      'mailto:ENG-12@example.test',
      'custom+v1:ENG-12/resource',
      'ENG-12:review',
      'ENG-12://example.test/ENG-12',
      'ENG-12',
      'ENG-13',
    ].join('\n');

    expect(rewriteImportedReferences(source, mapping)).toMatchObject({
      text: [
        'mailto:ENG-12@example.test',
        'custom+v1:ENG-12/resource',
        'OPS-4:review',
        'ENG-12://example.test/ENG-12',
        'OPS-4',
        'ENG-13',
      ].join('\n'),
      unmapped: ['ENG-13'],
      edits: [
        { sourceKey: 'ENG-12', destinationId: 'issue-12', identifier: 'OPS-4', before: 'ENG-12', after: 'OPS-4' },
        { sourceKey: 'ENG-12', destinationId: 'issue-12', identifier: 'OPS-4', before: 'ENG-12', after: 'OPS-4' },
      ],
    });
  });

  it('does not rewrite identifiers embedded after path, issue, dot, or hyphen punctuation', () => {
    const source = 'path/ENG-12 #ENG-12 .ENG-12 -ENG-12 (ENG-12)';
    expect(rewriteImportedReferences(source, mapping).text).toBe('path/ENG-12 #ENG-12 .ENG-12 -ENG-12 (OPS-4)');
  });

  it('rejects identifiers embedded before path, issue, dot, or hyphen suffixes while allowing sentence punctuation', () => {
    const source = 'ENG-12/child ENG-12#comment ENG-12.child ENG-12-child. ENG-12./child ENG-12.#123 ENG-12.-subtask. See ENG-12.';
    const result = rewriteImportedReferences(source, mapping);

    expect(result).toMatchObject({
      text: 'ENG-12/child ENG-12#comment ENG-12.child ENG-12-child. ENG-12./child ENG-12.#123 ENG-12.-subtask. See OPS-4.',
      unmapped: [],
      edits: [{ sourceKey: 'ENG-12', destinationId: 'issue-12', identifier: 'OPS-4', before: 'ENG-12', after: 'OPS-4' }],
    });
    expect(result.edits.map(({ start, end }) => [start, end])).toEqual([
      [source.lastIndexOf('ENG-12'), source.lastIndexOf('ENG-12') + 'ENG-12'.length],
    ]);
  });

  it('atomically rewrites mapped Linear links, including the existing split-label form', () => {
    const titledLink = mappedLink('SAA-77').slice(0, -1) + ' "Spec")';
    const source = [
      titledLink,
      "[Renamed](<https://linear.app/saadiqhorton/issue/SAA%2D77?view=all#description> 'Quoted title')",
      mappedLink('DEZ-72'),
      '[SAA-77](https://LINEAR.APP/saadiqhorton/issue/SAA-77/)',
    ].join('\n');
    const result = rewriteImportedReferences(source, linkMapping);

    expect(result.text).toBe(Array.from({ length: 4 }, () => CANONICAL_LINK).join('\n'));
    expect(result.edits).toHaveLength(4);
    expect(result.edits[0]).toMatchObject({
      sourceKey: 'SAA-77',
      destinationId: DESTINATION_ID,
      identifier: 'DEZ-72',
      before: titledLink,
      after: CANONICAL_LINK,
      start: 0,
    });
    expect(result.unmapped).toEqual([]);
  });

  it('preserves unmapped, external, image, malformed, and inexact-host links as whole units', () => {
    const source = [
      '[SAA-77](https://linear.app/saadiqhorton/issue/SAA-99/slug "Missing")',
      '[SAA-77](https://example.test/' + LINEAR_LINK + ')',
      '[SAA-77](https://linear.app.attacker.test/saadiqhorton/issue/SAA-77/slug)',
      '[SAA-77](http://linear.app/saadiqhorton/issue/SAA-77/slug)',
      '[SAA-77](https://linear.app:444/saadiqhorton/issue/SAA-77/slug)',
      '[SAA-77](https://linear.app/saadiqhorton/issues/SAA-77/slug)',
      '[SAA-77](https://linear.app/saadiqhorton/issue/SAA-77/slug/extra)',
      '![SAA-77](' + LINEAR_LINK + ')',
    ].join('\n');
    const result = rewriteImportedReferences(source, linkMapping);

    expect(result.text).toBe(source);
    expect(result.edits).toEqual([]);
    expect(result.unmapped).toEqual(['SAA-99']);
  });

  it('preserves reference links, images, and code while rewriting only unprotected prose', () => {
    const tick = String.fromCharCode(96);
    const source = [
      '[SAA-77]: ' + LINEAR_LINK + ' "SAA-77"',
      '[SAA-77][spec] and [SAA-77][] and [SAA-77]',
      '![SAA-77](' + LINEAR_LINK + ')',
      tick + mappedLink('SAA-77') + tick,
      String.fromCharCode(96, 96, 96) + 'md',
      mappedLink('SAA-77'),
      String.fromCharCode(96, 96, 96),
      'SAA-77',
    ].join('\n');
    const result = rewriteImportedReferences(source, linkMapping);

    expect(result.text).toBe(source.replace(/\nSAA-77$/, '\nDEZ-72'));
    expect(result.edits).toHaveLength(1);
    expect(result.skippedCodeReferences).toBeGreaterThan(0);
  });

  it('is idempotent after producing a canonical internal issue link', () => {
    const once = rewriteImportedReferences(mappedLink('SAA-77'), linkMapping);
    const twice = rewriteImportedReferences(once.text, linkMapping);

    expect(once.text).toBe(CANONICAL_LINK);
    expect(once.alreadyCorrect).toBe(0);
    expect(twice).toMatchObject({ text: CANONICAL_LINK, edits: [], unmapped: [], alreadyCorrect: 1 });
  });

  it('leaves an existing canonical destination unchanged if a later mapping label differs', () => {
    const changed = new Map([['SAA-77', { id: DESTINATION_ID, identifier: 'DEZ-73' }]]);
    expect(rewriteImportedReferences(CANONICAL_LINK, changed)).toMatchObject({
      text: CANONICAL_LINK,
      edits: [],
      unmapped: [],
      alreadyCorrect: 0,
    });
  });

  it('finds exact persisted keys in a split-label Linear destination but not in code or external links', () => {
    const tick = String.fromCharCode(96);
    expect(findImportedReferenceKeys(mappedLink('DEZ-72'), ['SAA-77'])).toEqual(['SAA-77']);
    expect(findImportedReferenceKeys(tick + mappedLink('DEZ-72') + tick, ['SAA-77'])).toEqual([]);
    expect(findImportedReferenceKeys('[SAA-77](https://example.test/SAA-77)', ['SAA-77'])).toEqual([]);
  });
});
