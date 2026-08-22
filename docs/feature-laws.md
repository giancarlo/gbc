# GB Feature Design

Use these checks before finalizing a language or standard-library feature.

## Constitution

1. **One Way:** Restrict multiple ways to accomplish the same task.
2. **Built-in Best Practices:** Enforce optimal patterns through syntax and types. Enforcement is binary: valid or a compile error, never a warning.
3. **Transparency:** No hidden or implicit behavior.
4. **Defined Behavior:** Valid GB code has defined semantics. Invalid operations are rejected or fail in a specified way.
5. **No Bloat:** Only essential features.
6. **Readable:** Prioritize clarity.
7. **Performant:** Adapt the language when code generation requires it.

## Feature Laws

Before finalizing a design:

- [ ] **Need:** Does it solve a demonstrated problem?
- [ ] **Reuse:** Can an existing mechanism solve it?
- [ ] **Canonical form:** Does it avoid another way to do the same thing?
- [ ] **Syntax budget:** Does new syntax express semantics unavailable through existing syntax?
- [ ] **Enforcement:** Are invalid uses compile errors, not warnings?
- [ ] **Diagnostics:** Does every new rejection produce a precise, actionable compile error?
- [ ] **Compile-time prevention:** Is every source-provable failure a compile error?
- [ ] **Semantics:** Are all valid cases defined and all remaining failures specified?
- [ ] **Structural semantics:** Is behavior determined by syntax, types, and contracts rather than names, callee identity, or compiler special knowledge?
- [ ] **Generality:** Does it follow general language rules rather than add special cases?
- [ ] **Composition:** Does it obey the same rules through calls, pipes, generics, recursion, ownership, and modules?
- [ ] **Intrinsics:** Does the standard library use the minimum compiler intrinsics, with each justified by correctness, safety, host access, or code generation? Can this feature remove one?
- [ ] **Intrinsic boundary:** Is only the irreducible operation compiler-provided, with its interface, type checks, and surrounding logic expressible in GB?
- [ ] **Code generation:** Can it compile efficiently without disproportionate machinery? If not, should costly scenarios be compile errors?
- [ ] **Scope:** Are canonical scalar and core-data operations top-level, and specialized operations namespaced?
- [ ] **Extension:** When behavior shares a top-level function's semantics, does it extend that function rather than introduce another name?
- [ ] **Construction:** Does a factory use its result type's constructor when that preserves its semantics?
- [ ] **Specification:** Are valid behavior and invalid cases captured by executable language rules?
