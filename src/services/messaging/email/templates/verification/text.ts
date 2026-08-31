import type { TEmailTemplate } from '../../types.ts';

const text: TEmailTemplate = ({ t, link }) => {
  const greeting = t('email.greeating', { defaultValue: 'Dear user' });
  const body = t('email.verifyInstructions', {
    defaultValue: 'To verify your email address, follow the link:',
  });

  return `${greeting}
${body} ${link}
`;
};

export default text;
