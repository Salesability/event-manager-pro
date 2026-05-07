import { describe, expect, it } from 'vitest';
import { buildCsv, csvCell } from './csv';

describe('csvCell', () => {
  it('quotes a plain value', () => {
    expect(csvCell('Capital Ford')).toBe('"Capital Ford"');
  });

  it('escapes embedded double quotes by doubling them', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('prefixes formula-leading values with a single quote', () => {
    // The four characters Excel/Sheets treat as formula introducers.
    expect(csvCell('=SUM(A1:A10)')).toBe(`"'=SUM(A1:A10)"`);
    expect(csvCell('+1234')).toBe(`"'+1234"`);
    expect(csvCell('-cmd|...')).toBe(`"'-cmd|..."`);
    expect(csvCell('@user')).toBe(`"'@user"`);
  });

  it('only prefixes when whitespace precedes a formula char (not whitespace alone)', () => {
    // `\tinjection` has no formula char — Excel can't run it; don't add
    // a noisy `'` prefix. The previous regex was over-eager.
    expect(csvCell('\tinjection')).toBe('"\tinjection"');
    expect(csvCell('\rfoo')).toBe('"\rfoo"');
    // But whitespace + formula char still gets the prefix (next test).
  });

  it('catches formula chars hidden behind leading whitespace / invisibles', () => {
    // Excel trims whitespace before parsing, so `\n=`, ` =`, NBSP+`=`, and
    // BOM+`=` would all slip past a naive `^=` check. The mitigation must
    // see through any `\s*` prefix.
    expect(csvCell('\n=HYPERLINK("http://evil")')).toContain(`"'\n=`);
    expect(csvCell(' =SUM(A1)')).toContain(`"' =`);
    expect(csvCell(' =cmd')).toContain(`' =`); // NBSP
    expect(csvCell('﻿=cmd')).toContain(`'﻿=`); // ZWNBSP / BOM
  });

  it("does NOT prefix values that merely contain a formula char", () => {
    // Mitigation only triggers on the leading character — Excel only
    // interprets the leading char as syntax.
    expect(csvCell('A=B')).toBe('"A=B"');
    expect(csvCell('foo+bar')).toBe('"foo+bar"');
  });
});

describe('buildCsv', () => {
  it('emits CRLF-separated rows with a UTF-8 BOM and quotes every cell', () => {
    const csv = buildCsv(
      ['Name', 'Count'],
      [
        ['abc motors', '3'],
        ['Capital Ford', '5'],
      ],
    );
    expect(csv).toBe(
      '﻿"Name","Count"\r\n"abc motors","3"\r\n"Capital Ford","5"',
    );
  });

  it('runs the formula mitigation on header AND data cells', () => {
    const csv = buildCsv(['=Header'], [['=Row']]);
    expect(csv).toContain(`"'=Header"`);
    expect(csv).toContain(`"'=Row"`);
  });
});
