import { escapeHtml } from '../../escapeHtml.ts';
import type { TEmailTemplate } from '../../types.ts';

const html: TEmailTemplate = ({ t, link }) => {
  const title = t('email.emailConfirm', { defaultValue: 'Email confirmation' });
  const heading = t('email.verify', { defaultValue: 'Verify email' });
  const body = t('email.verifyInstructions', {
    defaultValue: 'To verify your email address, follow the link:',
  });
  const href = escapeHtml(link);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <h1>${escapeHtml(heading)}</h1>
    <p>${escapeHtml(body)} <a href="${href}">${href}</a></p>
  </body>
</html>
`;
};

export default html;
