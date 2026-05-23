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

Form: `x: var = 10`, `fn(p: var Int)`, `[ name: var = 'Alice' ]`.

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

## D8: `>>` passes data blocks as whole values; `@.each` iterates

`[1, 2] >> f` calls `f([1, 2])`. `[1, 2] >> @.each >> f` calls `f(1)` then `f(2)`.

- \+ Pipe semantics don't depend on LHS type (P1, P3)
- \+ Resolves tuple-passing ambiguity (`[1,2] >> processTuple` is unambiguous)
- \+ Iteration is explicit at call sites (P3)
- − Slight stdlib bloat (`@.each` exists)
- × Auto-iterate data blocks through `>>` — would make pipe LHS-type-dependent

## D9: Labels are erased during iteration

`[ x = 1, y = 2 ] >> @.each` yields 1, 2 (not (label, value) pairs).

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

- \+ Param destructuring (`fn(a, b)`) reuses data-block label semantics (P1)
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
- Keywords (`fn`, `next`, `done`, `main`, `type`, `var`, `loop`, `break`) stay lowercase — they're not types

## D15: Built-in special values are lowercase

`true`, `false`, `nan`, `infinity`. (Was `NaN`; changed for consistency.)

- \+ All value-position tokens follow the same case rule (D13)
- − Breaks JS naming for `NaN`/`Infinity`

## D16: Two block forms — `{}` expression list, `fn(...) { body }` statement body

**`{ expr [, expr]* }`** — anonymous expression list. Each comma-separated expression auto-emits. Restrictions:
- Zero or more expressions (empty `{}` is the canonical no-op function).
- No statements (assignments, declarations, control flow).
- `next` and `done` are statements; not allowed at top level of `{}`.
- Logical-line — newlines for layout are fine; structure is a comma-separated expression list, not statements.
- AST marker: `@sequence`.

**`fn(...) { body }`** — statement body with destructured params (D12). Statements live here. Emission via explicit `next`. Restrictions:
- Body must not be empty — use `{}` if you want a no-op.
- `fn(a, b)` destructures `$` (the call argument, a data block) into named locals.

**Conceptually**: `fn(a, b)` is sugar for "destructure `$` into `a, b`, then run this statement body." The `fn` keyword is the marker for the destructuring + body form; without it, you have an expression list.

- \+ One Way ✓ — expression list and statement body are non-overlapping
- \+ Transparency ✓ — every emission visible (comma in `{}`, `next` in `fn(){}`)
- \+ No multi-emission surprise — commas in `{}` are explicit; refactoring can't sneak in extra emissions
- \+ Minimal no-op (`{}`) and minimal function (`fn(){}` rejected — too much ceremony for nothing)
- × `fn(...) => expr` arrow form (see potential-features.md) — third way to auto-emit, P1 violation
- × Auto-emit everywhere (also in fn bodies) — multi-emission surprise, implicit behavior P3 ding
- × `{}` allowing statements — brings back multi-emission surprise; what yields gets ambiguous

## D17: Unified emission semantics

There are three emission sites:
- `{}` expression-list: each top-level expression auto-emits when the block runs.
- `next` in `fn(){}` body: explicitly emits its argument.
- Pipe stage output: stage's produced values flow downstream.

All three follow the same rule:
- If the value is a **sequence** (the runtime value produced by executing a code block — `{}` or `fn(){}`), iterate it and emit each element.
- Otherwise (number, string, data block, etc.), emit as a single value.

**Sequences vs data blocks**: only sequences (code-block outputs) are iterable in this sense. Data blocks pass as whole single values. To iterate a data block, use `@.each` (which produces a sequence).

**`next` syntax**: `next expr` emits one value. `next(a, b, c)` emits each comma-separated value separately (syntactic sugar for `next a next b next c`). `next` has the lowest precedence — it captures the entire following expression.

**Propagation**:
- `next x` inside `fn(){}` body emits to that fn's output, the *nearest enclosing fn*. Control flow (`?:`, `loop`) doesn't create new emission targets.
- Inner `fn` calls don't auto-propagate. To re-emit values from an inner generator: `next inner()` (next iterates iterables).
- A `{}` block nested inside another `{}` is a function value, not invoked. Outer emits the function value; inner emissions don't propagate unless explicitly invoked (`block()` or `>> block`).

