# Design Decisions

Source of truth for language design rationale. Decisions and their alternatives.
Spec (tests + `p:` descriptions): `compiler/test.ts`. This doc explains *why*.

## Constitution

- **P1 OneWay** — restrict multiple ways to do the same task
- **P2 BestPractices** — enforce optimal patterns via syntax/types
- **P3 Transparency** — no hidden or implicit behavior
- **P4 NoBloat** — only essential features
- **P5 Readable** — prioritize clarity
- **P6 Performant** — language adapts when codegen needs it

## Format

Per decision: rule, `+` pros, `-` cons, `×` rejected alternative(s).
Principle refs in parens. Compact intentionally.

## Meta

- **`compiler/test.ts` is normative.** This file (`decisions.md`) explains the *why* behind those decisions. `potential-features.md` lists deferred or unsettled design ideas.
- **`ast:` field in tests** is internal verification, not part of the language. Parser internals may rename AST tags without changing the language.
- **`p:` descriptions** are the prose spec.

---

## D1: Labels in data blocks use `name = value`

`[ x = 1, y = 2 ]`. Bare identifier on LHS of `=` inside `[]` declares a label.

- \+ Reuses `name = value` pattern from var defs and named args (P1 at higher level)
- \+ Light syntax (P5)
- − `=` is context-interpreted (scope binding in `{}`, label in `[]`, named arg in `()`)
- × `:label = value` — sigil overhead, no atom-literal collision to avoid

## D2: Labels alias positions (compile-time only)

`[ x = 1, y = 2 ].x` ≡ `.0`. Labels are names for indices; erased at runtime.

- \+ Matches "data = memory" model (P3)
- \+ Single addressing concept (P1, P4)
- × Labels as separate namespace — bloat, confusion

## D3: Mixed labeled/positional fields allowed anywhere

`[ 1, x = 2, 3 ]` legal. Indices count up regardless of labels.

- \+ Simplest rule (P4)
- − Mixed forms harder to scan (minor P5 ding)
- × Labels-must-come-last — extra ordering rule

## D4: Label names must be unique within a block

`[ x = 1, x = 2 ]` is a compile error.

- \+ Required by D2 (labels are unique aliases for positions)

## D5: Numeric position access via `.N` (no `[i]` indexing)

`[10, 20, 30].1 == 20`. Right side of `.` is identifier (label) or integer literal (position).

- \+ Single access operator (P1)
- \+ Reinforces D2: `.N` is canonical, `.label` is sugar when label aliases N
- \+ No `[i]` syntax (P4)
- \+ Forces compile-time-known indices — aligns with "data = memory"
- − No runtime computed access (must use sequences/pipes for dynamic traversal)
- × `block[i]` — overloads `[]` with indexing, adds bloat

## D6: `var` is a type modifier (not binding modifier)

Form: `x: var = 10`, `(p: var Int)`, `[ name: var = 'Alice' ]`.

- \+ Subsumes binding/param/field mutability under one concept (P1)
- \+ Function signatures express mutability contracts (P3)
- \+ Type aliases can be mutable (e.g. `type Counter = var Int`)
- − Muscle memory cost — programmers expect `var x = 10`
- − `x: var = 10` (inferred type) looks visually empty
- × `var x = 10` binding-modifier — can't express mutability in signatures
- × Type-modifier + `var x = 10` sugar — two ways (P1 violation)

## D7: Annotated field name is optional

`[ :var = 10 ]` and `[ name: var = 10 ]` both legal. Same applies to `[ :Int = 10 ]`.

- \+ Symmetric — positions are first-class addresses
- \+ Single grammar rule (`name?: type = value`) — fewer productions (P4)
- \+ Enables anonymous mutable cells / positional type assertions
- − Form `:var` reads less naturally than labeled form (minor P5)
- Note: no atom-literal collision — source has no `:atom` syntax

## D8: `>>` passes data blocks as whole values; `each` iterates

`[1, 2] >> f` calls `f([1, 2])`. `[1, 2] >> each >> f` calls `f(1)` then `f(2)`.

- \+ Pipe semantics don't depend on LHS type (P1, P3)
- \+ Resolves tuple-passing ambiguity (`[1,2] >> processTuple` is unambiguous)
- \+ Iteration is explicit at call sites (P3)
- − Slight stdlib bloat (`each` exists)
- × Auto-iterate data blocks through `>>` — would make pipe LHS-type-dependent

## D9: Labels are erased during iteration

`[ x = 1, y = 2 ] >> each` yields 1, 2 (not (label, value) pairs).

- \+ Labels are compile-time only (D2); runtime sequences carry values

## D10: Data blocks flatten — no runtime nesting

`[ [1, 2], [3, 4] ] == [ 1, 2, 3, 4 ]`. Nested literals are syntactic, not structural.

- \+ "Data = memory" interpreted strictly (P3)
- \+ Extension of singleton-collapse rule `[10] == 10`
- \+ Forces nesting through named types (`type Matrix [ row0: [Int, Int], ... ]`) (P2)
- − Nested literal *looks* structured but flattens (potential footgun; mitigated by typed declarations)
- × Preserve runtime nesting — collection-language semantics, contradicts "data = memory"

## D11: `()` for function calls (no juxtaposition)

`f(x, y)` is a call; `f x y` is not.

- \+ Unambiguous parse (P3)
- × Juxtaposition `f x` — ambiguous without currying (`f g h` has no unique parse)
- × `f[args]` only — eliminates `f(x + 1)` form for grouped expressions

(Statement separation: see D30. The earlier "no required statement delimiters" claim is superseded.)

## D12: Function calls take exactly one arg = a data block

`f(a, b)` is sugar for `f([a, b])`. `f()` passes `[]`. Single-arg `f(x)` passes `[x]`.

- \+ Param destructuring (`(a, b)`) reuses data-block label semantics (P1)
- \+ Named args (`f(b = 1, a = 2)`) fall out for free
- See D8 for relationship to `>>` semantics

## D13: Case determines value-vs-type (enforced)

Lowercase ident = value name (`x`, `count`). Uppercase ident = type name (`Int`, `Point`).

- \+ At any source position, value-vs-type is determinable by case alone (P3)
- \+ Parser commits early at type vs expression positions
- \+ Built-in rule, not convention (P2)
- − Muscle memory cost (C-family programmers write lowercase types)
- × Convention only — loses enforcement, easy to drift

## D14: Built-in type names

Integer types: `Int8`, `Int16`, `Int32`, `Int64`. Unsigned: `Uint8`, `Uint16`, `Uint32`, `Uint64`. Floats: `Float32`, `Float64`. Others: `String`, `Bool`, `Void`, `Error`, `Fn` (as type).

**No bare aliases** — no `Int`, `Uint`, `Float`, or `Byte`. Precision is always explicit at type-annotation sites. (Integer literals like `42` have unsized type until inferred from context, Rust-style. A "byte" is just `Uint8`.)

- \+ P3 Transparency — every typed binding shows its storage width
- \+ P4 NoBloat — one canonical name per type, no platform-dependent aliases
- \+ Avoids "what size is `Int`?" question entirely
- − Minor verbosity (`Int32` vs `Int`)
- `Bool` over `Boolean` — shorter, matches Rust/Haskell/Swift
- Keywords are lowercase too but aren't type names (the keyword set is normative in `test.ts`).

## D15: Built-in special values are lowercase

`true`, `false`, `nan`, `infinity`. (Was `NaN`; changed for consistency.)

- \+ All value-position tokens follow the same case rule (D13)
- − Breaks JS naming for `NaN`/`Infinity`

## D16: Two body forms — auto-emit expression list vs statement body

A code block `{ body }` (optionally prefixed with params `(a, b) { body }`, D12) has two non-overlapping forms, distinguished by **content**, not a keyword:

- **Auto-emit list** — comma-separated value-expressions, each auto-emits: `{ a, b, c }`. Empty `{}` is the canonical no-op (zero emissions). No statements; `next`/`done` not allowed.
- **Statement body** — statements separated by `;`, emission via explicit `next`: `{ x = a*2; next x; }`. Must produce at least one emission.

(There is no `fn` keyword — D41. The param prefix `(a, b)` destructures `$` into named locals per D12; its presence is orthogonal to which body form is used.)

- \+ P1: the two forms are non-overlapping; P3: every emission visible (comma vs `next`)
- \+ no multi-emission surprise — commas are explicit, refactoring can't sneak in extra emissions
- × `=> expr` arrow form (potential-features.md) — third auto-emit way, P1; auto-emit inside statement bodies — multi-emission surprise; `{}` allowing statements — ambiguous what yields

## D17: Unified emission semantics

Every emission site (auto-emit list, `next` in a statement body, pipe-stage output, D16) follows one rule: if the value is a **sequence** (the output of executing a code block), iterate it and emit each element; otherwise emit it whole. Only sequences are iterable this way — data blocks pass as single values (D8); iterate one with `each`.

**`next` syntax**: `next expr` emits one value; `next(a, b, c)` emits each separately. `next` has lowest precedence — it captures the whole following expression.

