import { describe, it, expect } from 'vitest';

import {
  ASSISTANT_NAME,
  getTriggerPattern,
  TRIGGER_PATTERN,
} from './config.js';
import { parseTextStyles, parseSignalStyles } from './text-styles.js';

// --- TRIGGER_PATTERN ---

describe('TRIGGER_PATTERN', () => {
  const name = ASSISTANT_NAME;
  const lower = name.toLowerCase();
  const upper = name.toUpperCase();

  it('matches @name at start of message', () => {
    expect(TRIGGER_PATTERN.test(`@${name} hello`)).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(TRIGGER_PATTERN.test(`@${lower} hello`)).toBe(true);
    expect(TRIGGER_PATTERN.test(`@${upper} hello`)).toBe(true);
  });

  it('does not match when not at start of message', () => {
    expect(TRIGGER_PATTERN.test(`hello @${name}`)).toBe(false);
  });

  it('does not match partial name like @NameExtra (word boundary)', () => {
    expect(TRIGGER_PATTERN.test(`@${name}extra hello`)).toBe(false);
  });

  it('matches with word boundary before apostrophe', () => {
    expect(TRIGGER_PATTERN.test(`@${name}'s thing`)).toBe(true);
  });

  it('matches @name alone (end of string is a word boundary)', () => {
    expect(TRIGGER_PATTERN.test(`@${name}`)).toBe(true);
  });

  it('matches with leading whitespace after trim', () => {
    // The actual usage trims before testing: TRIGGER_PATTERN.test(m.content.trim())
    expect(TRIGGER_PATTERN.test(`@${name} hey`.trim())).toBe(true);
  });
});

describe('getTriggerPattern', () => {
  it('uses the configured per-group trigger when provided', () => {
    const pattern = getTriggerPattern('@Claw');

    expect(pattern.test('@Claw hello')).toBe(true);
    expect(pattern.test(`@${ASSISTANT_NAME} hello`)).toBe(false);
  });

  it('falls back to the default trigger when group trigger is missing', () => {
    const pattern = getTriggerPattern(undefined);

    expect(pattern.test(`@${ASSISTANT_NAME} hello`)).toBe(true);
  });

  it('treats regex characters in custom triggers literally', () => {
    const pattern = getTriggerPattern('@C.L.A.U.D.E');

    expect(pattern.test('@C.L.A.U.D.E hello')).toBe(true);
    expect(pattern.test('@CXLXAUXDXE hello')).toBe(false);
  });
});

// --- parseTextStyles ---

describe('parseTextStyles — passthrough channels', () => {
  it('passes text through unchanged on discord', () => {
    const md = '**bold** and *italic* and [link](https://example.com)';
    expect(parseTextStyles(md, 'discord')).toBe(md);
  });

  it('passes text through unchanged on signal (signal uses parseSignalStyles)', () => {
    const md = '**bold** and *italic* and [link](https://example.com)';
    expect(parseTextStyles(md, 'signal')).toBe(md);
  });
});

describe('parseTextStyles — bold', () => {
  it('converts **bold** to *bold* on whatsapp', () => {
    expect(parseTextStyles('**hello**', 'whatsapp')).toBe('*hello*');
  });

  it('converts **bold** to *bold* on telegram', () => {
    expect(parseTextStyles('say **this** now', 'telegram')).toBe(
      'say *this* now',
    );
  });

  it('converts **bold** to *bold* on slack', () => {
    expect(parseTextStyles('**hello**', 'slack')).toBe('*hello*');
  });

  it('does not convert a lone * as bold', () => {
    expect(parseTextStyles('a * b * c', 'whatsapp')).toBe('a * b * c');
  });
});

describe('parseTextStyles — italic', () => {
  it('converts *italic* to _italic_ on whatsapp', () => {
    expect(parseTextStyles('say *this* now', 'whatsapp')).toBe(
      'say _this_ now',
    );
  });

  it('converts *italic* to _italic_ on telegram', () => {
    expect(parseTextStyles('*italic*', 'telegram')).toBe('_italic_');
  });

  it('bold-before-italic: **bold** *italic* → *bold* _italic_', () => {
    expect(parseTextStyles('**bold** *italic*', 'whatsapp')).toBe(
      '*bold* _italic_',
    );
  });
});

describe('parseTextStyles — headings', () => {
  it('converts # heading on whatsapp', () => {
    expect(parseTextStyles('# Top', 'whatsapp')).toBe('*Top*');
  });

  it('converts ## heading on telegram', () => {
    expect(parseTextStyles('## Hello World', 'telegram')).toBe('*Hello World*');
  });

  it('converts ### heading on telegram', () => {
    expect(parseTextStyles('### Section', 'telegram')).toBe('*Section*');
  });

  it('only converts headings at line start', () => {
    const input = 'not a ## heading in middle';
    expect(parseTextStyles(input, 'whatsapp')).toBe(input);
  });
});

describe('parseTextStyles — links', () => {
  it('converts [text](url) to text (url) on whatsapp', () => {
    expect(parseTextStyles('[Link](https://example.com)', 'whatsapp')).toBe(
      'Link (https://example.com)',
    );
  });

  it('converts [text](url) to text (url) on telegram', () => {
    expect(parseTextStyles('[Link](https://example.com)', 'telegram')).toBe(
      'Link (https://example.com)',
    );
  });

  it('converts [text](url) to <url|text> on slack', () => {
    expect(parseTextStyles('[Click here](https://example.com)', 'slack')).toBe(
      '<https://example.com|Click here>',
    );
  });
});