- \+ One rule covers all emission sites (P1)
- \+ "Iterate sequences, emit everything else as-is" is short and uniform (P3)
- \+ Data blocks preserve whole-value semantics through pipes (D8 stays intact)
- \+ `next` low-precedence avoids paren-induced bugs (factorial precedence trap)

## D18: `loop` is a primitive emitter; `done` and `break` have distinct scopes

**`loop`** — primitive infinite emitter. Yields successive integers (0, 1, 2, ...) at the source level. Used as a pipe source: `loop >> stage1 >> stage2 >> ...`. There is no `loop { body }` block form.

**`done`** — exits the nearest enclosing `fn(){}` body. Ends that fn's emission sequence. Other pipe-stage invocations of this fn still run for subsequent upstream values.

**`break`** — stops the nearest enclosing *pipe chain*. Upstream emitters (including `loop`) are cancelled; downstream stages stop receiving values. Compile error if `break` appears outside a pipe stage.

**Compiler handles fusion**: for the common case `loop >> { ... } >> ...`, the compiler emits a tight imperative loop (WASM `(loop ... br_if ...)`). For non-fusable cases, runtime coroutine/state-machine support is used.

**Why this design:**
- \+ One iteration primitive (P1)
- \+ `done` (sequence-end) and `break` (chain-stop) are non-overlapping scopes (P3)
- \+ `loop` as emitter composes with stdlib stages (`@.take`, `@.takeWhile`) without special language machinery
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

## D20: Typed parameters use `fn(name: T)` only

`fn(a: T)` and `fn(a, b)` are the canonical forms. No `fn($: T)` form.

- \+ One Way ✓ — single typed-arg syntax (D12 destructuring sugar)
- \+ `$` is always implicitly available via D12, so explicit `$: T` adds nothing
- × `fn($: T)` form — duplicate of `fn(name: T)` (P1 violation)

## D21: `is` operator for type tests + narrowing

`value is Type` is a binary operator returning `Bool`. In the truthy branch of a conditional, the operand's type is narrowed to the tested type.

```
v: Int32 | String = ...
v is Int32 ? next v * 2 : next @.length(v)
# In the truthy branch, v has type Int32 (narrowed from Int32 | String).
```

- \+ P1 ✓ — single dispatch mechanism (ternary + `is`); no separate `match`/`switch` construct
- \+ P3 ✓ — narrowing is visible at the use site (`is Int32`); no scattered type guards
- \+ P4 ✓ — one operator covers union narrowing without first-class types or per-type stdlib functions
- \+ RHS uses type-position syntax (uppercase per D13) — no need for types-as-values
- × `match` keyword + pattern syntax — bigger surface area, full pattern matching is significant compiler work
- × Per-type narrow functions (`@.isInt32`, `@.isString`) — fixed-list bloat, doesn't extend to user-defined types
- × Types as first-class values — large language commitment for marginal additional capability

**Implementation cost**: type-flow analysis in the checker. Required for any union-narrowing approach, not unique to `is`.

## D22: Modules are file-scoped; `export` is an inline modifier; `@` is the namespace operator

**Module = source file.** Top-level declarations (definitions, type aliases, optional `main` block) live at file scope. No "module-as-code-block" wrapping.

**`export` is an inline modifier** on declarations:
```
export helper = fn(x: Int32) { next x * 2 }
export type Point = [ x: Int32, y: Int32 ]
```

**`@` accesses the module namespace**:
- `@.name` — stdlib member (dot directly after `@` signals empty path).
- `@module.name` — external module's exported member (identifier directly after `@` is the module name).

The parser disambiguates the two `@` forms by what follows: `.` → stdlib; identifier → module.

- \+ Inline `export` is co-located with definitions (P3); refactoring-safe
- \+ Maps directly to WASM's `(export "name" ...)` per-entry mechanism
- \+ File-scoped modules avoid block-execution semantics for imports
- × Modules-as-code-blocks — elegant unification, but conflicts with WASM's flat-export model and adds import-memoization complexity
- × Standalone `export [list]` — redundant naming, drifts independently of definitions
- × `@modname` without dot ambiguity — disambiguated cleanly by parser (`.` vs identifier after `@`)

## D23: Errors are values; chain-routed propagation

Type `Error` is built-in (D24). Functions emit errors via `next Error('code')`. The pipe `>>` dispatches by stage parameter type:
- `fn(T)` stage — non-T inputs route past, looking for a stage that accepts them
- `catch(T) fn(T): U` stage (D25) — consumes T from chain inputs; downstream type replaces T with U

