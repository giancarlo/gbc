# Product Direction

GB is a concise, type-safe functional language targeting WebAssembly. The current goal is technical value: a coherent, safe, readable, and performant language with minimal compiler machinery.

## Priorities

1. Correctness, memory safety, and regressions in implemented behavior.
2. Foundational language and standard-library work that removes compiler special cases or unlocks multiple features.
3. Diagnostics and test tooling that shorten development and debugging.
4. Modules, CLI, host integration, and reproducible package distribution.
5. New features only when an existing limitation demonstrates their need.

Prefer tasks with measurable acceptance criteria that simplify the language or compiler and unblock current work. Monetization and speculative feature breadth are not priorities.

## Sources

- [`compiler/test.ts`](compiler/test.ts) is the normative executable language specification.
- [`docs/potential-features.md`](docs/potential-features.md) contains deferred ideas, not roadmap commitments.
