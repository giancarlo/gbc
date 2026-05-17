# Potential Features

## Host Bindings (`external`, curated `@` modules)

The language needs a way to call host-supplied functions — print to stdout, fetch a URL, read a file, manipulate the DOM, etc. The proposed design layers three mechanisms; v1 ships only the innermost (compiler-internal stdlib use); the outer layers are deferred until demand justifies them.

### Layer 1 — Internal `external` (v1, compiler-only)

`external` is a top-level keyword that declares a function whose implementation lives outside gb. In v1, **only the stdlib uses it**; not exposed to user code.

```gb
# compiler/stdlib.gb (internal)
external out_str = fn(s: String): Void host {
    console.log(decodeString(s))
}

external out_i32 = fn(n: Int32): Void host {
    console.log(n)
}
```

- The `host { ... }` body is opaque host-language source (currently JS). Compiler doesn't parse it as gb.
- The declaration creates a WASM import: `(import "env" "out_str" (func (param i32)))`.
- The compiler bundles inline-JS bodies of *reachable* externals into the output's host-binding file (`.host.js`). Unused externals are tree-shaken.
- The compiler injects helpers (`decodeString`, `memory`, etc.) into the JS scope.

User-facing `@.out`, `@.in`, etc. stay compiler-controlled intrinsics that dispatch to the right external by argument type — no language-level overloading needed yet.

### Layer 2 — Curated `@` modules (deferred)

The stdlib grows into vendored, platform-specific modules:

```gb
@.io.out, @.io.in              # universal stdio
@.fs.read, @.fs.write          # node target
@.dom.query, @.dom.addEventListener  # browser target
@.fetch                         # both
@.now, @.random, @.sleep        # universal
```

- Each module is gb code in `compiler/stdlib/<name>.gb` with declared externals + their inline JS impls.
- Compiler tracks target (browser / node / universal). Using `@.dom` in a node-target build → compile error.
- Tree-shakable: a Hello World program reachable through `@.io.out` ships ~5 lines of host JS; a DOM-heavy program ships hundreds, only what it calls.

### Layer 3 — User-facing `external` (deferred, escape hatch)

When curated modules don't cover something a user needs (custom hardware, npm packages, novel browser API), the user writes the same `external` decl that stdlib uses:

```gb
# user's main.gb (deferred)
external send_to_widget = fn(id: Uint32, payload: String): Void host {
    document.getElementById(`widget-${id}`).postMessage(decodeString(payload))
}
```

CLI shows a portability warning when user code declares externals — "this module ties itself to the host runtime."

### Coverage estimate

| Layer | Coverage of host-FFI needs |
|---|---|
| 1 (stdlib internal only) | 100% of language plumbing, 0% of user FFI |
| 1 + 2 (curated modules) | ~90% of typical user needs (stdio, files, fetch, DOM basics, timers, crypto) |
| 1 + 2 + 3 (user `external`) | Everything reachable from the host |

### Tree-shaking

The inline-JS body lives in the gb source alongside the declaration. The compiler walks reachable code and emits the JS impl of each reachable external into the output's `.host.js`. Compile-time DCE; no per-build npm-tree-shaker invocation needed.

For precompiled binary modules (future), each module ships its JS payload alongside its WASM:

| Format | Shape | Tree-shake |
|---|---|---|
| Source (`.gb`) | one text file | natural (compiler) |
| WASM + host JS pair | `mod.wasm` + `mod.host.js` | needs `wasm-opt` + JS bundler at link time |
| Single-file JS bundle | `.gb.js` with base64'd WASM + bundled host fns | needs JS bundler (Rollup, esbuild) |
| Custom-section embed | `.wasm` with `gb-host` custom section holding the JS | needs custom `gbc-link` tooling |

V1 ships **source distribution only**. Precompiled module formats are added later when build-time becomes a real concern.

### Linking multiple modules

Each module brings its own host bindings. At instantiate time, the `env` namespace is the union of every loaded module's host fns. Standard multi-module WASM linking — the inline-JS pattern doesn't alter this.

### Open questions