Errors travel only along `>>` chains — no stack unwinding. The compiler enforces handling: a chain producing a union type must reach a stage that accepts/catches each variant before any consumer that rejects it.

- \+ P1 ✓ one mechanism (chain dispatch by param type) handles errors and any other filtered type
- \+ P3 ✓ errors travel along visible `>>`; no invisible flow
- \+ P4 ✓ no `try`, `throw`, `?`, or `Result` wrapper
- \+ Avoids Go's silent skip (compiler-enforced), Rust's `?` clutter (chain auto-routes), Java's `throws` lists (single Error type per D24), exception-style invisible flow
- − Pipe semantics include param-type routing — slightly richer than plain "call next stage"
- × Stack-unwound exceptions — invisible control flow
- × `Result<T, E>` + `?` operator — second control-flow path, boilerplate at every call
- × Hidden auto-propagation through `fn(T)` stages without a marker — type-signature dishonesty; replaced with explicit `catch` modifier per D25

## D24: Built-in `Error` type with auto-filled id and stack

`Error` is a built-in type with shape:

```
type Frame = [ function: String, file: String, line: Int32 ]
type Error = [ id: String, stack: Frame[] ]
```

Constructed and emitted via the `error` keyword (D34):

```
error 'NOT_FOUND'    # emits Error with id = '<currentModule>/NOT_FOUND', stack captured here
```

The compiler synthesizes `id = @.module + '/' + code` and `stack = @.captureStack()` at the `error` site. User code cannot construct an Error via a plain typed data block — the auto-fields require compiler involvement.

Discrimination is via string equality on `id`:

