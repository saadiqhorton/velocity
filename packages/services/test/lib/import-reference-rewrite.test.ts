import { describe, expect, it } from 'vitest';
import { rewriteImportedReferences } from '../../src/lib/import-reference-rewrite';

describe('rewriteImportedReferences', () => {
  const mapping = new Map([
    ['ENG-12', { id: 'issue-12', identifier: 'OPS-4' }],
    ['OPS-3', { id: 'issue-3', identifier: 'OPS-5' }],
    ['ENG-13', null],
  ]);

  it('rewrites exact adjacent and repeated references across teams', () => {
    expect(rewriteImportedReferences('ENG-12,OPS-3 ENG-12', mapping).text).toBe('OPS-4,OPS-5 OPS-4');
  });

  it('leaves code, URLs, and Markdown link destinations unchanged', () => {
    const source = [
      'ENG-12',
      '`ENG-12`',
      '    ENG-12',
      '```md',
      'ENG-12',
      '```',
      '[ENG-12](https://example.test/ENG-12)',
      'https://example.test/ENG-12',
      'OPS-3',
    ].join('\n');
    const result = rewriteImportedReferences(source, mapping);
    expect(result.text).toBe(source.replace(/^ENG-12$/m, 'OPS-4').replace('[ENG-12](', '[OPS-4](').replace(/^OPS-3$/m, 'OPS-5'));
    expect(result.skippedCodeReferences).toBeGreaterThanOrEqual(3);
  });

  it('does not infer from a suffix, prefix, or a missing map entry', () => {
    const result = rewriteImportedReferences('ENG-13 ENG-12x XENG-12', mapping);
    expect(result.text).toBe('ENG-13 ENG-12x XENG-12');
    expect(result.unmapped).toEqual(['ENG-13', 'XENG-12']);
  });

  it('preserves surrounding bytes and returns stable before/after edits', () => {
    expect(rewriteImportedReferences('  (ENG-12)!\r\n', mapping)).toMatchObject({
      text: '  (OPS-4)!\r\n',
      edits: [{ sourceKey: 'ENG-12', destinationId: 'issue-12', before: 'ENG-12', after: 'OPS-4' }],
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
        { sourceKey: 'ENG-12', destinationId: 'uuid-eng-12' },
        { sourceKey: 'WEB-3', destinationId: 'uuid-web-3' },
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
      '> ```md',
      '> ENG-12',
      '> ```',
      '[ENG-12]: https://example.test/ENG-12 "ENG-12"',
      'ENG-12',
    ].join('\n');
    const result = rewriteImportedReferences(source, mapping);
    expect(result.text).toBe(source.replace(/\nENG-12$/, '\nOPS-4'));
  });

  it('preserves indented code nested in blockquotes while rewriting blockquote prose', () => {
    const source = ['>     ENG-12', '> >     ENG-12', '> ENG-12', 'ENG-12'].join('\n');

    expect(rewriteImportedReferences(source, mapping)).toMatchObject({
      text: ['>     ENG-12', '> >     ENG-12', '> OPS-4', 'OPS-4'].join('\n'),
      edits: [
        { sourceKey: 'ENG-12', destinationId: 'issue-12', before: 'ENG-12', after: 'OPS-4' },
        { sourceKey: 'ENG-12', destinationId: 'issue-12', before: 'ENG-12', after: 'OPS-4' },
      ],
    });
  });

  it('masks URI destinations with any valid scheme and keeps exact map semantics', () => {
    const source = ['mailto:ENG-12@example.test', 'custom+v1:ENG-12/resource', 'ENG-12', 'ENG-13'].join('\n');

    expect(rewriteImportedReferences(source, mapping)).toMatchObject({
      text: ['mailto:ENG-12@example.test', 'custom+v1:ENG-12/resource', 'OPS-4', 'ENG-13'].join('\n'),
      unmapped: ['ENG-13'],
      edits: [{ sourceKey: 'ENG-12', destinationId: 'issue-12', before: 'ENG-12', after: 'OPS-4' }],
    });
  });

  it('does not rewrite identifiers embedded after path, issue, dot, or hyphen punctuation', () => {
    const source = 'path/ENG-12 #ENG-12 .ENG-12 -ENG-12 (ENG-12)';
    expect(rewriteImportedReferences(source, mapping).text).toBe('path/ENG-12 #ENG-12 .ENG-12 -ENG-12 (OPS-4)');
  });

  it('rejects identifiers embedded before path, issue, dot, or hyphen suffixes while allowing sentence punctuation', () => {
    const source = 'ENG-12/child ENG-12#comment ENG-12.child ENG-12-child. See ENG-12.';
    const result = rewriteImportedReferences(source, mapping);

    expect(result.text).toBe('ENG-12/child ENG-12#comment ENG-12.child ENG-12-child. See OPS-4.');
    expect(result.edits.map(({ start, end }) => [start, end])).toEqual([[source.lastIndexOf('ENG-12'), source.lastIndexOf('ENG-12') + 'ENG-12'.length]]);
  });
});
