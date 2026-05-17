## Hello World

This is a sample of a simple "Hello World" program. The _main_ block is our entry point. No code is allowed outside of it other than type and function definitions. The standard library is always available through the _@_ operator. The pipe `>>` operator will call the `@.out` function passing its left value as an argument.

```
main { 'Hello World' >> @.out }
```

## Links

-   [Language Spec (test.ts)](https://github.com/giancarlo/gbc/blob/main/compiler/test.ts) — the normative spec
-   [Design Decisions](https://github.com/giancarlo/gbc/blob/main/docs/decisions.md) — rationale behind language design choices
-   [Potential Features](https://github.com/giancarlo/gbc/blob/main/docs/potential-features.md) — deferred and unsettled designs
