import type { TEmailTemplate } from '../../types.ts';

const text: TEmailTemplate = ({ t, link }) => {
  const greeting = t('email.greeating', { defaultValue: 'Dear user' });
  const body = t('email.passwordRecovery', {
    defaultValue: 'Recovery password',
  });

  return `${greeting}
${body} ${link}
`;
};

export default text;
