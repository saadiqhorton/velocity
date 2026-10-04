import { describe, expect, it } from 'vitest';
import { Lexer, marked, type Token } from 'marked';
import { extractMentions, isSafeUrl, markdownToPlainText, sanitizeMarkdown } from '../../src/lib/markdown';

/** Collect all html tokens and all link/image/def hrefs from the lexed markdown. */
function audit(md: string): { html: string[]; hrefs: string[] } {
  const html: string[] = [];
  const hrefs: string[] = [];
  const walk = (tokens: Token[]) => {
    for (const t of tokens as (Token & { tokens?: Token[]; items?: Token[]; href?: string; header?: { tokens: Token[] }[]; rows?: { tokens: Token[] }[][] })[]) {
      if (t.type === 'html') html.push(t.raw);
      if (t.type === 'link' || t.type === 'image' || t.type === 'def') hrefs.push(t.href ?? '');
      if (t.type === 'code' || t.type === 'codespan') continue;
      if (t.items) walk(t.items);
      if (t.tokens) walk(t.tokens);
      for (const c of t.header ?? []) walk(c.tokens);
      for (const r of t.rows ?? []) for (const c of r) walk(c.tokens);
    }
  };
  walk(new Lexer({ gfm: true }).lex(md));
  return { html, hrefs };
}
const MARKED_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'em', 'strong', 'del', 'a', 'img', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input']);
/** Render with marked and assert only marked's own, attribute-safe tags exist. */
function expectInertHtml(md: string) {
  const html = marked.parse(md, { async: false });
  expect(html).not.toMatch(/<\s*script/i);
  for (const m of html.matchAll(/<\/?([A-Za-z][A-Za-z0-9-]*)([^>]*)>/g)) {
    const name = (m[1] as string).toLowerCase();
    expect(MARKED_TAGS.has(name), `unexpected tag <${name}> in ${html}`).toBe(true);
    expect(m[2], `event handler attribute in ${m[0]}`).not.toMatch(/\son[a-z]+\s*=/i);
    expect(m[2]).not.toMatch(/(src|href)\s*=\s*["']?\s*(javascript|vbscript|data):/i);
  }
}

function expectClean(out: string) {
  const a = audit(out);
  expect(a.html).toEqual([]);
  for (const h of a.hrefs) expect(isSafeUrl(h), `unsafe href survived: ${h}`).toBe(true);
}

describe('sanitizeMarkdown preserves safe markdown byte-for-byte', () => {
  const samples = [
    '',
    'plain text',
    '# Heading\n\nParagraph with **bold**, _em_, ~~del~~ and `code`.\n',
    '- a\n- b\n  - nested\n\n1. one\n2. two\n',
    '> quote\n> more\n\n---\n',
    '```ts\nconst a = "<script>alert(1)</script>";\n```\n',
    '    indented <b>code</b>\n',
    '`<img src=x onerror=alert(1)>` inline code',
    '[link](https://example.com/a_(b)?q=1#h "title") ![img](/relative/path.png) [mail](mailto:a@b.co) [rel](../x) [frag](#top) [q](?a=1)',
    '<https://example.com> and <me@example.com> and www.example.com',
    '| a | b |\n|---|---|\n| 1 | 2 |\n',
    '[ref]: https://example.com "t"\n\n[use][ref]\n',
    'Tabs\tand  trailing spaces  \nhard break\n',
    '- [ ] task\n- [x] done\n',
    '1 < 2 and 3 > 2 & more; a <3 b\n',
    'Emoji 😀 and 日本語\n\n\n\nmany blanks',
    '&lt;script&gt; escaped entity stays',
    '\\<b\\> escaped',
    '[ftp-ok-relative](docs/a:b)',
    '[colon in path](/a:b)',
  ];
  it.each(samples)('%j', (md) => expect(sanitizeMarkdown(md)).toBe(md));
  it('a `<` that starts a tag-like run is escaped even without a closing `>`', () => expect(sanitizeMarkdown('if a<b then')).toBe('if a\\<b then'));
  it('normalises CRLF to LF only', () => expect(sanitizeMarkdown('a\r\nb\r\n')).toBe('a\nb\n'));
});

describe('HTML escaping (text kept, `<` backslash-escaped)', () => {
  it('escapes inline tags but keeps all text', () => {
    expect(sanitizeMarkdown('a <b>bold</b> c')).toBe('a \\<b>bold\\</b> c');
    expect(sanitizeMarkdown('x <span style="color:red">y</span>')).toBe('x \\<span style="color:red">y\\</span>');
    expect(sanitizeMarkdown('hi<br>there<br/>x')).toBe('hi\\<br>there\\<br/>x');
  });
  it('keeps generics and tag names mentioned in prose', () => {
    expect(sanitizeMarkdown('Use Map<string, number> here')).toBe('Use Map\\<string, number> here');
    expect(sanitizeMarkdown('use the <details> element')).toBe('use the \\<details> element');
    expect(sanitizeMarkdown('Array<string>')).toBe('Array\\<string>');
  });
  it('spec examples', () => {
    expect(sanitizeMarkdown('<script>alert(1)</script>')).toBe('\\<script>alert(1)\\</script>');
  });
  it('escapes block html, keeping text', () => {
    expect(sanitizeMarkdown('before\n\n<div class="x">\nhello\n</div>\n\nafter')).toBe('before\n\n\\<div class="x">\nhello\n\\</div>\n\nafter');
    expect(sanitizeMarkdown('<script>alert(1)</script>\n\ntext')).toBe('\\<script>alert(1)\\</script>\n\ntext');
    expect(sanitizeMarkdown('<!-- comment -->\ntext')).toBe('\\<!-- comment -->\ntext');
  });
  it('is idempotent and never double-escapes', () => {
    for (const md of ['\\<script>alert(1)\\</script>', 'Map\\<string, number>', 'a \\<b>x\\</b>']) expect(sanitizeMarkdown(md)).toBe(md);
    for (const md of ['<script>x</script>', 'Map<string, number>', '<div>\n*a*\n</div>', '<a href="x">[a](javascript:1)</a>', '\\<b><i>x</i>'] ) {
      const once = sanitizeMarkdown(md);
      expect(sanitizeMarkdown(once)).toBe(once);
    }
  });
  it('doubles backslashes before `<` so they cannot cancel the escape', () => {
    const out = sanitizeMarkdown('<a href="x">\\<b>onerror</a>');
    expect(marked.parse(out, { async: false })).not.toMatch(/<b>/);
    expect(sanitizeMarkdown(out)).toBe(out);
  });
  it('keeps html inside code spans and fences byte-for-byte', () => {
    const md = 'use `<b>` here\n\n```html\n<div>x</div>\n```\n\n    <i>y</i>\n';
    expect(sanitizeMarkdown(md)).toBe(md);
  });
  it('mixes code and real html correctly (code span before identical tag)', () => {
    expect(sanitizeMarkdown('`<b>` then <b>real</b>')).toBe('`<b>` then \\<b>real\\</b>');
  });
  it('handles html inside blockquotes, lists, tables, emphasis, link labels', () => {
    expect(sanitizeMarkdown('> q <i>z</i>\n> more')).toBe('> q \\<i>z\\</i>\n> more');
    expect(sanitizeMarkdown('- item <u>x</u>\n  cont\n- two')).toBe('- item \\<u>x\\</u>\n  cont\n- two');
    expect(sanitizeMarkdown('| a | <b>x</b> |\n|--|--|\n| 1 | 2 |')).toBe('| a | \\<b>x\\</b> |\n|--|--|\n| 1 | 2 |');
    expect(sanitizeMarkdown('**<i>x</i>**')).toBe('**\\<i>x\\</i>**');
    expect(sanitizeMarkdown('[<img src=x onerror=alert(1)>](https://a.b)')).toBe('[\\<img src=x onerror=alert(1)>](https://a.b)');
  });
});

describe('URL scheme rewriting', () => {
  it.each([
    ['[x](javascript:alert(1))', '[x](#)'],
    ['[x](JAVASCRIPT:alert(1))', '[x](#)'],
    ['[x](jAvAsCrIpT:alert(1))', '[x](#)'],
    ['[x](java&#x09;script:alert(1))', '[x](#)'],
    ['[x](java&#9;script:alert(1))', '[x](#)'],
    ['[x](java&Tab;script:alert(1))', '[x](#)'],
    ['[x](java&NewLine;script:alert(1))', '[x](#)'],
    ['[x](javascript&colon;alert(1))', '[x](#)'],
    ['[x](&#106;avascript:alert(1))', '[x](#)'],
    ['[x](&#x6A;&#x61;vascript:alert(1))', '[x](#)'],
    ['[x](&#0000106avascript:alert(1))', '[x](#)'],
    ['[x](javascript&#58;alert(1))', '[x](#)'],
    ['[x](%6Aavascript:alert(1))', '[x](#)'],
    ['[x](<javascript:alert(1)>)', '[x](#)'],
    ['[x](vbscript:msgbox(1))', '[x](#)'],
    ['[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)', '[x](#)'],
    ['[x](file:///etc/passwd)', '[x](#)'],
    ['[x](ftp://example.com/x)', '[x](#)'],
    ['[x](blob:https://a.b/uuid)', '[x](#)'],
    ['[x](about:blank)', '[x](#)'],
    ['[x](tel:123)', '[x](#)'],
    ['[x](javascript:alert(1) "title")', '[x](#)'],
    ['![x](javascript:alert(1))', '![x](#)'],
    ['![x](data:image/svg+xml;base64,AAAA)', '![x](#)'],
    ['![x](JaVaScRiPt:alert(1) "t")', '![x](#)'],
    ['[x][r]\n\n[r]: javascript:alert(1)', '[x][r]\n\n[r]: #'],
    ['[r]: vbscript:x "t"\n', '[r]: #\n'],
  ])('%j', (md, expected) => {
    const out = sanitizeMarkdown(md);
    expectClean(out);
    if (!md.includes('[x][r]') && !md.startsWith('[r]')) expect(out).toBe(expected);
  });
  it('rewrites autolinks with bad schemes', () => {
    const out = sanitizeMarkdown('see <javascript:alert(1)> now');
    expectClean(out);
    expect(out).toContain('(#)');
  });
  it('keeps safe schemes and relative links untouched', () => {
    for (const u of ['http://a.b', 'HTTPS://A.B/x', 'mailto:a@b.c', '/x', './x', '../x', '#x', '?q', 'x/y:z', '//cdn.example.com/x'])
      expect(sanitizeMarkdown(`[a](${u})`)).toBe(`[a](${u})`);
  });
  it('only the offending link in a mixed line changes', () => {
    expect(sanitizeMarkdown('[ok](https://a.b) and [bad](javascript:1) and [ok2](/x)')).toBe('[ok](https://a.b) and [bad](#) and [ok2](/x)');
  });
  it('handles nested images in links', () => {
    const out = sanitizeMarkdown('[![alt](javascript:1)](https://a.b)');
    expectClean(out);
    expect(out).toContain('(https://a.b)');
  });
});

describe('isSafeUrl', () => {
  it('whitespace / control / zero-width obfuscation', () => {
    for (const u of ['java\tscript:x', 'java\nscript:x', ' javascript:x', '\u0001javascript:x', 'java​script:x', ' javascript:x'.replace(' ', ' '), 'javascript\u0000:x'])
      expect(isSafeUrl(u)).toBe(false);
  });
  it('backslash and double-encoded variants', () => {
    expect(isSafeUrl('&amp;#106;avascript:x')).toBe(false);
    expect(isSafeUrl('%256Aavascript:x')).toBe(false); // conservative: a scheme-looking prefix that is not http/https/mailto
    expect(isSafeUrl('\\\\evil')).toBe(true);
  });
  it('allowed', () => {
    for (const u of ['', 'http://x', 'https://x', 'mailto:x@y', 'rel/path', '/abs', '#f', '?q=a:b', 'a/b:c', '100%'])
      expect(isSafeUrl(u)).toBe(true);
  });
});

describe('XSS payload corpus', () => {
  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<IMG SRC="javascript:alert(1)">',
    '<svg onload=alert(1)>',
    '<svg><script>alert(1)</script></svg>',
    '<body onload=alert(1)>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<a href="javascript:alert(1)">click</a>',
    '<a href="  jAvAsCrIpT:alert(1)">click</a>',
    '<a href=&#x6A;avascript:alert(1)>click</a>',
    '<math><mtext><script>alert(1)</script></mtext></math>',
    '<details open ontoggle=alert(1)>',
    '<input autofocus onfocus=alert(1)>',
    '<video><source onerror="alert(1)"></video>',
    '<object data="javascript:alert(1)"></object>',
    '<embed src="data:text/html,<script>alert(1)</script>">',
    '<link rel=stylesheet href="javascript:alert(1)">',
    '<style>@import "javascript:alert(1)";</style>',
    '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
    '<form action="javascript:alert(1)"><button>x</button></form>',
    '<div style="background:url(javascript:alert(1))">x</div>',
    '<!--<script>alert(1)</script>-->',
    '<![CDATA[<script>alert(1)</script>]]>',
    '[a](javascript:alert(1))',
    '[a](JavaScript:alert(document.cookie))',
    '[a](java&#x09;script:alert(1))',
    '[a](&#x6a&#x61&#x76&#x61&#x73&#x63&#x72&#x69&#x70&#x74&#x3a;alert(1))',
    '[a](<javascript:alert(1)>)',
    '[a](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '![a](javascript:alert(1))',
    '![a](x "onerror=alert(1)")<img src=x onerror=alert(1)>',
    '[a][b]\n\n[b]: javascript:alert(1)',
    '<javascript:alert(1)>',
    '[![x](https://a.b/i.png)](javascript:alert(1))',
    '> <script>alert(1)</script>',
    '- <img src=x onerror=alert(1)>',
    '1. <svg/onload=alert(1)>',
    '| a |\n|---|\n| <script>alert(1)</script> |',
    '**<script>alert(1)</script>**',
    '# <img src=x onerror=alert(1)>',
    '[click <b onclick=alert(1)>me</b>](https://ok.example)',
    'text <a href="https://ok.example" onclick="alert(1)">ok</a>',
    '<<script>script>alert(1)<</script>/script>',
    '<scr<script>ipt>alert(1)</scr</script>ipt>',
    '\n\n<div>\n\n<script>alert(1)</script>\n\n</div>\n\n',
    '<a href="vbscript:msgbox(1)">x</a>',
    '[x](  javascript:alert(1)  )',
    '[x](JaVa​ScRiPt:alert(1))',
  ];
  it('has at least 25 payloads', () => expect(payloads.length).toBeGreaterThanOrEqual(25));
  it.each(payloads.map((p, i) => [i, p] as const))('payload %i leaves no html or unsafe urls', (_i, p) => {
    const out = sanitizeMarkdown(p);
    expectClean(out);
    expect(out).not.toMatch(/(?<!\\)<\s*[A-Za-z!/?]/);
    expectInertHtml(out);
    expect(sanitizeMarkdown(out)).toBe(out); // idempotent
  });
  it('payloads embedded in realistic documents stay clean', () => {
    for (const p of payloads) {
      for (const wrap of [(s: string) => `# Title\n\nSome text.\n\n${s}\n\n- list\n`, (s: string) => `> ${s.replace(/\n/g, '\n> ')}`, (s: string) => `- a\n  ${s.replace(/\n/g, '\n  ')}\n- b`]) {
        const out = sanitizeMarkdown(wrap(p));
        expectClean(out);
        expect(sanitizeMarkdown(out)).toBe(out);
      }
    }
  });
  it('combined payload', () => {
    const out = sanitizeMarkdown(payloads.join('\n\n'));
    expectClean(out);
  });
});

describe('extractMentions', () => {
  it('extracts, lowercases, dedupes in order', () => {
    expect(extractMentions('hi @Bob and @alice, cc @BOB')).toEqual(['bob', 'alice']);
  });
  it('supports username charset and trims trailing punctuation', () => {
    expect(extractMentions('@a_b-c.d! @x.y. @ab- @user-name,')).toEqual(['a_b-c.d', 'x.y', 'ab', 'user-name']);
  });
  it('enforces length 2..32', () => {
    expect(extractMentions('@a')).toEqual([]);
    expect(extractMentions('@ab')).toEqual(['ab']);
    expect(extractMentions(`@${'a'.repeat(32)}`)).toEqual(['a'.repeat(32)]);
    expect(extractMentions(`@${'a'.repeat(33)}`)).toEqual([]);
  });
  it('ignores emails and mid-word @', () => {
    expect(extractMentions('mail me at a@example.com or bob.smith@corp.io')).toEqual([]);
    expect(extractMentions('foo@bar @real')).toEqual(['real']);
    expect(extractMentions('x@@yy @@zz')).toEqual([]);
  });
  it('ignores code spans, fences and indented code', () => {
    expect(extractMentions('`@code` and ```@x2```')).toEqual([]);
    expect(extractMentions('```\n@fenced\n```\n\n    @indented\n\n@real')).toEqual(['real']);
  });
  it('ignores link destinations and autolinks but includes link labels', () => {
    expect(extractMentions('[x](https://a.b/@user) <https://a.b/@other>')).toEqual([]);
    expect(extractMentions('[@bob](https://a.b)')).toEqual(['bob']);
    expect(extractMentions('https://medium.com/@writer')).toEqual([]);
  });
  it('works inside emphasis, lists, quotes, headings, tables', () => {
    expect(extractMentions('**@Strong** _@em_\n\n- @item\n\n> @quote\n\n# @head\n\n| a |\n|--|\n| @cell |')).toEqual(['strong', 'em', 'item', 'quote', 'head', 'cell']);
  });
  it('ignores escaped @ and html', () => {
    expect(extractMentions('\\@nope <b>@yes</b> <span title="@attr">z</span>')).toEqual(['yes']);
  });
  it('none', () => {
    expect(extractMentions('')).toEqual([]);
    expect(extractMentions('no mentions here')).toEqual([]);
    expect(extractMentions('@')).toEqual([]);
  });
});

describe('markdownToPlainText', () => {
  it('strips markup', () => {
    expect(markdownToPlainText('# Title\n\nHello **bold** _em_ ~~del~~ `code` [link](https://x.y) ![alt](a.png)')).toBe('Title Hello bold em del code link alt');
  });
  it('lists, quotes, tables, code blocks, hr', () => {
    expect(markdownToPlainText('- a\n- b\n\n1. c\n\n> q\n\n---\n\n```\nx = 1\n```\n\n| h |\n|---|\n| v |')).toBe('a b c q x = 1 h v');
  });
  it('drops html', () => expect(markdownToPlainText('a <b>b</b> <script>x</script>')).toBe('a b x'));
  it('decodes entities and escapes', () => expect(markdownToPlainText('Tom &amp; Jerry \\*not em\\* &lt;3')).toBe('Tom & Jerry *not em* <3'));
  it('collapses whitespace', () => expect(markdownToPlainText('a\n\n\n   b\t\tc  \nd')).toBe('a b c d'));
  it('truncates with an ellipsis', () => {
    expect(markdownToPlainText('abcdefghij', 10)).toBe('abcdefghij');
    expect(markdownToPlainText('abcdefghijk', 10)).toBe('abcdefghi…');
    expect(markdownToPlainText('hello world foo', 6)).toBe('hello…');
    expect(markdownToPlainText('abc', 1)).toBe('abc'.length > 1 ? '…' : 'abc');
    expect(markdownToPlainText('abc', 0)).toBe('');
    expect([...markdownToPlainText('x'.repeat(500), 80)].length).toBeLessThanOrEqual(80);
  });
  it('empty input', () => expect(markdownToPlainText('')).toBe(''));
});