```
catch fn(e: Error): Int32 { next e.id == 'parser/NOT_FOUND' ? 0 : -1 }
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

## D25: `catch(T)` — parameterized type modifier for chain handlers

`catch(T)` is a type modifier on function types (parallels `var` per D6). It marks a function as a chain handler that consumes type T.

```
handler: catch(T) fn(T): U       # full form
handler: catch fn(Error): U      # `catch` is sugar for `catch(Error)`
handler = catch { body }         # value sugar; type inferred from body
```

In a chain, a `catch(T) fn(T): U` stage consumes T values; downstream type loses T and gains U. Non-T inputs route past unchanged.

Re-throw via return type:
- `catch(T) fn(T): U` — always replaces T with U; chain loses T downstream
- `catch(T) fn(T): U | T` — may re-throw T; chain keeps T downstream, needs another handler

Plain `fn(T): U` without catch — callable directly, but rejected as a pipe stage when T is live in the chain and no catch handler exists.

- \+ P1 ✓ single mechanism (`catch(T)`) for all chain consumption; Error stops being special
- \+ P3 ✓ modifier visible in the function's type signature
- \+ P4 ✓ parallels `var` modifier — no new keyword class
- \+ Composable — handlers are values; storable, passable, higher-order
- \+ Future-proof — signal/control types (Stop, Retry, Cancel) fall out without new keywords
- × `catch { body }` as a non-value syntactic form — non-composable
- × Stdlib `@.catch(handler)` as canonical — works but requires the helper for the inline case
- × Error-specific catch with no parameterization — Error special-cased; not extensible

## D26: Types are callable as constructors — RETIRED

Withdrawn. Type construction is via typed data blocks: `[args]: T` (positional) or `[x = a, y = b]: T` (named). Factory functions (regular `fn` returning the type) cover construction with logic. The motivating Error case is handled by the `error` keyword (D34).

Originally proposed so `Error('code')` and user types like `Point(10, 20)` would share a uniform call syntax. With `error` as a keyword and computed-field user types deferred to factory functions, the type-call form has no remaining use case.

## D27: Type body block form — RETIRED

Withdrawn with D26. Its only use case (Error's computed fields like auto-`id` and auto-`stack`) is now handled by the compiler-implemented `error` keyword (D34). User-defined types use the short-form data-shape syntax `type T = [fields]`; "construction with logic" is a regular factory `fn` returning the type.

## D28: Modules are types — RETIRED

Withdrawn with D27. Modules return to D22's namespace model: a file is a module, top-level `export` marks public decls, `@module.name` is namespace lookup. The "modules as singleton-instance of an implicit type" formulation depended on type-body form (D27) which is now retired.

## D29: `T[]` — homogeneous variable-length data block — RETIRED

Retired by **D36**: variable-length collections moved to stdlib `Array<T>`. Data blocks are now strictly fixed-shape tuple storage. The original D29 conflated "fixed tuple" and "variable collection" into one concept; D36 splits them.

Original (for reference): `T[]` was data block syntax for variable-length homogeneous storage.

## D30: Statement separation — `;` ends every statement except `fn` and `main` blocks

At statement contexts (module body, `fn(){...}` body, `main {...}` body):
- **Rule**: a statement whose AST node kind is `fn` or `main` is self-terminating; every other statement requires a trailing `;`, including the last statement in a block. Decision is made on AST kind alone — no source/token-history lookup, no recursive walk into the right-most child.
- `;` after a `fn` or `main` block is a parse error.
- A `def` whose value is a `fn`/`{}` literal is still a `def` at the statement level, so it ends with `;`. The literal sequence `};` is therefore valid — the `}` belongs to the inner block, the `;` to the outer statement.

`,` continues to separate items in expression contexts (data blocks per D10, function args per D12, `{}` expression list per D16). Newlines have no semantic meaning — the parser treats them as ordinary whitespace.

Examples:

```
helper = fn(x) { next x * 2; };          # def stmt → trailing `;`
a = 10;                                    # ends with literal → `;`
b = fn(y) { next y + 1; };                 # def whose value is fn → `;`
c = helper(a) + b(5);                      # ends with `)` → `;`
main { 'hello' >> @.out; }                 # main block: no `;` after `}`, but the inner pipe stmt needs `;`
```

Supersedes D11's "no required statement delimiters" parenthetical. D11's other points (function-call parens, unambiguous parse) stand.

- \+ P1 ✓ one rule — `;` everywhere except `fn`/`main` blocks
- \+ P3 ✓ every statement boundary is a visible token (`;` or `fn`/`main`'s `}`)
- \+ Cross-platform consistent — no CRLF/LF/CR variance
- \+ Auto-formatters and editors can reflow freely without changing semantics
- \+ Parser-implementable on AST kind alone — no source/token-history coupling
- − Top-level defs whose values are `fn` literals end with `};` (the `}` is the inner fn's, the `;` is the outer def's)
- × "Last token is `}`" framing (original D30) — required source-string lookup or a recursive AST walk to decide; messier implementation, no clearer semantics
- × Optional `;` (D11's original wording) — ambiguity costs (empirical: JS ASI bugs)
- × Significant newlines as separators — line-ending variance, tooling fragility, Python-style indentation issues

## D31: Arithmetic safety — Int division returns `T | Error`; Float follows IEEE

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
- The expression argument to the last `next` statement in a `fn(){}` body
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

`?:` is a value-ternary expression. Both branches are required and must produce values of compatible types. **Exception**: `break` and `done` (control-flow keywords that never return) may appear in either branch. They are bottom-typed — the result type is determined by the non-bottom branch (or is bottom itself if both are).

`next` is **not** allowed inside `?:` branches — it is statement-only. For value-choice emission, write `next cond ? X : Y` (the `next` is outside; the ternary is pure value).

Patterns:
- `cond ? a : b` — pure value-ternary; both branches required.
- `cond ? break : value` / `cond ? done : value` — control-or-value (bottom branch + value branch).
- `cond ? break : break` — both bottom; result type bottom (chain stage terminates on either path). Redundant; warn or fold.
- `cond ? break : done` — both bottom, different exits. Valid.
- `next cond ? X : Y` — value-choice emission (next outside).

Forbidden:
- Single-branch `cond ? value` with non-bottom value (which branch supplies a value when cond is false?).
- `cond ? next X : Y` / `cond ? Y : next X` / `cond ? next X : next Y` — mixed-kind or redundant; use `next cond ? X : Y` instead.
- Mixed-kind without a bottom branch (one branch a statement, the other a value).
- `next` inside `{}` expression-list (still applies — see D16).

Rationale:
- The user's range idiom `loop >> { $ >= n ? break : $ }` reads naturally. Allowing `break`/`done` as bottom-typed branches makes this expressible without falling back to chain dispatch or two-statement form.
- `next` is excluded because, unlike `break`/`done`, it continues after emitting — its "return value" is ambiguous in expression position. The canonical value-choice form `next cond ? X : Y` is unambiguous.
- Compiler lowering: bottom-branch ternary compiles to `if/end` (no `(result T)` block); pure value-ternary compiles to `if (result T)/else/end`. Different shape, both clean.

- \+ P1 ✓ one form per operation; only the redundant case forbidden
- \+ P3 ✓ syntactic shape signals intent; bottom-typed branches are explicit
- \+ Range and take-N idioms are concise (`loop >> { cond ? break : $ }`)
- − Mixed-with-bottom rule needs the type system to know about bottom (small addition)
- × Allowing `next` in branches — ambiguous semantics; `next cond ? X : Y` is the unambiguous form
- × Forbidding all statements in ternaries — loses the range/break idiom
- × Allowing arbitrary mixed-kind — loses transparency; harder to read

## D34: `error` is a built-in function producing an Error value

`error: fn(code: String): Error` is a built-in function always in scope. The name `error` is reserved — user code cannot define a local or top-level binding named `error`.

When called, returns an `Error` value (D24) with `id = @.module + '/' + code` and `stack = @.captureStack()` — both compiler-synthesized at the call site. That synthesis is the only special behavior; otherwise `error` is a regular function value (lowercase per D13).

Used in any expression position. Emission via `next`:

```
next error('NOT_FOUND')                        # emit a freshly constructed error
cond ? error('bad') : someValue                # value-position ternary branch
next cond ? error('bad') : 42                  # idiomatic emit-or-value choice

