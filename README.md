# Adaptive stone node js framework

[https://framework.adaptivestone.com/](https://framework.adaptivestone.com/)

## Generated types

Run `npm run gen` to (re)generate `genTypes.d.ts` and per-controller
`*.routes.gen.ts` files. These are gitignored; regenerate them after pulling.

In CI, guard against stale/missing generated types with:

```sh
node cliCommand.ts generatetypes --check
```

It writes nothing and exits non-zero if any generated file is out of date.