describe('parseTextStyles — horizontal rules', () => {
  it('strips --- on telegram', () => {
    expect(parseTextStyles('above\n---\nbelow', 'telegram')).toBe(
      'above\n\nbelow',
    );
  });

  it('strips *** on whatsapp', () => {
    expect(parseTextStyles('above\n***\nbelow', 'whatsapp')).toBe(
      'above\n\nbelow',
    );
  });
});

describe('parseTextStyles — code block protection', () => {
  it('does not transform **bold** inside fenced code block', () => {
    const input = '```\n**not bold**\n```';
    expect(parseTextStyles(input, 'whatsapp')).toBe(input);
  });

  it('does not transform *italic* inside inline code', () => {
    const input = 'use `*star*` literally';
    expect(parseTextStyles(input, 'telegram')).toBe(input);
  });

  it('transforms text outside code blocks but not inside', () => {
    const input = '**bold** and `*code*` and *italic*';
    expect(parseTextStyles(input, 'whatsapp')).toBe(
      '*bold* and `*code*` and _italic_',
    );
  });

  it('transforms text outside fenced block but not inside', () => {
    const input = '**bold**\n```\n**raw**\n```\n*italic*';
    expect(parseTextStyles(input, 'telegram')).toBe(
      '*bold*\n```\n**raw**\n```\n_italic_',
    );
  });
});

// --- parseSignalStyles ---

describe('parseSignalStyles — basic styles', () => {
  it('extracts BOLD from **text**', () => {
    const { text, textStyle } = parseSignalStyles('**hello**');
    expect(text).toBe('hello');
    expect(textStyle).toEqual([{ style: 'BOLD', start: 0, length: 5 }]);
  });

  it('extracts ITALIC from *text*', () => {
    const { text, textStyle } = parseSignalStyles('*hello*');
    expect(text).toBe('hello');
    expect(textStyle).toEqual([{ style: 'ITALIC', start: 0, length: 5 }]);
  });

  it('extracts ITALIC from _text_', () => {
    const { text, textStyle } = parseSignalStyles('_hello_');
    expect(text).toBe('hello');
    expect(textStyle).toEqual([{ style: 'ITALIC', start: 0, length: 5 }]);
  });

  it('extracts STRIKETHROUGH from ~~text~~', () => {
    const { text, textStyle } = parseSignalStyles('~~hello~~');
    expect(text).toBe('hello');
    expect(textStyle).toEqual([
      { style: 'STRIKETHROUGH', start: 0, length: 5 },
    ]);
  });

  it('extracts MONOSPACE from `inline code`', () => {
    const { text, textStyle } = parseSignalStyles('`code`');
    expect(text).toBe('code');
    expect(textStyle).toEqual([{ style: 'MONOSPACE', start: 0, length: 4 }]);
  });

  it('extracts BOLD from ## heading and strips marker', () => {
    const { text, textStyle } = parseSignalStyles('## Hello World');
    expect(text).toBe('Hello World');
    expect(textStyle).toEqual([{ style: 'BOLD', start: 0, length: 11 }]);
  });

  it('no styles for plain text', () => {
    const { text, textStyle } = parseSignalStyles('just plain text');
    expect(text).toBe('just plain text');
    expect(textStyle).toHaveLength(0);
  });
});

describe('parseSignalStyles — mixed content', () => {
  it('correctly offsets styles in mixed text', () => {
    const { text, textStyle } = parseSignalStyles('say **hi** now');
    expect(text).toBe('say hi now');
    expect(textStyle).toEqual([{ style: 'BOLD', start: 4, length: 2 }]);
  });

  it('handles multiple styles with correct offsets', () => {
    const { text, textStyle } = parseSignalStyles('**bold** and *italic*');
    expect(text).toBe('bold and italic');
    expect(textStyle[0]).toEqual({ style: 'BOLD', start: 0, length: 4 });
    expect(textStyle[1]).toEqual({ style: 'ITALIC', start: 9, length: 6 });
  });

  it('strips link markers, no style applied', () => {
    const { text, textStyle } = parseSignalStyles(
      '[Click here](https://example.com)',
    );
    expect(text).toBe('Click here (https://example.com)');
    expect(textStyle).toHaveLength(0);
  });

  it('strips horizontal rules', () => {
    const { text, textStyle } = parseSignalStyles('above\n---\nbelow');
    expect(text).toBe('above\nbelow');
    expect(textStyle).toHaveLength(0);
  });
});

describe('parseSignalStyles — code block protection', () => {
  it('protects fenced code block content with MONOSPACE', () => {
    const input = '```\n**not bold**\n```';
    const { text, textStyle } = parseSignalStyles(input);
    expect(text).toBe('**not bold**');
    expect(textStyle).toEqual([{ style: 'MONOSPACE', start: 0, length: 12 }]);
  });

  it('styles outside block are still processed', () => {
    const input = '**bold**\n```\nraw code\n```';
    const { text, textStyle } = parseSignalStyles(input);
    expect(text).toContain('bold');
    expect(text).toContain('raw code');
    const boldStyle = textStyle.find((s) => s.style === 'BOLD');
    const codeStyle = textStyle.find((s) => s.style === 'MONOSPACE');
    expect(boldStyle).toBeDefined();
    expect(codeStyle).toBeDefined();
  });
});

describe('parseSignalStyles — snake_case guard', () => {
  it('does not italicise underscores in snake_case', () => {
    const { text, textStyle } = parseSignalStyles('use snake_case_here');
    expect(text).toBe('use snake_case_here');
    expect(textStyle).toHaveLength(0);
  });
});