- **Syntax for the host body.** Options surveyed: backticks `` ` ``, `js { ... }`, `host { ... }`, string after `=`. `host { ... }` is host-language-agnostic (future-proof if we ever target wasm-with-component-model or a non-JS host) but adds a keyword. `js { ... }` is shorter and accurate for current scope. Picking deferred until user-facing layer 3 ships.
- **Helper injection.** What variables (`memory`, `decodeString`, `encodeString`, `alloc`, ...) are in scope inside a `host` body. Needs a documented stable API.
- **Multi-target.** Should one `external` declaration carry multiple `host { ... }` bodies for different targets (browser vs node)? Or one external per target with compile-time selection?
- **Async externals.** WASM imports are synchronous; async JS values need adapters (JSPI proposal, or polling/promise-handle pattern).

## `=>` Arrow Lambda Form

Concise form for named-parameter functions that auto-emit a single expression.

```
fib = fn(n: Int) => n <= 1 ? n : fib(n - 1) + fib(n - 2)
add = fn(a, b) => a + b
```

Currently rejected (see `decisions.md` D16): there are already two forms — anonymous
blocks `{ expr }` auto-emit, and `fn(...) { body }` requires explicit `next`. Adding
`=>` is a third way to express auto-emit with named parameters — a One Way violation
with only ergonomic gain (~50% character reduction for short helpers).

Could be revisited if short utility functions become common enough that the
verbosity of `fn(a, b) { next a + b }` becomes a real friction.

## `use` (Import Keyword)

Bring symbols from a module into the current scope.

```
@module.path use func1, func2
foo use a, b as renamed
```

See also: Modules > Object Destructuring below.

## String Encoding (UTF-8)

Commit the language to UTF-8 as the string encoding.

Implications to resolve:
- Indexing semantics: does `.0` on a string yield a byte, a code point, or a grapheme cluster?
- Length: is `string.length` bytes or code points?
- Interop: how do non-UTF-8 sources (e.g., file I/O) enter the type system?

Alternative: leave encoding unspecified at the language level; let stdlib operations declare per-call.

## Modules

### Main Block

The main block is only executed for the entry module. Imported module's main blocks are ignored.

### Object Destructuring

The `use` operator after the data block allows member autocomplete.

```
# Add symbols to current scope
module use a, b as B, c use d, e

@module.file use func1, func2

[1, 2, 3] >> each >> [ a, b ,c ];

[1, 2, 3] >> { $0, $1, $2 } >> @.out;

[a=1, b=2, c=3] >> { $a, $b, $c } >> @.out;

```

## Default Parameters

- https://quuxplusone.github.io/blog/2020/04/18/default-function-arguments-are-the-devil/

## Sequences

    1,2,3 >> { $ * 2 } >> std.out # Prints 246
    a, b = 1, 2 # a=1, b=2

## Blocks that never return?

    block = { }
    block() # works
    a = block() # Error, cannot assign void value

## impure function attribute

    block = impure fn() { ... }

## Data Pointers

```ts
a = [ 1, 2, 3, 4, 5, 6, 7, 8 ];
b = "string"

ptr = pointer(a, 4) # a@4

ptr() # 5
ptr(-1) # 4
```

```ts
each = {
	(data: [])
	var i = 0
	while { i < length(data) } >> { next data[i++] }
}
```

Global Common Denominator

```ts
while = fn(pred: { :boolean }) { loop >> { pred() ? next : done } }
until = fn(pred: { :boolean }) { pred() ? done : next $ }

gcd = fn(a: int, b:int) {
	while { b != 0 } >> { a, b = b, a % b }
	loop >> { a, b = b, a % b } >> until { b == 0 }
	return a
}
```

## Expression Problem

Code block unions ?

```ts
var stringify: | :unknown | : string =
	{ | :number | std.toString($) } |
	{ | :[Expr, Expr] | stringify($.0) + ' + ' + stringify($.1) }

var evaluate: | :unknown | : number =
	{ |:number| $ } |
	{ | :[Expr, Expr] | evaluate($.0) + evaluate($.1) }
