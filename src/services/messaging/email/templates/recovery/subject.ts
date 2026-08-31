import type { TEmailTemplate } from '../../types.ts';

const subject: TEmailTemplate = ({ t }) =>
  t('email.passwordRecovery', { defaultValue: 'Recovery password' });

export default subject;
