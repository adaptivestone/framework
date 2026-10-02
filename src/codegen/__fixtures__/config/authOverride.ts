// An app config that overrides the framework `auth` config by spreading it:
// `saltSecret` (an env read) lives only in the framework file.
import originalAuth from '../../../config/auth.ts';

export default {
  ...originalAuth,
  isAuthWithVerificationFlow: false,
};