```

`satisfies` operator?

### Adding a New Method

```ts
var serialize: | <T>| :T | [:string, :string] =
	{ | :number | ['number', std.toString($) ] } |
	{ | :[Expr, Expr] | [ '[Expr, Expr]', serialize($.0), serialize($.1) ] }
```

Variable Types?

### Adding a New Type to Expr

```ts
stringify |= { | :string | '"' + $ + '"' }
evaluate |= { | :string | $ }
serialize |= { | :string | ['string', s] }
```

## Data Concatenation

```ts
a = [ 1, 2, 3 ]
b = [ 4, 5, 6 ]
c = [ ..a, ..b ]

concat = {
	<A extends [], B extends []>|a: A, b: B| : [..A, ..B]
	[..a, ..b]
}

concat(a,b);

```

## Operators

### is

    10 >> is(2, 3, 4) # false
    'foo' >> is(/f../) # true

### while

```ts
while = fn(condition: { :boolean }) {
	loop { condition() ? next : done }
}
var x = 0;
while { x < 2 } >> { x++ } >> std.out # Prints 1
```

### each

```ts
    each = fn<T>(iterable: T[]): T  {
        len = length(iterable);
        var i = 0;
        loop { i < len ? next iterable[i++] : done }
    }

	a, b = each([1,2]) # a=1, b=2
	# Equivalent to
	a, b = 1, 2

	a = each([1, 2]) # Error, all values must be used

    [ 1, 2, 3, 4 ] >> each >> { $==2 ? done }
	# Equivalent to
	1, 2, 3, 4 >> { $==2 ? done }
```

### for

    10..5 >> std.out # prints [10,9,8,7,6]

## Pattern Matching

Chains + nested ternary + `is` (D21) already cover most of pattern matching's utility:

| PM feature | Existing GB equivalent |
|---|---|
| Value cases | `value >> { $ == X ? A : $ == Y ? B : C }` |
| Type cases | `value >> { $ is T ? A : $ is U ? B : C }` |
| Type narrowing in arm | D21 — `is` narrows in truthy branch automatically |
| Guards | nested ternary already takes any Bool expression |
| Default / catch-all | the final `: default` branch |
| Multiple alternatives per arm | `$ == X \|\| $ == Y ? ...` |

What chain-based dispatch doesn't cover — and what a future Pattern Matching feature would add:

- **Destructuring patterns** — `[head, ..tail]`, nested struct destructure
- **Exhaustiveness checking** — needs closed sum types

Sketch (only the parts existing primitives don't cover):

```ts
result = value match {
    [head, ..tail]      => head + sum(tail)
    Error('NOT_FOUND')  => default
    _                   => 'other'
}
```

Open design questions:
- Whether sum types are added as a distinct feature first
- Compile-time exhaustiveness — needs closed type sets
- Compiler lowering — `br_table` for dense int patterns, decision tree otherwise
- Relationship to D21 narrowing — match arms should produce the same narrowing

Subsumes the retired `### switch` sketch.

## Tagged Templates

tag'string ${hello}'

## JSX

    a = li(children=['List Item']);
    b = ul(children=[a]);

    ul(className = 'cls', children = [a]);

    a = <li>List Item</li>;
    b = <ul>{a}</ul>;

## Types and Decorators

```ts
@cxl/component [ Component, augment, attribute, bind, get, tagName ]
import './a11y' [ role ]

[ a, slot ] = std.dom

##
# Bindable Link Component.
#
type A {
	// Left operand of '.' would be the current context (this), in this case type A instance
	.extends(Component)
	.tagName('cxl-a')
	.setAttribute('role', 'link');

	bind($, {
		el = @dom.a(style=[color='inherit'] children=[slot()])

		return [
			el,
			{ get($, 'href') >> { el.href = $ } },
			{ get($, 'target') >> { el.target = $ } }
		]
	})

	@attribute()
	target: '_blank' | '' = ''

	@attribute()
	var href = ''
}

export [ A ]
```

## Function Input and Parameters

```ts
a = fn(:inputType, ...optional parameters) expr;

add = fn(:int, b:int, c:int) { $ + b + c }
add(1, b=10, c=21)
```

