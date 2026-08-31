import type { TEmailTemplate } from '../../types.ts';

const text: TEmailTemplate = ({ t, link }) => {
  // 'email.greeating' is the deprecated pre-5.4 spelling — honoured as a
  // fallback until v6 so app catalogs that translated it keep working.
  const greeting = t('email.greeting', {
    defaultValue: t('email.greeating', { defaultValue: 'Dear user' }),
  });
  const body = t('email.passwordRecovery', {
    defaultValue: 'Recovery password',
  });

  return `${greeting}
${body} ${link}
`;
};

export default text;
