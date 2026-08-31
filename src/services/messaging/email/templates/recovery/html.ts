import { escapeHtml } from '../../escapeHtml.ts';
import type { TEmailTemplate } from '../../types.ts';

const html: TEmailTemplate = ({ t, link }) => {
  const heading = t('email.passwordRecovery', {
    defaultValue: 'Recovery password',
  });
  const body = t('email.passwordChanged', { defaultValue: 'Password changed' });

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
  </head>
  <body>
    <h1>${escapeHtml(heading)}</h1>
    <p>${escapeHtml(body)} ${escapeHtml(link)}</p>
  </body>
</html>
`;
};

export default html;
