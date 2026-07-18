# P1t — Document typed rate-limit policies from application config

**Status**: ✅ direction settled 2026-07-18 · documentation not written
**Target**: documentation/example update; no framework runtime release required
**Depends on**: existing `RateLimiter` parameter merge and shipped config-shape codegen
(`genTypes.d.ts`)
**Origin**: controller-specific rate limits currently repeat anonymous option objects. The
framework already has every runtime and typing primitive needed to keep those options in config.

## Decision

This is a consumer configuration recipe, not a new framework feature. Policies are ordinary
objects in the application's `rateLimiter` config. A controller reads the final merged config and
passes the selected object through the existing middleware tuple. `RateLimiter` already deep-merges
tuple parameters over its global config, and `genTypes.d.ts` already preserves policy property
names.

```ts
// config/rateLimiter.ts
import defaults from '@adaptivestone/framework/config/rateLimiter.js';

export default {
  ...defaults,
  policy: {
    loginAttempt: {
      limiterOptions: { points: 3, duration: 60 * 60 },
    },
  },
};
```

```ts
import { getAppInstance } from '@adaptivestone/framework/helpers/appInstance.js';
import RateLimiter from '@adaptivestone/framework/services/http/middleware/RateLimiter.js';

const app = getAppInstance();
const { policy } = app.getConfig('rateLimiter');

export default class AuthController extends AbstractController {
  static get middleware() {
    return new Map([
      ['POST/login', [[RateLimiter, policy.loginAttempt]]],
    ]);
  }
}
```

`genTypes.d.ts` already preserves object keys from the consumer's merged configuration, so
`policy.loginAttempt` is autocompleted and a misspelling fails TypeScript. The tuple
contains the actual options object; no policy-name lookup happens inside `RateLimiter`.

## Existing behavior used by the recipe

- Framework defaults and application/environment config are merged before auto-loaded controller
  modules are imported. The selected policy therefore contains the effective environment values,
  not a separately imported base-config snapshot.
- Policy names should be declared in the base application config. Environment files override
  their values; they should not define a different policy catalogue.
- Configuration is boot-time state. A later `app.updateConfig()` does not mutate already-created
  limiter instances; live rate-limit reconfiguration is unchanged.
- The current `deepmerge` behavior concatenates arrays. The common policy case changes scalar
  limiter options (`points`, `duration`) and needs no caveat. If a policy overrides an array such as
  `consumeKeyComponents.request`, documentation must explain that it extends the global array
  rather than replacing it.
- TypeScript catches a misspelled property after `npm run gen`. Plain JavaScript does not: an
  undefined tuple parameter currently falls back to global rate-limit options. Runtime validation
  could be proposed separately if a real JavaScript consumer needs it; it is not required for this
  typed configuration recipe.

## Documentation work

- Add a rate-limit policy recipe to the consumer documentation.
- Add `src/config/rateLimiter.ts` to the example project with one clearly named policy.
- Show controller selection through `policy.someName` and remind users to run `npm run gen`.
- Explain base-config policy names, environment value overrides, boot-time capture and array merge
  behavior.
- No framework source, package export, changelog, or framework test changes.

## Out of scope

- Framework-exported policy constants/tokens or `RateLimiter.policy(name)`.
- A global named-policy registry or string lookup at request time.
- Changes to `RateLimiter`, middleware tuple normalization, or config codegen.
- Runtime policy mutation/hot reload.
- Distributed rate-limit administration or a management UI.

## Done when

- Documentation and the example use `policy.someName` from typed merged config.
- `npm run gen` makes a misspelled policy property a TypeScript error.
- The example needs no custom `ConfiguredRateLimiter` subclass or framework runtime change.
- Merge/lifecycle limitations are explicit rather than promised away by new machinery.
