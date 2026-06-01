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

## D21: `is` operator for type tests + narrowing

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

## D23: Errors are values; chain-routed propagation

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

## D24: Built-in `Error` type with auto-filled id and stack

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

## D25: `catch(T)` — parameterized type modifier for chain handlers

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

## D26: Types are callable as constructors — RETIRED

Withdrawn. Type construction is via typed data blocks: `[args]: T` (positional) or `[x = a, y = b]: T` (named). Factory functions (a regular function returning the type) cover construction with logic. The motivating Error case is handled by the `error` keyword (D34).

Originally proposed so `Error('code')` and user types like `Point(10, 20)` would share a uniform call syntax. With `error` as a keyword and computed-field user types deferred to factory functions, the type-call form has no remaining use case.

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

`?:` is a value-ternary expression. Both branches are required and must produce values of compatible types. **Exception**: `break` and `done` (control-flow keywords that never return) may appear in either branch. They are bottom-typed — the result type is determined by the non-bottom branch (or is bottom itself if both are).

`next` is **not** allowed inside `?:` branches (statement-only); for value-choice emission write `next cond ? X : Y` (`next` outside the pure-value ternary). The range idiom `loop >> { $ >= n ? break : $ }` motivates admitting bottom branches. `next` is excluded because, unlike `break`/`done`, it continues after emitting — ambiguous in expression position. (Exact legal/illegal branch combinations: test.ts.)

- \+ P1 ✓ one form per operation; only the redundant case forbidden
- \+ P3 ✓ syntactic shape signals intent; bottom-typed branches are explicit
- \+ Range and take-N idioms are concise (`loop >> { cond ? break : $ }`)
- − Mixed-with-bottom rule needs the type system to know about bottom (small addition)
- × Allowing `next` in branches — ambiguous semantics; `next cond ? X : Y` is the unambiguous form
- × Forbidding all statements in ternaries — loses the range/break idiom
- × Allowing arbitrary mixed-kind — loses transparency; harder to read

## D34: `error` is a built-in function producing an Error value

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

## Open / Deferred

Tracked in `potential-features.md`:
- `use` import keyword
- UTF-8 string encoding commitment
- `=>` arrow lambda form
- Compiler pipeline fusion for `loop` (performance optimization)
- Dynamic (non-capturing) function values via funcref table + `call_indirect` (only when a real need arises; static cases monomorphize per D45)

Rejected:
- `as` type-casting operator — replaced by stdlib conversion functions (`toInt64`, `toFloat32`, `parseInt`, etc.) returning `T` for lossless conversions and `T | Error` for lossy ones. Conversions are regular function calls; compiler inlines to WASM conversion instructions.

Not yet decided / specced (future waves):
- Module resolution / file paths (compiler/tooling concern)
- `main` block semantics in non-entry modules
- Multi-level break (labeled loops)
- Type narrowing implementation depth
- Pick-class type operations (labeled-pattern destructure + constraint syntax; substrate landed in D43)