parseInt = fn(s: String): Int32 | Error {
    next @.len(s) == 0 ? error('empty') : 42
}
```

For *re-throwing* an existing Error inside a catch handler, use `next e` — `error` constructs a new Error at its call site.

- \+ No new keyword; just a function value with reserved name
- \+ Compiler-synthesized id/stack hidden behind the function abstraction
- \+ Replaces D26's type-call construction (which is retired) for the Error case
- \+ Aligns with "errors are values" (D23) — `error('X')` produces the value, not a side effect
- − Ad-hoc reserved name; no general "prelude" mechanism yet — formalize later if more built-ins want top-level visibility
- × `error` as a keyword — keyword class adds grammar surface for what's just a function call
- × `Error('X')` type-call — required D26 just for Error
- × `@.error('X')` stdlib-only — verbose for the common case
- × Allowing user shadowing of `error` — defeats universal availability and creates surprises

## D35: Built-in types are nominal; user types are structural

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

Variable-length homogeneous collections move to **stdlib `Array<T>`**. Arrays are runtime data structures with their own operations (`@.each`, `@.len`, `@.get`, `@.map`, `@.filter`, etc.) and are not pattern-matched by destructure.

| Aspect | Data block | Array |
|---|---|---|
| Shape | known at compile time | variable at runtime |
| Storage | inline tuple (stack/struct) | heap-backed collection |
| Type expression | `[T, U]`, `[a: T, b: U]` | `Array<T>` |
| Singleton-collapse (D10) | applies | doesn't apply |
| Pattern matching | yes — destructure / projection | no — use stdlib transforms |
| Indexing | `.N` (literal position) or `.label` | `@.get(arr, i)` |
| Length | known (statically) | `@.len(arr)` |
| Built-in marker | yes (no stdlib needed for storage) | yes (compiler-aware for codegen) |

This retires D29's `T[]` notation. Array literals use stdlib: `@.array(1, 2, 3)` constructs an `Array<Int32>`. Streaming bridges: `stream >> @.collect` materializes; `arr >> @.each` re-streams.

For example: stack frames (D24) now use `Array<Frame>` instead of `Frame[]`.

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

A data block literal with exactly one item AND that item is labeled is **invalid syntax**. Similarly, a labeled record type with a single field is **not declarable**.

```
[1]                              # OK — singleton, D10 collapses to scalar 1
[5]                              # OK — singleton, collapses to scalar 5
[b = 5]                          # COMPILE ERROR — single labeled item
[a = 1, b = 2]                   # OK — multi-field labeled record

