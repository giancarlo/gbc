# Product Direction

GB is a concise, type-safe functional language targeting WebAssembly. The current goal is technical value: a coherent, safe, readable, and performant language with minimal compiler machinery.

## Priorities

1. Correctness, memory safety, and regressions in implemented behavior.
2. Foundational language and standard-library work that removes compiler special cases or unlocks multiple features.
3. Diagnostics and test tooling that shorten development and debugging.

[`compiler/test.ts`](compiler/test.ts) is the normative executable language specification.