```ts
fn partition<T>(a: Array<T>, pred: fn(:T): boolean) {
    var i = 0;
    var j = len - 1;

    loop {
        loop { pred(a[i]) ? done : i++ }
        loop { pred(a[j]) ? j-- : done }
        i >= j ? done : swap(a[i], a[j])
    }

    next i
}

fn quicksort<T>(a: data<T>) {
    len < 2 ? done
    pivot = a[len / 2];

    i = a->partition({ n < pivot });
    a->slice(0, i) >> quicksort;
    a->slice(i + 1, len - i) >> quicksort;
}
```

### Function Overloading

Functions can be overloaded, allowing multiple functions with the same name but different parameter lists.

```ts
fn print(value: int) {
    @.out(value.toString());
}

fn print(value: string) {
    @.out(value);
}

print(42)       # Output: "42"
print("Hello")  # Output: "Hello"
```

- The `print` function is overloaded to handle both integers and strings.

### Should variable mutability be part of the type declaration?

```
type MutableString = var string;
x: MutableString = 'hello';

var x: string | boolean = true;
vs
x: var string | boolean = true;
```

## Macros

Macros allow compile-time code generation. A macro is defined as a special function that takes parameters and has read-only access to the AST node of the statement immediately following it. The macro's body determines how the given AST node is positioned within the generated code.

### Defining a Macro

A macro is declared using the `macro` keyword. It can accept parameters in addition to the AST node it modifies.

```
macro log(fn: @.ast.Node['fn'], message: string) {
    'Starting: ${message}` >> @.out
	(fn)()
    'Finished: ${message}` >> @.out
}
```

### Using a Macro

Macros are applied to statements using the `#` syntax:

```
#log("Computation")
fn compute() => 42
```

### Expansion at Compile-Time

```
'Starting: Computation` >> @.out
(fn compute() => 42)()
'Finished: Computation` >> @.out
```

### Behavior

- The macro receives the AST node of the statement following it.
- It can insert the AST node anywhere within its generated code.
- It cannot modify the AST node itself.
- Macros **must return valid code**, ensuring correctness.

## Generics

Generics are defined using angle brackets `<>` with a type parameter.
The type parameter can be constrained to a certain type or range of types using the `extends` keyword.

```ts
fn add<T extends int>(a: T, b: T): T {
    next a + b
}

add(1, 2)    # Output: 3
```

The `add` function uses a generic type `T` that extends `int`. It can add two integers of the same type.

### Generic Constraints

Generics can be constrained to specific types or interfaces using the `extends` keyword.

```ts
display = fn<T extends string | int>(value: T): void {
    @.out(value.toString())
}

display("Hello")  # Output: "Hello"
display(123)      # Output: "123"
```

The `display` function accepts a parameter `value` of a generic type `T` that extends `string` or `int`. It can display either a string or an integer.

### Multiple Type Parameters

Functions can use multiple type parameters.

```ts
pair = fn<T, U>(first: T, second: U): (T, U) {
    (first, second)
}

# Outputs 1 and 'one'
pair(1, "one") >> @.out
```

The `pair` function uses two generic type parameters `T` and `U` to create a sequence from the two input values.

### Type Inference

The compiler can often infer the generic type based on the function arguments, so you may not need to explicitly specify the type.

Example:

```ts
identity = fn<T>(value: T): T {
    next value
}

identity(42)       # Output: 42
identity("Hello")  # Output: "Hello"
```

The `identity` function returns the input value as-is. The compiler infers the type of `T` based on the argument provided.

### Bounded Generics

Bounded generics restrict the types that can be used as type arguments. This is useful for ensuring type safety.

```ts
max = fn<T extends Comparable<T>>(a: T, b: T): T {
    next a.compareTo(b) > 0 ? a : b
}

max(5, 10)   # Output: 10
```

The `max` function uses a generic type `T` that extends `Comparable<T>`, ensuring that the type can be compared.

### Closures

Functions can capture variables from their surrounding scope, creating closures.

```ts
makeCounter = {
    count: var = 0
    next { count += 1 }
}

counter = makeCounter()
counter()    # Output: 1
counter()    # Output: 2
```
