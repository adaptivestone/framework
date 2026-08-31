import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { testEach } from '../../../tests/parameterized.ts';
import recoveryHtml from './templates/recovery/html.ts';
import recoverySubject from './templates/recovery/subject.ts';
import recoveryText from './templates/recovery/text.ts';
import verificationHtml from './templates/verification/html.ts';
import verificationSubject from './templates/verification/subject.ts';
import verificationText from './templates/verification/text.ts';
import type { TEmailTemplate, TEmailTemplateData } from './types.ts';

const link = 'https://example.com/en/auth/login?verification_token=abc123';

/** `t` of an app whose locales carry none of the keys — every default wins. */
const missingT: TEmailTemplateData['t'] = (key, options) =>
  options?.defaultValue ?? key;

/** `t` of an app that translated every key — the translation must win. */
const resolvingT: TEmailTemplateData['t'] = (key) => `translated:${key}`;

const data = (t: TEmailTemplateData['t']): TEmailTemplateData => ({
  locale: 'en',
  t,
  link,
  editor: 'nick',
});

const templates: Record<
  string,
  {
    render: TEmailTemplate;
    keys: string[];
    english: string[];
    hasLink: boolean;
    isSubject: boolean;
  }
> = {
  'recovery/subject': {
    render: recoverySubject,
    keys: ['email.passwordRecovery'],
    english: ['Recovery password'],
    hasLink: false,
    isSubject: true,
  },
  'recovery/html': {
    render: recoveryHtml,
    keys: ['email.passwordRecovery', 'email.passwordChanged'],
    english: ['Recovery password', 'Password changed'],
    hasLink: true,
    isSubject: false,
  },
  'recovery/text': {
    render: recoveryText,
    keys: ['email.greeating', 'email.passwordRecovery'],
    english: ['Dear user', 'Recovery password'],
    hasLink: true,
    isSubject: false,
  },
  'verification/subject': {
    render: verificationSubject,
    keys: ['email.emailConfirm'],
    english: ['Email confirmation'],
    hasLink: false,
    isSubject: true,
  },
  'verification/html': {
    render: verificationHtml,
    keys: ['email.emailConfirm', 'email.verify', 'email.verifyInstructions'],
    english: [
      'Email confirmation',
      'Verify email',
      'To verify your email address, follow the link:',
    ],
    hasLink: true,
    isSubject: false,
  },
  'verification/text': {
    render: verificationText,
    keys: ['email.greeating', 'email.verifyInstructions'],
    english: ['Dear user', 'To verify your email address, follow the link:'],
    hasLink: true,
    isSubject: false,
  },
};

const names = Object.keys(templates);

describe('shipped email templates', () => {
  testEach(names, 'answers in English when no key resolves: %s', (name) => {
    const template = templates[name];
    if (!template) {
      throw new Error(`Unknown template ${name}`);
    }
    const rendered = template.render(data(missingT));
    for (const english of template.english) {
      assert.ok(
        rendered.includes(english),
        `${name} is missing the English default '${english}': ${rendered}`,
      );
    }
    if (template.hasLink) {
      assert.ok(rendered.includes(link), `${name} is missing the link`);
    }
  });

  testEach(names, 'lets an app translation win: %s', (name) => {
    const template = templates[name];
    if (!template) {
      throw new Error(`Unknown template ${name}`);
    }
    const rendered = template.render(data(resolvingT));
    for (const key of template.keys) {
      assert.ok(
        rendered.includes(`translated:${key}`),
        `${name} did not use the translation of '${key}': ${rendered}`,
      );
    }
    for (const english of template.english) {
      assert.ok(
        !rendered.includes(english),
        `${name} kept the English default '${english}' over the translation`,
      );
    }
  });

  testEach(
    names.filter((name) => templates[name]?.isSubject),
    'renders a non-empty single-line subject: %s',
    (name) => {
      const rendered = templates[name]?.render(data(missingT)) ?? '';
      assert.ok(rendered.length > 0, `${name} rendered an empty subject`);
      assert.ok(!rendered.includes('\n'), `${name} subject spans lines`);
    },
  );

  const htmlNames = names.filter((name) => name.endsWith('/html'));

  testEach(
    htmlNames,
    'renders the request locale as the document language: %s',
    (name) => {
      const template = templates[name];
      if (!template) {
        throw new Error(`Unknown template ${name}`);
      }
      const rendered = template.render({ ...data(missingT), locale: 'ru' });
      assert.ok(
        rendered.includes('<html lang="ru">'),
        `${name} did not follow the request locale: ${rendered}`,
      );
    },
  );

  testEach(
    htmlNames,
    'falls back to English when no locale is given: %s',
    (name) => {
      const template = templates[name];
      if (!template) {
        throw new Error(`Unknown template ${name}`);
      }
      for (const locale of ['', undefined]) {
        const rendered = template.render({
          ...data(missingT),
          locale,
        } as TEmailTemplateData);
        assert.ok(
          rendered.includes('<html lang="en">'),
          `${name} lost the default language for ${JSON.stringify(locale)}: ${rendered}`,
        );
      }
    },
  );

  testEach(
    htmlNames,
    'escapes the locale it puts in the lang attribute: %s',
    (name) => {
      const template = templates[name];
      if (!template) {
        throw new Error(`Unknown template ${name}`);
      }
      const rendered = template.render({
        ...data(missingT),
        locale: 'en" onload="alert(1)',
      });
      assert.ok(
        !rendered.includes('lang="en" onload="alert(1)"'),
        `${name} broke out of the lang attribute: ${rendered}`,
      );
      assert.ok(
        rendered.includes('lang="en&quot; onload=&quot;alert(1)"'),
        `${name} did not escape the locale: ${rendered}`,
      );
    },
  );

  it('escapes interpolated values in the HTML templates', () => {
    const hostile = 'https://example.com/?a="><script>alert(1)</script>';
    for (const render of [recoveryHtml, verificationHtml]) {
      const rendered = render({ ...data(missingT), link: hostile });
      assert.ok(!rendered.includes('<script>'), 'raw markup survived');
      assert.ok(rendered.includes('&lt;script&gt;'), 'markup was not escaped');
    }
  });
});