type Foo = [name: String]        # COMPILE ERROR — single-field labeled type
type Foo = String                # OK — type alias to a scalar (same semantic)
type Point = [x: Int32, y: Int32]   # OK — multi-field labeled record
```

The motivation is removing ambiguity created by the combination of:
- D10's singleton-collapse rule: `[T]` ≡ `T` (1-element data block collapses to scalar).
- Labels as metadata (D36): labels don't affect the structural type.

Together these mean `[b = 5]` would be structurally identical to `5` (scalar) — the label `b` is purely decorative and runtime-erased. Three pattern-matching paths could converge here (singleton-collapse, label-projection, scalar match) producing the same result but with confusingly different reasoning. Banning the construct removes this redundancy.

Implications:
- Named single-arg calls like `f(x = 5)` are **call-site sugar** (not data block construction); the label matches the fn's parameter name to provide intent at the call site. No `[x = 5]` data block is created.
- Single-field "named types" use scalar type aliases instead: `type Field = Int32`.

- \+ P1 ✓ removes the "three reasoning paths to same result" ambiguity
- \+ P3 ✓ no ghost labels surviving singleton-collapse
- \+ Compiler treats all 1-arity values as scalars uniformly (no "decorated scalar" exception)
- − Single-field "branded" records aren't expressible — but user-branded types are deferred per D35 anyway
- × Allow but treat `[b = 5]` as scalar with metadata — three reasoning paths leak into user-visible behavior
- × Allow at construction but ban at type — asymmetric; one is a constructive case, the other definitional; both share the same ambiguity

## D38: Parameter defaults via `void` sentinel

A function parameter may declare a default expression: `(name: T = expr)`. The parameter's call-facing type is effectively `T | Void` (callers may pass `void` to use the default); the body sees the narrowed type `T` because default substitution happens at the param-binding step (before the body runs).

```
addOne = (n: Int32 = 41): Int32 { n + 1 };

addOne(5)              # n = 5
addOne(void)           # default 41 substituted at param binding → n = 41
addOne(n = void)       # named, same effect → n = 41
addOne(n = 5)          # named, explicit → n = 5
```

**Default expressions** may reference earlier params (left-to-right order):

```
relate = (a: Int32, b: Int32 = a + 1): Int32 { a + b };
relate(3, void)        # b defaults to a + 1 = 4 → a+b = 7
```

**Call rules**:
- **Positional call**: every slot must be specified. Pass `void` for defaulted slots to use their defaults.
- **Named call**: only mention overrides; omitted slots use their defaults.
- **Empty call `f()`**: passes `[]`; matches only a 0-param fn (no "all defaults" sugar — per D12's strict data-block construction).
- **`void` on a required (non-defaulted) param**: compile error.

**The `void` sentinel** is the lowercase value of type `Void` — the unique inhabitant of Void. Using it positionally or in named form triggers the default substitution.

**Body's narrowed view**: because the default substitution happens before body execution, the body sees the param as `T` (the declared type), not `T | Void`. No body-level narrowing required — the param is single-typed throughout the body.

```
# What the user writes:
addOne = (n: Int32 = 41): Int32 { n + 1 };

# Compiler-internal view at the binding step:
# (n: Int32 | Void)  →  if n is Void, n := 41  →  body sees n: Int32
```

- \+ P3 ✓ defaults are visible in the signature; `void` at call site is explicit
- \+ Body sees concrete `T`, no unions to narrow at every use
- \+ Defaults at any position — no required-after-default ordering constraint
- \+ Sparse named calls (`f(b = 99)`) work naturally; positional uses `void`
- − `f(void, void, ...)` is verbose for "all defaults" — intentional nudge toward named-call form
- × `f()` as "all defaults" sugar — violates D12 (calls construct a specific-arity data block); would require special-case logic
- × Trailing-defaults-only (Python/Swift) — forces ordering; gb allows defaults anywhere via explicit `void`
- × Body sees union `T | Void` — every use site would need narrowing; defeats the ergonomic purpose of defaults

---

## Open / Deferred

Tracked in `potential-features.md`:
- `use` import keyword
- UTF-8 string encoding commitment
- `=>` arrow lambda form
- Compiler pipeline fusion for `loop` (performance optimization)

Rejected:
- `as` type-casting operator — replaced by stdlib conversion functions (`@.toInt64`, `@.toFloat32`, `@.parseInt`, etc.) returning `T` for lossless conversions and `T | Error` for lossy ones. Conversions are regular function calls; compiler inlines to WASM conversion instructions.

Not yet decided / specced (future waves):
- Function types beyond bare `Fn` (`fn(Int32, Int32): Int32` style)
- Module resolution / file paths (compiler/tooling concern)
- `main` block semantics in non-entry modules
- Multi-level break (labeled loops)
- Type narrowing implementation depth
