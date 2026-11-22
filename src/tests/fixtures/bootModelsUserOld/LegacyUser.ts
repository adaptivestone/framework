import UserOld from '../../../models/UserOld.ts';

// An app model built on the deprecated `UserOld`: constructing it at boot must
// emit the UserOld deprecation warning.
export default class LegacyUser extends UserOld {}