**Propagation**: `next x` emits to the nearest enclosing function (`?:`/`loop` don't create new targets). Inner calls don't auto-propagate — re-emit a generator's values with `next inner()`. A block nested in a block is a value, not invoked.

- \+ P1: one rule, all sites; P3: "iterate sequences, emit else whole" is uniform, data blocks keep whole-value semantics (D8)
- \+ `next` low-precedence avoids paren-induced bugs

## D18: `loop` is a primitive emitter; `done` and `break` have distinct scopes

**`loop`** — primitive infinite emitter. Yields successive integers (0, 1, 2, ...) at the source level. Used as a pipe source: `loop >> stage1 >> stage2 >> ...`. There is no `loop { body }` block form.

**`done`** — exits the nearest enclosing statement-body function. Ends that function's emission sequence. Other pipe-stage invocations of it still run for subsequent upstream values.

**`break`** — stops the nearest enclosing *pipe chain*. Upstream emitters (including `loop`) are cancelled; downstream stages stop receiving values. Compile error if `break` appears outside a pipe stage.

**Compiler handles fusion**: for the common case `loop >> { ... } >> ...`, the compiler emits a tight imperative loop (WASM `(loop ... br_if ...)`). For non-fusable cases, runtime coroutine/state-machine support is used.

**Why this design:**
- \+ One iteration primitive (P1)
- \+ `done` (sequence-end) and `break` (chain-stop) are non-overlapping scopes (P3)
- \+ `loop` as emitter composes with stdlib stages (`take`, `takeWhile`) without special language machinery
- \+ Pull-based pipeline naturally propagates `break` upstream
- × Imperative `loop { body }` block — loses the elegance of `loop >> stage`; also forces a "loop" keyword that's both control flow AND value (the emitter), violating P1
- × Single keyword (`done` = both fn-exit AND chain-stop) — context-dependent meaning, P3 violation
- × Auto-iterate data blocks (would conflict with D8)

**Implementation cost**: pipe-fusion is non-trivial. For initial implementation, lazy/coroutine fallback works in both JS (native generators) and WASM (state machines or with the exception/stack-switching proposals). Fusion is an optimization for tight loops.

## D19: Field access on `$` uses `$.name` only

`$.name` is the canonical form. No `$name` shorthand.

- \+ One Way ✓ — same field-access pattern (`.label`) as on any other data block (D5)
- − Slightly more visual noise in math-heavy pipe stages (`$.a + $.b * $.c`)
- × `$name` shortcut — two ways to access the same thing (P1 violation)
- × `$` accessible only via destructured params — too restrictive; kills inline pipe-stage form

## D20: No `$: T` parameter form

Typed params use the named form `(a: T)` / `(a, b)` (D16). There is no `($: T)` form — `$` is always implicitly the call argument (D12), so naming it adds nothing.

- \+ P1: one typed-arg syntax; `($: T)` would duplicate `(name: T)`

## D21: `is` operator for type tests + narrowing — RETIRED

> **Retired by D55** — the `is` operator and flow-narrowing are removed. Type dispatch (`v >> T { … } | … `) is the sole union-discrimination mechanism; the truthy-branch narrowing below was never implemented and is redundant with dispatch. The body is kept for reference.

`value is Type` is a binary operator returning `Bool`. In the truthy branch of a conditional, the operand's type is narrowed to the tested type.

```
v: Int32 | String = ...
v is Int32 ? next v * 2 : next length(v)
# In the truthy branch, v has type Int32 (narrowed from Int32 | String).
```

- \+ P1 ✓ — single dispatch mechanism (ternary + `is`); no separate `match`/`switch` construct
- \+ P3 ✓ — narrowing is visible at the use site (`is Int32`); no scattered type guards
- \+ P4 ✓ — one operator covers union narrowing without first-class types or per-type stdlib functions
- \+ RHS uses type-position syntax (uppercase per D13) — no need for types-as-values
- × `match` keyword + pattern syntax — bigger surface area, full pattern matching is significant compiler work
- × Per-type narrow functions (`isInt32`, `isString`) — fixed-list bloat, doesn't extend to user-defined types
- × Types as first-class values — large language commitment for marginal additional capability

**Implementation cost**: type-flow analysis in the checker. Required for any union-narrowing approach, not unique to `is`.

## D22: Modules are file-scoped; `export` is an inline modifier; `@` is the external-module operator

**Module = source file.** Top-level declarations (definitions, type aliases, optional `main` block) live at file scope. No "module-as-code-block" wrapping.

**`export` is an inline modifier** on declarations:
```
export helper = (x: Int32) { next x * 2 }
export type Point = [ x: Int32, y: Int32 ]
```

**`@module.name` accesses an external module's exported member** — the identifier after `@` is the module name. `@` has exactly one meaning: cross-module access. The standard library is *not* under `@` (see D46) — it is a global prelude with bare names.

- \+ Inline `export` is co-located with definitions (P3); refactoring-safe
- \+ Maps directly to WASM's `(export "name" ...)` per-entry mechanism
- \+ File-scoped modules avoid block-execution semantics for imports
- \+ One meaning for `@` (external boundary), no stdlib/module dual-form to disambiguate (P1)
- × Modules-as-code-blocks — elegant unification, but conflicts with WASM's flat-export model and adds import-memoization complexity
- × Standalone `export [list]` — redundant naming, drifts independently of definitions
- × `@.name` for stdlib (earlier design) — overloaded `@` with two meanings; superseded by the global prelude (D46)

## D23: Errors are values; chain-routed propagation — RETIRED

> **RETIRED (2026-06-29)** — the error pipeline (this + D24 + D25) is dropped. Union-typed error values (`DivByZero` and friends via D31/D56) cover the routing need: an error is an ordinary union member, routed by the existing `|`-dispatch (D55 chain dispatch), with no dedicated chain-routing rule, auto-filled `id`, or `catch` modifier. (Error **stack capture** is *not* abandoned — a `stack: Frame` payload is still wanted, tracked separately in `docs/todo.md` → `Errors`.) Body kept for reference.

Type `Error` is built-in (D24). Functions emit errors via `next Error('code')`. The pipe `>>` dispatches by stage parameter type:
- `(T)` stage — non-T inputs route past, looking for a stage that accepts them
- `catch(T) (T): U` stage (D25) — consumes T from chain inputs; downstream type replaces T with U

Errors travel only along `>>` chains — no stack unwinding. The compiler enforces handling: a chain producing a union type must reach a stage that accepts/catches each variant before any consumer that rejects it.

- \+ P1 ✓ one mechanism (chain dispatch by param type) handles errors and any other filtered type
- \+ P3 ✓ errors travel along visible `>>`; no invisible flow
- \+ P4 ✓ no `try`, `throw`, `?`, or `Result` wrapper
- \+ Avoids Go's silent skip (compiler-enforced), Rust's `?` clutter (chain auto-routes), Java's `throws` lists (single Error type per D24), exception-style invisible flow
- − Pipe semantics include param-type routing — slightly richer than plain "call next stage"
- × Stack-unwound exceptions — invisible control flow
- × `Result<T, E>` + `?` operator — second control-flow path, boilerplate at every call
- × Hidden auto-propagation through `(T)` stages without a marker — type-signature dishonesty; replaced with explicit `catch` modifier per D25

## D24: Built-in `Error` type with auto-filled id and stack — RETIRED

> **RETIRED (2026-06-29)** — the error pipeline (D23 + this + D25) is dropped; see D23 for rationale. The auto-filled-`id` model below was already superseded by D50's nominal errors. The **stack** half is *not* abandoned: a `stack: Frame` payload on `Error` is still wanted (tracked in `docs/todo.md` → `Errors`); only the `id` / auto-routing / `catch` machinery dies. Body kept for reference.

`Error` is a built-in type with shape:

```
type Frame = [ function: String, file: String, line: Int32 ]
type Error = [ id: String, stack: Array<Frame> ]   # Array<T> per D36
```

Constructed and emitted via the `error` keyword (D34):

```
error 'NOT_FOUND'    # emits Error with id = '<currentModule>/NOT_FOUND', stack captured here
```

The compiler synthesizes `id = @.module + '/' + code` and `stack = @.captureStack()` at the `error` site. User code cannot construct an Error via a plain typed data block — the auto-fields require compiler involvement.

Discrimination is via string equality on `id`:

```
catch (e: Error): Int32 { next e.id == 'parser/NOT_FOUND' ? 0 : -1 }
```

- \+ Module-qualified id avoids cross-library code-name collisions
- \+ Stack auto-captured at construction — debuggable by default (P3)
- \+ Single, non-extensible Error type — avoids per-library error proliferation
- \+ Discrimination uses existing `==` and field access — no new is-pattern syntax
- \+ Built-in keyword keeps Error consistent with other chain-control primitives (D34)
- − Stack capture adds runtime cost at every Error construction
- − Error is "more special" than user types (built-in keyword)
- × Bare code-only id (no module) — risks collisions between modules using same code string
- × User-extensible Error hierarchy — error-type proliferation
- × `is Error('CODE')` literal-type narrowing — extra type-system surface; equality on id is enough

## D25: `catch(T)` — parameterized type modifier for chain handlers — RETIRED

> **RETIRED (2026-06-29)** — the error pipeline (D23 + D24 + this) is dropped; see D23. There is no `catch` modifier — union variants are consumed by ordinary `|`-dispatch arms (D55). Body kept for reference.

`catch(T)` is a type modifier on function types (parallels `var` per D6). It marks a function as a chain handler that consumes type T.

```
handler: catch(T) (T): U         # full form (function type per D41)
handler: catch (Error): U        # `catch` is sugar for `catch(Error)`
handler = catch { body }         # value sugar; type inferred from body
```

In a chain, a `catch(T) (T): U` stage consumes T values; downstream type loses T and gains U. Non-T inputs route past unchanged.

Re-throw via return type:
- `catch(T) (T): U` — always replaces T with U; chain loses T downstream
- `catch(T) (T): U | T` — may re-throw T; chain keeps T downstream, needs another handler

Plain `(T): U` without catch — callable directly, but rejected as a pipe stage when T is live in the chain and no catch handler exists.

- \+ P1 ✓ single mechanism (`catch(T)`) for all chain consumption; Error stops being special
- \+ P3 ✓ modifier visible in the function's type signature
- \+ P4 ✓ parallels `var` modifier — no new keyword class
- \+ Composable — handlers are values; storable, passable, higher-order
- \+ Future-proof — signal/control types (Stop, Retry, Cancel) fall out without new keywords
- × `catch { body }` as a non-value syntactic form — non-composable
- × Stdlib `@.catch(handler)` as canonical — works but requires the helper for the inline case
- × Error-specific catch with no parameterization — Error special-cased; not extensible

## D26: Types are callable as constructors — REVIVED (2026-06-03)

A type used as a call target is a **constructor**: `T(x)` converts/constructs a `T`. Restored after being retired — the retirement rationale (the `error` keyword, D34) is itself superseded (errors are now structural-nominal, D50; `error` retired), and a new use case is decisive: **scalar narrowing**. `Uint8(48 + n)` produces a byte with no ascription syntax and no special coercion rule — you call the type. It's the general mechanism the byte-block string model needs (`char` is just `Uint8`; `'h'` ≡ `Uint8`).

Scope: **scalar types** convert/narrow (`Uint8(x)` = `x & 0xFF`, `Int8(x)` sign-extends via `<<`/`>>`, `Float64(n)` widens, `Int32(f)` truncs). **Function types are NOT constructors** — a signature describes shape, not a value (`Adder(5)` → "not callable"). **Data/nominal types** (`Point(x, y)`, error ctors) construct + stamp identity — the natural generalization (codegen pending). Mechanism (no D26-era ambiguity): a type-name callee parses as a `typeident` (kept *out* of the value namespace, so no collision with type-prefix syntax `T { body }`); the checker treats a non-function `typeident` callee as construction (result type = the type); codegen converts. Typed data blocks `[args]: T` remain valid too.

## D27: Type body block form — RETIRED

Withdrawn with D26. Its only use case (Error's computed fields like auto-`id` and auto-`stack`) is now handled by the compiler-implemented `error` keyword (D34). User-defined types use the short-form data-shape syntax `type T = [fields]`; "construction with logic" is a regular factory function returning the type.

## D28: Modules are types — RETIRED

Withdrawn with D27. Modules return to D22's namespace model: a file is a module, top-level `export` marks public decls, `@module.name` is namespace lookup. The "modules as singleton-instance of an implicit type" formulation depended on type-body form (D27) which is now retired.

## D29: `T[]` — homogeneous variable-length data block — RETIRED

Retired by **D36**: variable-length collections moved to stdlib `Array<T>`. Data blocks are now strictly fixed-shape tuple storage. The original D29 conflated "fixed tuple" and "variable collection" into one concept; D36 splits them.

Original (for reference): `T[]` was data block syntax for variable-length homogeneous storage.

## D30: Statement separation — `;` ends every statement except function-literal and `main` blocks

At statement contexts (module body, function body, `main {...}` body):
- **Rule**: a statement that is itself a function literal (`fn` AST node) or `main` block is self-terminating; every other statement needs a trailing `;`, including the last in a block. Decided on AST kind alone — no source/token-history lookup.
- `;` after such a block is a parse error.
- A `def` whose value is a function/`{}` literal is still a `def`, so it ends with `;`. The sequence `};` is valid — the `}` is the inner block's, the `;` the outer statement's.

`,` separates items in expression contexts (data blocks D10, args D12, auto-emit list D16). Newlines are insignificant.

```
helper = (x) { next x * 2; };   # def → trailing `;`
a = 10;                          # `;`
c = helper(a) + b(5);            # ends with `)` → `;`
main { 'hello' >> out; }       # no `;` after `}`; inner pipe stmt needs `;`
```

