import { describe, expect, it } from 'vitest';
import { renderSmsBody } from './template';

describe('renderSmsBody', () => {
  const vars = { firstName: 'Pat', lastName: 'Chen', dealerName: 'Sample Motors' };

  it('substitutes the supported variables', () => {
    expect(
      renderSmsBody('Hi {{first_name}} {{last_name}}, {{dealer_name}} invites you!', vars),
    ).toBe('Hi Pat Chen, Sample Motors invites you!');
  });

  it('tolerates spacing inside the braces', () => {
    expect(renderSmsBody('Hi {{ first_name }}!', vars)).toBe('Hi Pat!');
  });

  it('renders a missing value as empty and collapses leftover doubled spaces', () => {
    expect(
      renderSmsBody('Hi {{first_name}} — see you at {{dealer_name}}.', {
        firstName: null,
        lastName: null,
        dealerName: 'Sample Motors',
      }),
    ).toBe('Hi — see you at Sample Motors.');
  });

  it('leaves an unknown variable verbatim so typos stay visible', () => {
    expect(renderSmsBody('Hi {{frist_name}}!', vars)).toBe('Hi {{frist_name}}!');
  });

  it('is a passthrough for a template with no variables', () => {
    expect(renderSmsBody('Sale Saturday only.', vars)).toBe('Sale Saturday only.');
  });
});
