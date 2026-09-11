import { appInstance } from '@adaptivestone/framework/helpers/appInstance.js';
import type { TUser } from '@adaptivestone/framework/models/User.js';
import type UserOld from '@adaptivestone/framework/models/UserOld.js';
import type { IApp } from '@adaptivestone/framework/server.js';
import type { FrameworkRequest } from '@adaptivestone/framework/services/http/HttpServer.js';
import type { BaseRequestContext } from '@adaptivestone/framework/services/http/types.js';
import type { TI18n } from '@adaptivestone/framework/services/i18n/I18n.js';
import ValidateService from '@adaptivestone/framework/services/validate/ValidateService.js';

// Match the resizer's helper -> IApp -> HTTP/i18n declaration chain, and check
// the public request, validator and user mail surfaces in the installed dist.
const app: IApp = appInstance;
const service = await app.getI18nService();
const translator: TI18n = await service.getI18nForLang('en');
const plain: string = translator.t('app.title');
const fallback: string = translator.t('app.title', 'Example');
const interpolated: string = translator.t('app.title', {
  defaultValue: 'Hello {{name}}',
  name: 'Ada',
});
await new ValidateService(app, null).validate({}, translator);
const base = await service.getI18nBaseInstanceIfAvailable();
if (base) {
  const supported: boolean = base.services.languageUtils.isSupportedCode('en');
  const clone: TI18n = base.cloneInstance({ lng: 'en', initAsync: false });
  void [supported, clone];
}

// The public translator must retain useful types rather than degrade to any.
// @ts-expect-error a translation key must be a string or array of strings
translator.t(123);
// @ts-expect-error ordinary translations return strings
const numeric: number = translator.t('app.title');
// @ts-expect-error object results require narrowing
const objectAsString: string = translator.t('app.group', {
  returnObjects: true,
});
// @ts-expect-error detailed results require narrowing
const detailsAsString: string = translator.t('app.title', {
  returnDetails: true,
});

declare const request: FrameworkRequest;
declare const context: BaseRequestContext;
declare const user: InstanceType<TUser>;
declare const legacyUser: UserOld;
request.appInfo.i18n = translator;
context.appInfo.i18n = translator;
const recovery: Parameters<typeof user.sendPasswordRecoveryEmail>[0] =
  translator;
const verification: Parameters<typeof user.sendVerificationEmail>[0] =
  translator;
const legacyRecovery: Parameters<
  typeof legacyUser.sendPasswordRecoveryEmail
>[0] = translator;
const legacyVerification: Parameters<
  typeof legacyUser.sendVerificationEmail
>[0] = translator;
void [recovery, verification, legacyRecovery, legacyVerification];
void [plain, fallback, interpolated, numeric, objectAsString, detailsAsString];