Supersedes D11's "no required delimiters" parenthetical.

- \+ P1: one rule; P3: every boundary is a visible token (`;`, or the block's `}`)
- \+ Cross-platform consistent — no CRLF/LF/CR variance
- \+ Auto-formatters and editors can reflow freely without changing semantics
- \+ Parser-implementable on AST kind alone — no source/token-history coupling
- − Top-level defs whose values are function literals end with `};` (the `}` is the inner literal's, the `;` is the outer def's)
- × "Last token is `}`" framing (original D30) — required source-string lookup or a recursive AST walk to decide; messier implementation, no clearer semantics
- × Optional `;` (D11's original wording) — ambiguity costs (empirical: JS ASI bugs)
- × Significant newlines as separators — line-ending variance, tooling fragility, Python-style indentation issues

## D31: Arithmetic safety — Int division returns `T | Error`; Float follows IEEE

> **Revised by D50** — the error variant is now a nominal error type (`type DivByZero = Error`), not the string-keyed `Error('div-by-zero')` shown below; the union reads `Int32 | DivByZero`. The const-folding narrow rules carry forward unchanged.

Integer division (`/`) and modulo (`%`) over integer operands return `Int32 | Error` (or analogous union for other Int widths). The Error constructor follows D24 — `Error('div-by-zero')`.

Float division and modulo over float operands return the float type unchanged; IEEE semantics apply — `infinity`, `-infinity`, `nan` are legitimate Float values, not Error.

**Const-folding narrow**: when the RHS of `/` or `%` is a literal known to be non-zero at compile time (e.g. `n % 15`, `x / 2`), the return type narrows from `Int32 | Error` to `Int32`. Runtime-divisor expressions (`a / b` where `b` is not a literal) keep the union.

Overflow on `+`, `-`, `*` is not covered by this decision; see future work.

- \+ P3 ✓ failure mode visible at the use site via return type
- \+ P2 ✓ Int div/mod by zero must be handled or narrowed
- \+ No "panic" concept needed; errors stay as values (D23 fits cleanly)
- \+ Float math stays ergonomic — IEEE is well-understood
- \+ Const-folding narrow keeps math-by-literal code clean
- − Int div by runtime values outside chains needs `is Error` narrowing or `@.unwrap`
- × Panic / trap on Int div-by-zero — would require a "panic" concept distinct from Error; conflicts with errors-as-values
- × Always silent (Pony-style return 0) — hides bugs
- × Float `/` returning `Float64 | Error` — IEEE values aren't errors; forcing handling on them is wrong
- × Two operators (`/` checked, `/!` unchecked) — P1 violation; parallel mechanism for the same op

## D32: Tail calls in tail position are guaranteed not to grow the stack

The compiler emits proper tail calls (WASM `return_call` / `return_call_indirect`) for any function call in tail position. Tail position is defined as:
- The expression argument to the last `next` statement in a statement-body function
- Either branch of a ternary whose result is in tail position
- The final stage of a pipe chain in tail position

Recursive functions written tail-recursively never stack-overflow, regardless of input size.

- \+ P2 ✓ correct optimization by default; idiomatic recursion is safe
- \+ P3 ✓ tail-position semantics specified at language level, not a compiler quirk
- \+ WASM tail-call proposal is shipping (V8, SpiderMonkey, JSC); runtime support is real
- − Compiler complexity (analyze tail position, emit `return_call`). Moderate but not prohibitive for a WASM-targeted compiler — roughly an analysis pass and a codegen switch.
- × Annotation-required TCO (`@tailrec`) — opt-in friction; mistakes silently stack-overflow in unmarked functions
- × Best-effort TCO — can't rely on it for correctness; users avoid recursion defensively

## D33: `?:` is a value-ternary; `break`/`done` admitted as bottom-typed branches

`?:` is a value-ternary expression. Both branches are required. Branches of differing value types form a union of those types (D56) — mixing types is allowed; the early "forbid mixed-kind" note is superseded by union types. **Exception**: `break` and `done` (control-flow keywords that never return) may appear in either branch. They are bottom-typed — the result type is determined by the non-bottom branch (or is bottom itself if both are).

**Constant conditions are an error.** If the condition is a compile-time constant — a literal (`1`, `true`) or a constant-foldable comparison (`1 < 2`) — one branch is statically unreachable dead code, and the ternary is rejected (`` `?:` condition is a compile-time constant; one branch is dead code ``). This mirrors the unconsumed-value / dead-code rule applied elsewhere. Conditions that depend on a runtime value (`b ? …`, `$ >= n ? …`) are unaffected.

`next` is **not** allowed inside `?:` branches (statement-only); for value-choice emission write `next cond ? X : Y` (`next` outside the pure-value ternary). The range idiom `loop >> { $ >= n ? break : $ }` motivates admitting bottom branches. `next` is excluded because, unlike `break`/`done`, it continues after emitting — ambiguous in expression position. (Exact legal/illegal branch combinations: test.ts.)

- \+ P1 ✓ one form per operation; only the redundant case forbidden
- \+ P3 ✓ syntactic shape signals intent; bottom-typed branches are explicit
- \+ Range and take-N idioms are concise (`loop >> { cond ? break : $ }`)
- − Mixed-with-bottom rule needs the type system to know about bottom (small addition)
- × Allowing `next` in branches — ambiguous semantics; `next cond ? X : Y` is the unambiguous form
- × Forbidding all statements in ternaries — loses the range/break idiom
- × Allowing arbitrary mixed-kind — loses transparency; harder to read

## D34: `error` is a built-in function producing an Error value

> **Superseded by D50; pipeline retired (2026-06-29)** — the `error` intrinsic is gone (not in the stdlib) and the error pipeline (D23–D25) is dropped. Errors are constructed by ordinary factory functions returning a nominal error type (e.g. `notFound = (r: String): NotFound { [ resource = r ] }`). The one surviving idea here — **capturing a stack at construction** — carries forward as `captureStack()` (D50) and is tracked as future work in `docs/todo.md` → `Errors`. Body kept for reference.

`error: (code: String): Error` is a built-in function always in scope. The name `error` is reserved — user code cannot define a local or top-level binding named `error`.

When called, returns an `Error` value (D24) with `id = @.module + '/' + code` and `stack = @.captureStack()` — both compiler-synthesized at the call site. That synthesis is the only special behavior; otherwise `error` is a regular function value (lowercase per D13).

Used in any expression position (e.g. `next cond ? error('empty') : 42`). For *re-throwing* an existing Error in a catch handler use `next e` — `error` always constructs a *new* Error at its call site.

- \+ No new keyword; just a function value with reserved name
- \+ Compiler-synthesized id/stack hidden behind the function abstraction
- \+ Replaces D26's type-call construction (which is retired) for the Error case
- \+ Aligns with "errors are values" (D23) — `error('X')` produces the value, not a side effect
- − Ad-hoc reserved name; no general "prelude" mechanism yet — formalize later if more built-ins want top-level visibility
- × `error` as a keyword — keyword class adds grammar surface for what's just a function call
- × `Error('X')` type-call — required D26 just for Error
- × `error('X')` stdlib-only — verbose for the common case
- × Allowing user shadowing of `error` — defeats universal availability and creates surprises

## D35: Built-in types are nominal; user types are structural

> **Revised by D49** — *named* types (including user `type X`) are nominal; only the **unnamed** (anonymous literals, function parameter lists) are structural. The clauses below about "user types structural" and "user-branded deferred" are superseded; the union-discriminator mechanism and the "types as branded memory" framing carry forward.

All built-in types — numeric (D14), `String`, `Bool`, `Void`, `Error`, `Frame` — are nominal. They are distinct from each other and from user types even when memory layouts coincide: `Int32` and `Uint32` have identical 4-byte representations but are distinct types; `Float32` and `Uint32` likewise.

User-defined types (`type T = [...]`) are structural by default: two typed data blocks with the same shape are interchangeable as that type.

`is T` (D21) distinguishes types accordingly — at compile time when the type is statically known, at runtime via the union's discriminator tag when the value flows through a union. No per-value tag is required on individual values; nominality lives at the union-discrimination level.

Conceptually, built-in types are branded interpretations of byte memory: `Int32` is "4 bytes interpreted as signed two's-complement"; `Float32` is "4 bytes interpreted as IEEE 754"; `String` is "Uint8 sequence interpreted as UTF-8". The brand is the type's nominal handle. User code currently has no syntax to create new brands — user-branded types are deferred (see `potential-features.md`).

- \+ P1 ✓ one rule for all built-ins; nominality isn't a per-type exception
- \+ P3 ✓ types-as-memory plus nominal brand framework is internally consistent
- \+ Discrimination via union tag — no per-value runtime overhead
- \+ Path open for user-branded types when demand surfaces, without restructuring
- × Error as a one-off nominal exception — would imply nominality is unique to Error rather than the default for built-ins
- × Fully structural built-ins — would make `Int32` indistinguishable from `Uint32` in unions; arithmetic semantics would break
- × Fully nominal user types — Rust-style newtype boilerplate without the integrity justification

## D36: Data blocks are fixed-shape tuple storage; Arrays are stdlib collections

Data blocks (`[T1, T2, ...]` and `[a: T, b: U]`) are **fixed-shape tuple storage**. Their structure (arity, slot types, labels) is fully known at compile time. They model "data layout" — structs, records, tuples.

Variable-length homogeneous collections move to **stdlib `Array<T>`** — a heap-backed, runtime-sized collection with its own operations (`each`/`len`/`get`/`map`/…), not pattern-matched by destructure. Data blocks are the opposite: compile-time-known shape, inline tuple storage, destructurable, D10 singleton-collapse applies. This retires D29's `T[]` (e.g. D24 stack is `Array<Frame>`, not `Frame[]`).

- \+ P1 ✓ single rule per kind: data blocks = layout, arrays = collections
- \+ P3 ✓ static-shape data blocks are fully analyzable; arrays are runtime-clear
- \+ Pattern matching is tuple-only — no "variable arity" ambiguity
- \+ Stdlib operations live in stdlib, not bolted onto the core grammar
- \+ Aligns with the runtime: a data block is a contiguous slot tuple; an array is a length+pointer record
- − Two kinds where there was conceptually one — users choose the right one
- − D29-era code with `T[]` annotations needs migration to `Array<T>`
- × Keep `T[]` as data-block sugar — conflates layout and collection; was D29's compromise
- × Drop `Array` entirely, force collections through generators — generators are streams, not stored containers; no random access

## D37: Single-item labeled data blocks are forbidden at construction and type level

A single-item labeled data block (`[b = 5]`) and a single-field labeled record type (`type Foo = [name: String]`) are **invalid** — use the scalar (`5`) or scalar alias (`type Foo = String`). Unlabeled singletons (`[5]`) are fine (D10 collapses them).

The motivation is removing ambiguity created by the combination of:
- D10's singleton-collapse rule: `[T]` ≡ `T` (1-element data block collapses to scalar).
- Labels as metadata (D36): labels don't affect the structural type.

Together these mean `[b = 5]` would be structurally identical to `5` (scalar) — the label `b` is purely decorative and runtime-erased. Three pattern-matching paths could converge here (singleton-collapse, label-projection, scalar match) producing the same result but with confusingly different reasoning. Banning the construct removes this redundancy.

Implications:
- Named single-arg calls like `f(x = 5)` are **call-site sugar** (not data block construction); the label matches the function's parameter name to provide intent at the call site. No `[x = 5]` data block is created.
- Single-field "named types" use scalar type aliases instead: `type Field = Int32`.

- \+ P1 ✓ removes the "three reasoning paths to same result" ambiguity
- \+ P3 ✓ no ghost labels surviving singleton-collapse
- \+ Compiler treats all 1-arity values as scalars uniformly (no "decorated scalar" exception)
- − Single-field "branded" records aren't expressible — but user-branded types are deferred per D35 anyway
- × Allow but treat `[b = 5]` as scalar with metadata — three reasoning paths leak into user-visible behavior
- × Allow at construction but ban at type — asymmetric; one is a constructive case, the other definitional; both share the same ambiguity

## D38: Parameter defaults via `void` sentinel

A parameter may declare a default: `(name: T = expr)`. Call-facing type is `T | Void` (caller may pass `void`); the body sees `T` because substitution happens at param-binding, before the body runs. Defaults may reference earlier params.

```
addOne = (n: Int32 = 41): Int32 { n + 1 };
addOne(5)        # 5      addOne(void) / addOne(n = void)   # default 41
relate = (a: Int32, b: Int32 = a + 1): Int32 { a + b };  relate(3, void)  # 7
```

Call rules: positional — every slot specified, `void` selects a default; named — mention only overrides; `f()` matches only a 0-param fn (no all-defaults sugar, per D12); `void` on a required param is an error. `void` is the unique inhabitant of `Void` (D15/D40).

- \+ P3: defaults visible in signature, `void` explicit; body sees concrete `T` (no per-use narrowing); defaults at any position; sparse named calls
- − `f(void, void, …)` verbose for "all defaults" (nudge to named form)
- × `f()` all-defaults sugar (breaks D12); trailing-defaults-only (forces ordering); body sees `T | Void` (defeats the ergonomics)

## D39: Head-rest pattern semantics

A tuple destructure pattern binds the **last positional slot to the rest** (a sub-tuple, possibly empty = Void per D40). Uniform at value and type level.

```
[1, 2]    >> (a, b)    { … }   # a=1, b=[2]→2 (D10 collapse)
[1, 2, 3] >> (a, b)    { … }   # a=1, b=[2,3] (tuple; access b.0, b.1)
[1, 2, 3] >> (a, b, c) { … }   # a=1, b=2, c=[3]→3
5         >> (a, b)    { … }   # 5 lifts to [5]: a=5, b=[]=Void
```

- **D10 reconciliation**: single-element rest collapses to its element, so `(a, b)` over `[A, B]` acts like strict 2-arity with `b: B`.
- **Strict arity via typed slots**: `(a: Int32, b: Int32)` requires the rest assignable to `Int32`; a 2+ rest is `[Int32, …]` (not assignable) → matches only effectively-2-arity input.
- **Single slot** `(t)` binds the whole input; typed `(n: Int32)` matches scalars / single-element tuples.
- **Type-level mirror**: the same rule drives type-level chains — `type each<T> = T >> [H, R] { H | each<R> }` binds H=head, R=rest, terminating at Void (D40).

- \+ P1/P4: one rule both levels, no `...rest` operator (implicit in slot position); strict arity recoverable via typed slots
- − arity mismatch on *untyped* patterns surfaces as a body-level type error, not a destructure "no match"
- × explicit `...R` spread (same content via D10+head-rest); strict-by-default + `...` variadic (would diverge value vs type level)

## D40: Void is the absorbing identity for unions and tuples

Void is the identity element for both combinators: `T | Void = T`, `Void | Void = Void`; `[T, Void] → [T]`, `[A, Void, B] → [A, B]`, `[Void, Void] → []`. Tuple reductions chain into D10 collapse (`[T] → T`), so `[5, void] == 5` and `[void, void] == void`.

Rationale: Void means "no emission/no value" (D17), so it contributes nothing to a union and drops out of a tuple slot. Reduce-not-disallow because recursive type computation (D39 + generics) naturally produces `[T, Void]` / `Void | Void` intermediates; auto-reduction lets them finish without explicit base cases. Plays the role TS calls `never` / Haskell `Void` / Scala `Nothing`, while also being the `void` default-sentinel type (D38).

**`[]` is engine-internal, not user-writeable** — canonical spellings are `void` (value) and `Void` (type) at both levels. `[]` arises only as a reduction intermediate (head-rest decomposition). Tuples *with* `void` slots (`[5, void]`) are writeable and reduce per the rule above.

**Implicit Void** — no clause/stage for the Void arm is needed: at the value level a Void pipe-stage is dead code (forbidden); at the type level a missing clause reduces to Void, giving recursion a free base case. So `type each<T> = T >> [H,R] { H | each<R> }` needs no explicit `[]` clause: `each<[Int32]>` → `Int32 | each<[]>` → `Int32 | Void` → `Int32`.

Interacts with: D38 (`void` sentinel is the value, this rule is on the type); Shape 3 unreachability applies *after* reduction (`Int32 | Void → Int32` is reachable; only pure `Void` is dead).

- \+ P1/P3: one identity element, both contexts; algebraic, no special-casing
- − `Int32 | Void` reads like a 2-arm union but is just `Int32` (but written `T | Void` is a hard error — see D44)
- × disallow Void (breaks recursive computation); treat as a normal 1-inhabitant type (forces downstream Void-handling, defeats "no emission")
- Lost: non-Void empty-case results (`IsEmpty<T>`, `Length<T>`) — out of scope per D39 structural-only; reintroduce `[]` patterns if ever needed.

## D41: First-class function types

A function type is a function-value signature **without a body**; the trailing `{ ... }` is the only thing distinguishing a value (`(...): R { ... }`) from a type (`(...): R`). Usable as alias, param type, return type, or tuple field:

```
type BinOp = (Int32, Int32): Int32
helper = (cb: (Int32, Int32): Int32) { cb(5, 10) }
type Handlers = [ onClick: (Int32, Int32): Void, onHover: (Int32): Void ]
```

Param names in type position are optional/documentary (structural equivalence ignores them, per D2). Bare `Fn` (D14) stays the "any function" shorthand. Generics extend the form: `type ReturnType<F: (...): R> = R`.

- \+ P1/P3/P4: one notation for values and types (body present/absent); no `=>` arrow, no `fn(...)` wrapper token; generic fn types fall out free
- − parser distinguishes value/type by trailing `{` (small lookahead)
- × `fn(Int32): Int32` keyword wrapper / `=> ` arrow — extra surface, no gain (the `fn` keyword was removed)

## D42: Compilation model — precompile per module, bundle to one WASM per entry point

Two phases: (1) each `.gb` → a `.gbo` artifact, compiled independently; (2) from the entry module (`main`, or a library's pinned exports), the bundler walks imports, monomorphizes generics, tree-shakes, and emits **one WASM module**. No runtime module linking, no lazy loading at v1.

**`.gbo` = a valid WASM module + custom sections.** Standard sections hold pre-compiled non-generic code, host imports, globals/tables. Custom sections: `gb.types` (aliases, export sigs, generic `type`s), `gb.generics` (generic-fn AST for monomorphization), `gb.imports` (`@module.symbol` refs), `gb.tableentries` (funcs put in tables — for DCE through indirect calls), `gb.pinned` (always-kept exports; empty for apps), `gb.meta` (paths/hashes). Loadable as-is; standard WASM tooling inspects it.

**Bundle phase:** resolve dep graph (cycles banned, D22) → monomorphize per `(template, concrete-args)` → tree-shake from `main`/pinned → merge indices, emit one WASM (only host externals remain imports).

**Tree-shaking:** direct calls traced from bodies; indirect calls reachable only if a reachable fn put the target in a reachable table (`gb.tableentries`); first-class module values via escape analysis (per-access; conservative if the value escapes); generics lazy by construction; unused globals/externals dropped. Result: `@module.process` is a direct `call` (no indirection); stdlib is just another module (only used slices ship).

- \+ one artifact per entry; cross-module inline/mono/DCE with full visibility; `.gbo` is WASM (tool reuse); stdlib grows free
- − no lazy loading (big WASM, DCE-mitigated); whole-program rebuild on interface change (`.gbo` cache); specialization multiplies
- × multi-WASM host-linking (runtime indirection), un-DCE'd stdlib, runtime-interpreted generics, non-WASM `.gbo` format
- Open: custom-section serialization format (not JSON); stable specialization symbol names for incremental cache; escape-analysis precision (start permissive).

## D43: Generics

`<T>` type parameters on type and value definitions, same syntax at both levels. Builds on D39 (head-rest), D40 (Void identity), D42 (monomorphization), D13 (case = value-vs-type).

```
type Pair<T, U> = [T, U]            # generic type alias
identity = <T>(x: T): T { x }       # generic value fn
add = <T: Int32 | Int64>(a: T, b: T): T { a + b }  # union constraint
type First<T> = T >> [H, R] { H }   # type-level chain (Shape-2 dispatch)
type Reverse<T> = T >> [H, R] { [Reverse<R>, H] }  # recursive
```

- **Head-rest at type-param level** (D39): last param binds the rest; `<T, U>` = two params via D10 collapse. No `<[H,R]>` nesting — the pattern is the param list.
- **Type-level chains**: a `type` RHS may use `>>` for structural dispatch (same as value Shape 2); no `is` needed. Empty/no-match → Void (D40), the natural recursion base case. Must be structurally recursive (rest is smaller); enforced.
- **Inference**: type args inferred from call-site arg types (`identity(42)` → T=Int32). Explicit `f<T>(x)` deferred (`<` ambiguity).
- **Constraints**: union via `:`; arg must be assignable; monomorphizes per concrete type. Label/method bounds deferred.
- **Naming** (D13): type-level uppercase (`Each<T>`), value-level lowercase (`each = <T>(t)`) — distinct namespaces, coexist.

- \+ P1/P4: one `<T>` notation both levels; constraints reuse unions, chains reuse `>>`
- \+ P3: monomorphized — real WASM fn per specialization, no boxing/dynamic dispatch; cross-module at bundle phase (D42)
- − Specialization proliferation (mitigated by DCE+dedup); per-call reduction cost (bounded by termination)
- × Erased (Java) / boxed generics — lose numeric precision (D14); reified (C#) — runtime cost; HKT, type-class bounds — deferred
- Open: labeled-pattern destructure `[L:V, R]`, in-pattern constraints `<V:K>`, default type-args `<T=…>`, runtime reduction engine + generic-param member access (see todo.md).

## D44: Binary verdict — no warnings

The compiler emits no warnings. Code is either valid (accepted silently) or rejected (hard compile error). There is no advisory tier and no "permitted but discouraged" state. This is the enforcement teeth of constitution P2 (Built-in Best Practices) — enforcement means a hard error, not a suggestion the author may ignore — and it removes the third diagnostic state that would otherwise undercut P1.

Already de facto: unused bindings, shadowing, reassigning immutables, and unhandled chain variants are all hard errors, never warnings.

**Consequence for `Void` in written unions (D40):**
- *Computed* `T | Void` (from type-level reduction or D38 default param typing) silently collapses to `T`. Accepted, no diagnostic.
- *User-written* `T | Void` in source is a second spelling of `T` (P1 violation) and is therefore a **compile error**: "Void is the union identity; write `T`." Detected on the syntactic union node; computed unions never take that path.

A bare `: Void` return type is unaffected — it is the side-effect sink (D17 / Shape 3), not a union.

- \+ P2: enforcement is unambiguous; nothing is "allowed but flagged"
- \+ P1: no third verdict state; every pattern is yes or no
- \+ Forces each design decision to a clear verdict (error vs silent-accept) rather than deferring to an ignorable warning
- − No gradual-adoption ramp (can't ship a soft-deprecation warning before an error) — acceptable for a language with no external users yet
- × Advisory warnings / lint tier — reintroduces the discouraged-but-valid state P1/P2 reject

## D45: Function values are non-capturing; no closures

A function value is a reference, carrying no environment. **In-scope lexical reference** (a pipe stage / inlined body mentioning an enclosing binding, run immediately in scope) is allowed and free. **Escaping capture** (a function that outlives a binding it references — returned, stored, deferred) is forbidden:

```
makeAdder = (x: Int32): ((Int32): Int32) { (y) { x + y } }  # forbidden — escaping
add(7, 10); configs >> each >> (c) { add(c, input) }      # GB idiom — state is explicit data
```

Rationale: GB has no ownership system or GC. Rust permits capture only because ownership makes lifetime/allocation predictable; without that, the only predictable rule is "no capture" (the Zig position). An "inlinable-closures-only" rule is an inference cliff (P3/P5); escaping capture needs hidden heap + lifetime machinery (P3/P4). Statically-known fn args (`helper(add)`) monomorphize/inline — no funcref; dynamically-selected fn values (funcref table + `call_indirect`) are deferred, independent of capture.

- \+ P3/P4: no hidden env allocation, no GC; P1/P2: state has one channel (explicit args/pipe data); predictable, no inference cliff
- − loses currying/factories/capturing callbacks — rare in a pipe/immutable model; explicit-context workarounds exist
- × full closures (need GC/ownership); "inlinable-only" (unpredictable boundary)

## D46: Standard library is a global prelude; loaded by a general module loader

The stdlib is a single source unit holding both `external` host imports (`out_*`) and gb definitions (`Each`/`each`). Its public symbols form a **global prelude**: `out`, `each`, `error`, `length` are in scope unqualified, like Python builtins or the Haskell `Prelude`. `@` is reserved for cross-module access (D22) and carries no stdlib meaning.

The prefix rule is one bit: a name that **leaves the program** (an external module member) is reached through `@`; everything in-language — pure stdlib included — is bare. `out` ultimately calls a host import but is still spelled bare. Effect-marking, if ever wanted, belongs in the type system (Haskell `IO`, effect rows), not in the spelling of a name — no widely-adopted language name-marks effects, and giving `@` both "module" and "effect" meanings fails P1. `each` is ordinary gb code (a recursive generic, D43), not a hardcoded intrinsic; only `out` stays intrinsic because it needs type-based dispatch to the right `out_*` host import.

The stdlib is loaded by a **general `loadModule(source)`** that parses + type-checks one module and returns its root + symbol scope, with no stdlib-specific logic — the stdlib is merely its first caller, and the same function will load any `@module` once resolution lands. The prelude is made visible by injecting its symbols into every program's global scope and prepending its gb defs to a non-mutating codegen root so the templates inline; imported modules are *not* global — resolved explicitly via `@`.

- \+ P1: one meaning for the prefix (`@` = external boundary); bare = in-language
- \+ P5: `[1, 2, 3] >> each >> out` reads without ceremony; matches the ergonomic preludes users favor (Python, Clojure, Haskell)
- \+ module loading is general from day one — no throwaway stdlib special-casing
- − prelude names occupy the global namespace (mitigated: small surface, shadowable)
- × `@.name` stdlib namespace — overloaded `@` with two meanings; × uniform `@`-qualified stdlib (Elixir-style) — more ceremony, against GB's terseness

---

## D47: `length(x) == 0` is the canonical emptiness test; `length` is total

`length` returns the element count of any value, total over the collapse hierarchy: `length(void) = 0` (D40 — the empty terminal contributes nothing), `length(scalar) = 1` (D10 — `x ≡ [x]`, a value is a one-element sequence), `length(data)` = slot count, `length(String)` = byte count. Emptiness / end-of-stream is tested with one canonical form, **`length(x) == 0`**.

There is no `x == void`. `void` is not a runtime value (D40 — size 0, no WASM representation); the checker rejects comparison against it and points to `length(x) == 0`.

- \+ P1 ✓ one emptiness test; `== void` would be a second spelling of the same thing
- \+ More general: correct for runtime-sized `Array<T>` (where `== void` is *wrong* — an empty array is a present value, not the void terminal) and for the compile-time data-block terminal alike
- \+ P3 ✓ an honest count plus `== 0`, not a type-directed comparison against a valueless thing; `void` never needs value semantics, so "what does `void == void` mean" never arises
- \+ Gives stream consumers (fold/reduce/count/collect) their end-of-stream check without adding an `onComplete` channel to the pipe
- × `x == void` — `void` has no runtime value; supporting it would force void to be a comparable zero-sized value and reopen never-vs-unit (D40)
- × a dedicated `empty(x)`/`end(x)` predicate — `length(x) == 0` already says it, and `length(s) == 0` was already the string idiom

---

## D48: Single-branch `cond ? value` is conditional emission in an emit position

A ternary's meaning depends on whether its result is **consumed** or **emitted**:

- **Value position** (the result feeds an operator, binding, or a stage that needs a value): both branches are required — `cond ? a : b`. Single-branch `cond ? a` is an error ("requires both branches") — there is no value on the false path. (Exception: a bottom-typed branch — `break`/`done` — never returns, so the result type comes from the other branch.)
- **Emit position** (a stage body, whose value is auto-emitted): single-branch `cond ? value` emits `value` when the condition holds and **emits nothing** otherwise — the chain stops on the false path. This is the canonical conditional-emit / filter idiom: `data >> each >> T { p($) ? $ }`. No `filter` function is needed — just as `T { f($) }` is `map`, so no `map` function is needed either.

`void` is **not a value** and cannot be emitted: a chain stops on void rather than carrying a void value downstream. Writing `void` as an emittable expression (`T { void }`, `cond ? $ : void`) is an error that points to `cond ? value`. (D40's absorbing identity at the emit boundary — there is no void value to emit.)

- \+ Element-wise transforms are syntax (the chain), not library functions: `map`/`filter` fall out of `>> each >> T { … }`, keeping the stdlib to what the chain can't express (aggregation via `fold`; restructuring like `take`/`zip`)
- \+ One conditional-emit spelling (`cond ? value`) — no `: void`, no separate drop form
- \+ Reuses the distinction the language already makes (a stage that produces nothing vs a value that must exist)
- × `cond ? $ : void` is rejected rather than aliased to `cond ? $` — one canonical idiom, and `void` stays non-valued (D40)

---

## D49: Nominal for named types, structural for the unnamed (revises D35)

A declaration is identity. `type X = …` mints a **nominal** type whose identity is that declaration *instance* — not its name string, not its layout. Two named types with identical layout are distinct (`type NotFound = [resource: String]` ≠ `type Forbidden = [resource: String]`); two named types that happened to share a name (shadowing, future modules) would also be distinct, because the instance — not the string — is compared. This extends to **user** named types, generalizing D35's "built-ins nominal" to "all *named* types are nominal" and retiring its "user types structural / user-branded deferred" clause.

Everything **unnamed is structural**: anonymous literals `[x = 1, y = 2]`, and **function parameter lists** — a signature `(a: A, b: B): R` *is* the structural block `[a: A, b: B] → R`, so calls match arguments by shape (`f(1, 'x')`) with no named type needed.

A structural value acquires a nominal brand at **one point**: where it meets a named type — `x: T`, a constructor's declared return, or a typed binding. `[resource = 'u']` is a bare block until `notFound(…): NotFound` (or `e: NotFound`) stamps it. The coercion is **one-way**: structural → named acquires the brand; named → a *different* named type is rejected. So `canAssign` is nominal between named types, structural elsewhere.

Discrimination lives at the **union tag**: `A | B` records the variant by nominal id, so runtime dispatch (`v >> X { … }`, `is X`) reads identity off the tag (D35's union-discriminator, now the general mechanism); no per-value tag on non-union values.

- \+ Identity enforced by the type system, not a string or convention (P2) — the prerequisite for standardized, detectable errors
- \+ One discrimination path: by type, never `id == "..."` (P1)
- \+ The type *is* the identity; no discriminant field, nothing implicit (P3)
- \+ Closes the D35 gap — `canAssign` was structural while `|`-dispatch already matched by name (inconsistent: a `Forbidden` was structurally assignable into a `NotFound` slot, then mis-caught); now both are nominal-for-named
- \+ Functions stay structural in their inputs (P5) — param lists are just block types; no ceremony to call
- − A real commitment: every union becomes a tagged sum (a discriminant), and `canAssign` gains a nominal branch
- × Pure structural (old D35 for user types) — can't distinguish same-shape types; detection collapses `NotFound`/`Forbidden`
- × Structural + a `kind: 'NotFound'` discriminant field — an unenforced string id in disguise; fails P2, re-creates the mess

## D50: Structural nominal errors — typed, composed, no message

An error is a **nominal type** (D49) built from a minimal base `Error = [ stack: Frame ]`. Its information is its **type plus structured fields** — there is no `id`/`message` string. Discrimination is by type; a free-text string would re-encode the meaning in a form the compiler can't check. Supersedes **D24** (single, string-keyed `Error`) and **D34** (`error` keyword auto-synth).

```
type Error     = [ stack: Frame ]
type NotFound  = Error & [ resource: String ]    # is-a Error, plus structured data
type DivByZero = Error                            # no extra data — the type name is the info
notFound = (r: String): NotFound { [ resource = r, stack = captureStack() ] }
captureStack()                                    # the lone primitive → Frame
result >> NotFound { … } >> Error { … }           # specific by instance, base by composition
```

**Composition is is-a (β).** A named type's *components* are the named types named in its definition (`= X`, `& X & Y`); anonymous blocks (`[fields]`) contribute fields but no identity. `canAssign` and dispatch match a value against its own type **or any component, transitively**: `>> Error { }` catches every error (each composes `Error`); `>> NotFound { }` catches that one. Overlap resolves by **chain order** — first arm wins, so order specific before base. This is the language's whole subtyping story: composition + chain dispatch, no classes or interfaces.

`captureStack()` is the only primitive; constructors are ordinary functions filling fields + stack. The `error` intrinsic is retired. Human-readable text is **derived** (a `show`-style dispatch over the type), never stored.

- \+ Identity *and* payload compiler-checked (P2); the type is the meaning, nothing redundant (P3/P4)
- \+ One matching rule — self-or-component — retires the special `'error'` family (P1)
- \+ Subtyping with no inheritance machinery: just `&` + dispatch (P5)
- − Stack captured eagerly at every construction — a runtime cost; **lazy stack deferred** (figure out later)
- − No free-text escape; you define a type for each error
- × String id/message (D24) — uncheckable; "ids are always a mess"
- × Structural-only error typing — collapses same-shape errors (`NotFound`/`Forbidden`)

Refines: D23 / D25 (both **RETIRED 2026-06-29** — errors are union members routed by `|`-dispatch; a typed dispatch arm `>> T { }` *is* the catch, so the `catch(T)` modifier is confirmed unneeded); D31 (`Int32 | Error` → `Int32 | <TypedError>`). D49 gains: named → a different named type is rejected *unless the target is a component of the source*.

**Status:** the nominal / by-type discrimination is implemented (`DivByZero` etc.); the `stack: Frame` payload + `captureStack()` are the *target* but **not yet built** — the working base is `Error = []`. Tracked in `docs/todo.md` → `Errors`.

## D51: `String` is the named byte-sequence type (`String = [Uint8]`)

A `String` is a homogeneous, runtime-length sequence of `Uint8` bytes interpreted as UTF-8 (D14/D35). Its runtime representation **is** a byte block — the same `[length][itemSize][bytes…]` buffer any data block uses — so a `String` and a `[Uint8]` byte block are *one coherent type* across the checker, `inferType`, and codegen. An anonymous data block whose every element is a `Uint8` (≥2 elements; a single one collapses to the scalar per D10) therefore has type `String`, and a string literal `'…'` is that same type with the same layout. `length(s)` reads the buffer's element count (a byte count); `out` renders a `String` as text via `out_str` (decode the bytes), so `[Uint8(72), Uint8(105)] >> out` prints `Hi`.

`String` is the **named** brand (D49) over the byte sequence: unlike an anonymous block it never collapses under D10 (a 1-byte `'h'` stays a `String`, not a `Uint8`), which is what lets a byte-producing function declare a `String` return even when a path yields a single byte. The brand carries no per-value tag — it is a primitive *interpretation* of bytes (D35), distinct from a nominal record (no `nominalId`, no union discriminator).

This is the keystone the reverted codegen-only flatten lacked: with `inferType` and the checker agreeing a byte block is a `String`, byte-flatten (`concat`), `out_buffer`, and `itoa` can each recognize a byte sequence consistently.

- \+ P1/P3: one representation for text and byte buffers; `inferType`, checker, and codegen agree on the byte-block type
- \+ P4: no separate "string" runtime — text is just bytes; opens the path to a single `out_buffer` host primitive with number→string formatting (`itoa`/`toString`) written in gb
- \+ "A byte is just `Uint8`" (D14) made real — `char` is `Uint8`, `concat` is byte-flatten, no new primitives
- − A lone scalar `Uint8` is not yet a `String` (the 1-byte coercion at a `: String` boundary is deferred with `itoa`); byte-level iteration (`each`/destructure over a *runtime* `String`) is deferred — to head-rest a `String` is currently one opaque value, distinct from compile-time byte-block reads
- × Keep `String` a distinct `'string'` runtime (a 4-byte-header `[len][bytes]`) — layout incompatible with byte blocks, so flatten/`itoa` can't recognize a byte sequence (the keystone gap)
- × A 1-element `[Uint8]` *is* a `String` — contradicts D10 singleton-collapse; the named brand (literal / annotation) is the non-collapsing form instead

## D52: Constructing a `String` is explicit — only literals and zero-op re-brands are implicit

A `String` value arises from exactly two sources: a string **literal** (`'…'`), or an explicit **`String(…)` constructor** (D26). A data block — even one whose elements are all byte-buffer-compatible (`Uint8`/`String`) — is never *implicitly* a `String`; it stays a byte tuple (D36) until passed through `String(…)`.

The reason is P3. Coercing a multi-piece block to a `String` (`String(['foo', 'bar'])` → `'foobar'`) allocates a new buffer and copies bytes — a runtime **operation**, not a relabel. Hiding that behind a type annotation (`s: String = ['foo', 'bar']`) would make an allocation+copy invisible. The `String(…)` call is the visible "work happens here" marker. This **refines D49**: a structural→nominal coercion is implicit only when it is a **zero-op re-brand** (same bytes, new identity — e.g. `[x=1, y=2] → Point`, where the literal's allocation is already written by the author); a coercion that must *construct* (allocate / copy / concatenate) is always an explicit constructor call.

A string literal is implicit-`String` because it *is* a String at its source — there is no block and no coercion. So `canAssign` accepts `String ← String` and `String ← string-literal`, but **not** `String ← data block`: a block at a `: String` boundary (binding, return, param) is a compile error pointing to `String(…)`.

```
greeting: String = 'hello'              # literal — free
hi   = String([Uint8(72), Uint8(105)])  # re-brand a contiguous buffer → 'Hi' (zero-op)
full = String(['foo', 'bar'])           # 'foobar' — the concat/alloc is visible at the call
pair = ['foo', Uint8(33)]               # a 2-tuple (D36), NOT a String
s: String = ['foo', 'bar']              # error — a block is not a String; use String([...])
```

- \+ P3: every `String`-building allocation is visible at a `String(…)` call; a type annotation never silently runs a concat
- \+ P1: one way to build a String from parts (`String([…])`) — no `+`/`concat` operator, no implicit/explicit fork
- \+ Preserves byte tuples (D36) — `['foo', Uint8(33)]` is an addressable pair until `String(…)`
- − More verbose than annotation-driven coercion (`String([…])` vs a bare `: String`) — accepted: the verbosity *is* the transparency
- × Implicit block→String at a `: String` boundary — hides an allocation+copy behind a declaration (the magic this rejects). The free all-`Uint8` re-brand was the tempting edge case, but a reader can't tell "contiguous-bytes (free)" from "multi-piece (allocates)" at a glance, so even that routes through `String(…)`

Interacts with: D26 (`String(…)` is the constructor), D36 (byte tuples preserved), D49 (coercion implicit iff zero-op), D51 (the `String = [Uint8]` representation this builds on).

## D53: `String` equality is byte-wise value equality

`==`/`!=` on `String` compare **by value**: length first, then bytes (the `__streq` runtime helper, with a same-pointer fast path that returns early, à la Go). Equal text is equal regardless of where each buffer lives — a runtime-built `String` equals an identical literal. This follows directly from D51 (`String = [Uint8]`): comparing two strings is comparing two byte buffers. Value equality is what `==` means everywhere for text — JS string *primitives*, Rust `str`, and Go `string` all value-compare; only object identity is reference-compared.

Equality is over the **raw UTF-8 bytes** — no Unicode normalization (precomposed `é` ≠ decomposed `é`), matching Rust/Go/Zig. Canonical/normalized equality needs Unicode tables and is a separate future explicit op (same bucket as `graphemes()`), never folded into `==`.

- \+ P3: `==` means content equality (no surprising identity semantics); Go's pointer fast path keeps interned-literal compares O(1)
- \+ Raw-byte equality is predictable and table-free; normalization stays an explicit, costed op
- − O(n) in length for distinct buffers (unavoidable — core WASM has no `memcmp`; word-at-a-time compare is a future perf tweak)
- × Reference/identity equality (JS objects; Zig's raw slice `==`) — wrong for text; equal strings at different addresses must compare equal
- × Normalized-by-default — hidden Unicode-table cost behind `==` (P3/P6); deferred to an explicit op

## D54: Integer divide-by-zero is a value, not a trap (affirms D31)

> **Representation per D56** — the on-zero codegen builds a `DivByZero` *value*; how that value is laid out at runtime (the value plus a separate hidden tag, not the original in-band high-bit scheme) is specified by D56.

`a / b` and `a % b` over integers return `Int32 | DivByZero` (D31). On a zero divisor the codegen builds a `DivByZero` value rather than letting WASM `i32.div_s` trap. Considered and rejected: trapping like WASM/Rust/Go, defining `x / 0 = 0`, and an `@.unwrap` escape.

- \+ gbc has no panic (D23); the value channel is its only failure channel. Rust/Go can panic because they *have* a recoverable panic — but a WASM trap is **uncatchable and terminal** (throws to the host as a `RuntimeError`; no in-module `recover`). So a trapping `/` makes every divide-by-zero unrecoverable program death, strictly worse than Rust/Go. Errors-as-values is the only recovery mechanism on WASM.
- \+ Perf is a non-issue: integer division is ~20–40 cycles; a `divisor == 0` check is one perfectly-predicted branch, and `div_s` already checks for zero to trap. **Const-fold narrow** removes even that for a known non-zero literal divisor (→ plain `Int32`); literal `0` → compile error; only a genuinely-runtime divisor carries the union.
- × Trap like WASM/Rust/Go — reintroduces panic (rejected) and is uncatchable on WASM. If ever wanted, the clean form is Rust's: trapping `/` + opt-in `safeDiv → Int32 | DivByZero`.
- × `define x / 0 = 0` (Pony/Lean) — still needs the branch (`div_s` traps) and silently hides the bug.
- × `@.unwrap` escape — a trap in disguise (uncatchable on WASM); unneeded, since the union is handled by dispatch, not proven away.

## D55: Type dispatch is the sole union-discrimination mechanism — no `is`/flow-narrowing

A union is discriminated by dispatching it through a `|` arm set (`v >> Int32 { … } | String { … }`), which narrows `$` per arm (monomorphization). A pipe is an expression, so this works in value position too — it reaches every place a union must be narrowed. There is **no `is`-operator flow-narrowing** (narrowing a binding inside a `?:` branch).

- \+ P1 — one mechanism. The only syntax flow-narrowing would touch is `?:`, and `v is T ? a : b` is exactly `v >> T { a } | <rest> { b }`. Redundant.
- \+ Dispatch is strictly more capable: it's exhaustive and handles N variants directly; an `is`-ternary narrows only the true branch, leaving the rest a union for >2 variants (forcing nested ternaries).
- \+ Flow-narrowing would not have helped D31: a validated divisor needs *value*-predicate narrowing (`b != 0`), not a type test (refinement typing gbc lacks); the div *result* is dispatched like any other union.
- × `is` + flow-narrowing — a second discrimination path beside dispatch; violates P1, adds checker condition-analysis, and is strictly weaker.
- Consequence: the existing `is` operator (a `Bool` type-test with no narrowing) is redundant and slated for removal.

## D56: Union representation — value plus a separate hidden tag (no in-band bit-stealing)

A materialized union is two physically separate parts: the **value** and a **hidden tag** (the discriminant). The value occupies a slot sized to the union's largest member; the tag is compiler-owned metadata stored separately — its own local for a symbol, its own region of the block for a data field — never packed into the value's bits and never interleaved into the value memory. The representation is **uniform across symbols and data-block fields**: `a = 1 / b` and a `[ …, 1 / b, … ]` field store identically. The tag is never user-visible — no syntax reads or writes it, like a vtable. And when a union is produced and **dispatched in place** without being bound or stored, the compiler fuses producer into dispatch and materializes **neither value nor tag**; the pair exists only when the union escapes into a binding or a data block.

- \+ Correctness — the value keeps its full natural range. The original scheme stole bit 31 of the value for the tag, so any negative `Int32` (`d(-3) → -3 = 0xFFFFFFFD`) was misread as an error. Disjoint storage removes the collision: an `Int32` payload is its plain 32 bits, a `Float64` its 8 bytes.
- \+ Flat memory preserved where it can be — non-union data (`[Int32]`, `String` bytes, scalar tuples) stays a faithful byte image; only the *separate* tag region is added for union fields. The "block is its memory image" invariant holds for products/scalars; it was never possible for sums (a sum needs a discriminant — information-theoretic).
- \+ Consistency forces it — a local and a data-block field are both storage; there is no principled line between them (no language draws one: Rust has both `let x: Result` and `struct { x: Result }`, same layout). Allowing union variables but forbidding union fields is incoherent, so materialization must be uniform.
- \+ Hidden ⇒ sound — producer writes the tag, dispatch reads it, no surface op can forge a tag/value mismatch, so a union value's tag can never lie about its payload (C's manual tagged union has the same layout with no such guarantee; the guarantee is the reason to have a union type).
- \+ Zero cost when transient — the common produce-and-dispatch path materializes nothing; cost is paid only on escape (bind/store).
- × In-band bit-stealing (`0x80000000 | id` in the value's high bits — the original codegen) — collides with full-range payloads; `Int32` has no spare bit and no niche, so there is nowhere inside the value to put a tag. This is the bug D56 fixes.
- × Inline `{tag, value}` per slot — correct, but interleaves tags into the value region, breaking the flat-image invariant for the surrounding block.
- × Fat pointer (`{ptr, tag}`, value out-of-line) — a pointer hop and a separate allocation for no benefit on inline scalars (the value already fits the slot). Right tool only for large/variable/shared payloads or uniform-width references (Go interfaces), not gbc's small values.
- × Forbid materialized unions (dispatch-only; no union variables or fields) — would keep every block a pure value image, but is the incoherent split above once union variables are allowed.
- × Niche optimization (zero tag bits via an impossible payload value) — valid for members with a niche (non-null pointer, etc.) and may apply per-union later; inapplicable to `Int32 | DivByZero` (`Int32` has no spare value, `DivByZero` no payload to hide a marker in).
- Supersedes the (undocumented) bit-stealing codegen behind D31/D54. The div/mod *value* (D54) and the type-level union + const-fold narrow (D31) carry forward unchanged; only the runtime layout changes.
- Prerequisite — data-block layout must move from a single uniform `itemSize` (current; truncates mixed sizes) to **per-field offsets/sizes**, so each slot is sized to its field's largest member. Needed for heterogeneous tuples regardless of unions.
- Implementation — `driveDispatch` reads the tag slot (not bit 31); construction writes value and tag separately; a fused path is added for produce-and-dispatch.
- Wide payloads (member > 4 bytes, e.g. `Float64`, `Int64`) — the value slot is a single i64 "bit cell" (i32 when every member fits 4 bytes); members are bit-cast into/out of it (`i64.reinterpret_f64`/`f64.reinterpret_i64` for floats, `i64.extend_i32_u`/`i32.wrap_i64` for ints and pointers). One `bitcast` helper at the construction site (`coerceToUnion`) and the two read sites (`driveDispatch`, `autoDispatchUnion`); a no-op whenever member and slot types already match (so i32-only unions are unchanged). Chosen over per-union native slot typing (f64 slot for a float-dominant union): the cast is bit-exact and effectively free, while native typing only avoids it for unions whose payload-bearing members share one type — which excludes `Float64 | <error>` (an i32-class marker member), the case it was meant to help — so it would need fragile marker detection for no runtime gain.

---

## D57: Data-block layout — headerless, per-field, concatenation `&`, interior-pointer upcast

A data block is a **headerless** flat record laid out by one per-field rule. Offsets and arity are compile-time facts of the type, not runtime metadata: `length` is the member count (already constant-folded), field access is a constant offset, and there is no runtime indexing. The old `[u32 length][u32 itemSize]` header is dropped — for a data block its values were never read (only `String`, genuinely variable-length, keeps a header). One `data` kind covers struct, tuple, and homogeneous array; "homogeneous" is merely the case where the per-field offsets happen to form a uniform stride, not a separate representation.

Layout: fields in declaration order, each at the running size rounded up to its natural alignment, total rounded to the max field alignment. Each field holds its type's full inline representation — scalar inline by size, `String`/nested handle as a 4-byte pointer, and a **union field as `[payload][tag]` inline** (the same two-part value as a union local, D56 — uniform across local and field).

Intersection composes by concatenation: `A & B` lays out as `[A-fields][B-fields]`, each component contiguous and aligned, so every component of a type is a contiguous sub-block at a compile-time offset. Assignability stays `composes` (D49 — component membership), which means every assignable supertype *is* one of those sub-blocks. An **upcast is therefore a pointer adjustment** — viewing a value as a component type yields `ptr + that component's offset`, a compile-time constant, `+0` when the component is the prefix. No copy, no per-value tag, no vtable. Field access always uses the static type's offset and is correct because the (possibly adjusted) pointer points at a region whose layout *is* that type. Headerlessness is what permits this: with no header to skip, any field-aligned interior address is a valid block-view.

- \+ Correctness — per-field offsets end the uniform-`itemSize` truncation (`[1, 3.14].1` was lossy/invalid WASM); union fields and heterogeneous tuples now store faithfully.
- \+ Zero-cost upcast — reordered subtyping (`Tag & Named` used as `Named`) works via a constant pointer add, often `+0`; no reshape copy, no runtime type info.
- \+ Uniform with D56 — a union is `[payload][tag]` whether bound to a local or stored in a field; one representation, one construction/dispatch path.
- \+ Leaner — removes 8 header bytes and the `+8` skip from every access; one layout rule, no struct-vs-array split.
- × Keep the `[length][itemSize]` header — vestigial: `length` is the compile-time member count, access is a compile-time offset, there is no runtime index. Dead bytes plus skip.
- × Uniform `itemSize` slot — truncates wide fields in mixed blocks and cannot hold a union field's tag.
- × Reshape on upcast (copy the target's fields into a fresh block) — correct, but copies on every non-prefix upcast; headerless interior pointers give the same view for free.
- × Box union fields (pointer to a heap `{tag, value}`) — an allocation per element and an indirection per read on the streaming hot path; breaks D56 local/field uniformity.
- × Reject non-prefix upcast (prefix-only subtyping) — a real expressiveness loss; pointer adjustment makes any component upcast free, so reordered intersections need not be forbidden.
- × Runtime offset table / per-value type tag (vtable) — erasure-safe but adds a per-value header and an indirection per field access; against the flat, no-per-value-tag model.
- Commitment — an interior pointer cannot be walked back to its allocation start, so this forecloses GC or refcounting **for data blocks**; they are bump-allocated (never freed) today. Type erasure (existentials, a `[Named]` holding mixed concrete types behind the supertype) or GC would need the runtime-offset-table model — this is the point to revisit. `String` is unaffected: its value pointer is the allocation start and the pool refcount lives there.
- Constraint — the layout pass must keep each `&` component contiguous (no global repacking, e.g. slotting a later component's field into an earlier one's padding), or the sub-block view breaks.
- Builds on D56 (union value+tag) and D49 (nominal-for-named; `composes` assignability). Supersedes the uniform-`itemSize` codegen and the D56 "per-field offsets" prerequisite note. `&` is commutative for assignability (a value of `A & B` or `B & A` is usable as both A and B by adjustment) though the two orders are distinct byte layouts.
- Orthogonal — whether a **data-block-typed field** is an inline (flattened) sub-block or a handle (pointer) is settled by D58.

---

## D58: Nested records — named fields inline as units, anonymous blocks flatten (D49-keyed)

When a data block contains another block, layout follows D49's named/unnamed axis. An **anonymous** nested block flattens into its parent — `[[1,2],[3,4]]` is a flat four-element block (`length` 4); a structural tuple has no identity to preserve. A **named record field** (a labeled field whose value is a record) is preserved as a contiguous **inline sub-record** — laid out at its full size within the parent, never spliced and never boxed. Reading the field yields an **interior pointer** to its sub-region (the D57 `ptr + offset` mechanism), so `line.to.x` resolves `line → to` (interior pointer) `→ x` (leaf load) with no allocation and no load until the leaf. Records are fixed-size, so inlining is always possible; the boxed **handle** (4-byte pointer) stays reserved for genuinely variable-size or shared members (`String`, a future dynamic `[T]`).

- \+ Identity preserved where it exists — a named field stays a unit you can read (`line.to`) and chain through (`line.to.x`); an anonymous tuple flattens. Matches D49 (named = nominal, unnamed = structural).
- \+ No boxing — a fixed-size record needs no allocation or indirection; the sub-record is inline, reached by pointer arithmetic, reusing D57's interior-pointer upcast.
- \+ Flat memory kept — the parent stays one allocation; nesting is tracked by the type, not by headers or out-of-line pointers.
- × Flatten everything (prior behavior) — erases named structure: `line.to`/`line.to.x` impossible, no record-typed fields. Rejected by the first nominal record needing a block field.
- × Box every nested record — correct but an allocation + a load per access for something fixed-size; reserved for variable-size/shared members only.
- Revises D57's "nested → 4-byte handle" clause: a *named* record field is inline; only variable-size/shared members stay handles.
- Scope — covers named record **fields** (labeled members). Homogeneous **collections** of records (unlabeled elements, `[Point]`) still flatten; preserving those as a stream of record units (zip-as-pairs) is the same interior-pointer mechanism gated on element type, deferred until needed.

## D59: `T(x)` is an overloadable, param-dispatched constructor whose arms all return `T`

> **DEFERRED (2026-07-01)** — the constructor-overload model (memberwise ctors, user conversion arms, `char()`, `String(x)` to-text, dispatch extension) is recorded here as the intended design but **not yet implemented**; it is gated on speccing dispatch-extension. The scalar-conversion arg type-check (`Int64('hello')` → error) already landed.


A type used as a call — `Int64(x)`, `String(x)` — is the type's **constructor**: an overload set dispatched by its **parameters**, where **every arm returns `T`**. One shape unifies conversion, parsing, and construction — all are "produce a `T` from some input":

```
Int64(x: Int32): Int64      # widen      (built-in seed arm)
Int64(x: Float64): Int64    # truncate   (built-in)
Int64(x: String): Int64     # parse
Int64(x: Celsius): Int64    # user conversion
String(x: Int32): String    # to-text — '8'  (the former toStringInt)
```

Built-in scalar conversions are the seed arms; user code extends any constructor by adding an input-typed arm (`Int64 = Int64 | (c: Celsius): Int64 { c.raw }`), exactly as the stdlib extends a `|`-dispatch. The checker **enforces** that every arm of `T(…)` returns `T` — `Int64(x): String` is a compile error — so the name-to-result link is guaranteed, not conventional.

**Overloading is by parameters only; there is no return-type dispatch.** Selection uses the value that flows in (input type), never the type expected out — consistent with forward, pipe-first dispatch (D55). This is *why* constructors need no new machinery: the return is pinned by the type's identity, not inferred from context. Two arms with the **same** input but different returns are an **ambiguous-overload error**, not a union — a union return is meaningful only as the declared result of a *single* computation (D56), never as a byproduct of overload merging (only the first arm would run, so the union would be a type the runtime never produces).

Data construction stays the `[...]` literal + coercion (D49/D52); there is no positional data constructor. No-arg `T()` is always an error (no zero/default-by-type — write the value). Type-constructor calls type-check like every other call: `Int64('hello')` is a compile error, not silent garbage.

- \+ P1: one overload rule everywhere — dispatch by params. Conversion, parse, and construct collapse into a single shape (`T(y): T`); `toString` / `to<Type>` / `String([…])` all fold into constructor arms.
- \+ P2/P3: the return type is guaranteed by the type system (arms must return `T`) — no convention-only `toInt64` names, no unenforced return, no result-type lie.
- \+ Extensible via the existing arm mechanism — a user `Celsius → Int64` is a normal overload; no traits/methods needed.
- \+ Forward/pipe-coherent — `Int64(x)` / `x >> Int64` selects on what flows in; nothing flows backward.
- − Two arms differing only by return are now an error, not a union (a real behavior tightened); return-polymorphic constants (`mempty`, context-`read`) are inexpressible — accepted, they are inherently against forward flow and rare.
- × Return-type dispatch (a single generic `to<To>`) — needs backward/bidirectional inference and makes untyped pipe positions ambiguous; rejected as against forward flow, for a payoff already covered by return-pinned constructors.
- × `to<Type>` free functions (`toInt64`, `toString`) — the name-to-result link is unenforced (a `toInt64` may return anything) and fragments one concept into N names; rejected.
- × Hardcoded, unchecked scalar ctors (prior behavior) — `Int64('hello')` silently produced garbage; rejected.

Interacts with: D26/D52 (`String(…)` constructor; concat moves to interpolation D60), D49 (data via `[...]` + coercion), D55 (forward dispatch by input), D56 (union returns are single-arm declared results only). Supersedes the "Rejected: `as` → `toInt64` functions" note.

## D60: String building — `String(x)` to-text, `char(n)` code→char, `'${…}'` concat

Building a `String` is three distinct, named operations, no overlap:
- `String(x): String` — value → text via the constructor's arms (D59): `String(8)` → `'8'`, `String(3.14)` → `'3.14'`. This is the former `toString`.
- `char(n: Uint8): String` — a byte / code point → its one-character string: `char(72)` → `'H'`. The primitive the old `String(Uint8(…))` performed, now named so number-as-charcode is never confused with number-as-text.
- `'a${expr}b'` — **interpolation** is the concatenation surface: the literal splits into parts and `${expr}` holes; each part is coerced with `String(expr)` and the pieces concatenated (the D57 flatten). `'x=${n}'` with `n = 5` → `'x=5'`.

This **retires `String([…])` as the concat surface** (D52): concatenation is spelled with interpolation, not a data-block constructor, and `String(x)` is unary (a conversion arm), so there is no multi-arg/positional `String(…)`. itoa becomes:

```
String = String | (n: Int32): String {
  n < 10 ? char(48 + n) : '${n / 10}${char(48 + n % 10)}'
}
```

- \+ P1/P3: three operations, three names, no overloaded meaning — number-as-text (`String`), number-as-char (`char`), concat (`'${…}'`) are visibly distinct.
- \+ Kills the `String(72) = 'H'` trap (the Go wart): a bare number converts to decimal text; the char-code path is an explicit `char`.
- \+ Concat is the familiar interpolation form, not `String([a, b, c])`.
- − Interpolation is new scanner/parser/codegen surface — accepted; it replaces both `String([…])` and call-site `toString`.
- × `String([…])` concat + `String(Uint8)` charcode (prior D26/D52) — conflated three operations under one name with the charcode trap; rejected.

Interacts with: D59 (`String(x)` is a constructor arm; `char` is a separate primitive), D51/D57 (String repr + flatten used by interpolation), D52 (concat surface moves from `String([…])` to interpolation).

---

## Open / Deferred

Tracked in `potential-features.md`:
- `use` import keyword
- UTF-8 string encoding commitment
- `=>` arrow lambda form
- Compiler pipeline fusion for `loop` (performance optimization)
- Dynamic (non-capturing) function values via funcref table + `call_indirect` (only when a real need arises; static cases monomorphize per D45)

Rejected:
- `as` type-casting operator — replaced by **type constructors** (D59): `Int64(x)`, `String(x)`, etc. are overloadable, param-dispatched, return-pinned calls (conversion = parse = construct). Lossy conversions return `T | Error`; the compiler inlines built-in scalar arms to WASM conversion instructions.
- `to<Type>` free conversion functions (`toInt64`, `toString`) — superseded by D59 constructor arms (the name-to-result link is unenforced for free functions; constructors guarantee the return type).
- Return-type dispatch / a single generic `to<To>` — see D59; against forward-flow dispatch.

Not yet decided / specced (future waves):
- Module resolution / file paths (compiler/tooling concern)
- `main` block semantics in non-entry modules
- Multi-level break (labeled loops)
- Type narrowing implementation depth
- Pick-class type operations (labeled-pattern destructure + constraint syntax; substrate landed in D43)
- Record *collections* / zip-as-pairs — D58 settled named record *fields* (inline units). A homogeneous *collection* of records (`[Point]`, unlabeled elements) still flattens; preserving its elements as a stream of record units (enabling zip-as-pairs) is the same interior-pointer mechanism gated on element type, deferred until a real need.
