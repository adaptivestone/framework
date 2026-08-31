import type { TEmailTemplate } from '../../types.ts';

const subject: TEmailTemplate = ({ t }) =>
  t('email.emailConfirm', { defaultValue: 'Email confirmation' });

export default subject;
