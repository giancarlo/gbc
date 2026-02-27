# GB Programming Language

The GB programming language is a concise, type-safe, and functional programming language that emphasizes immutability, modularity, and streamlined syntax.

## Hello World

This is a sample of a simple "Hello World" program. The _main_ block is our entry point. No code is allowed outside of it other than type and function definitions. The standard library is always available through the _@_ operator. The pipe `>>` operator will call the `@.out` function passing its left value as an argument.

```
main { 'Hello World' >> @.out }
```

## Design Constitution

Language features must avoid breaking these rules:

1. **One Way:** Restrict multiple ways to accomplish the same task.
2. **Built-in Best Practices:** Enforce optimal patterns via syntax and types.
3. **Transparency:** No hidden or implicit behavior.
4. **No Bloat:** Only essential features.
5. **Readable:** Prioritize clarity.

## Lexical Elements

### Comments

Comments start with the `#` character and end at the end of line.

### Identifiers

Identifiers must begin with a letter and can include alphanumeric characters or underscores.

### Keywords

The following keywords are reserved.

as - Type Casting
done - Mark the function as complete
next - Emit the next value from a function
type - Define a type alias or structure
use - Bring symbols into scope (import)
main - Source File entry point
export - Export module symbol

### Operators

| Symbol | Description                      |
| ------ | -------------------------------- |
| !      | Boolean NOT                      |
| ~      | Bitwise NOT                      |
| &      | Bitwise AND                      |
| &&     | Short-circuiting logical AND     |
| \*     | Arithmetic multiplication        |
| +      | Addition                         |
| -      | Arithmetic Negation (Unary)      |
| -      | Arithmetic Substraction          |
| .      | Member access                    |
| /      | Arithmetic division              |
| <      | Less than comparison             |
| <=     | Less than or equal               |
| =      | Assignment                       |
| ==     | Equality comparison              |
| >      | Greater than comparison          |
| >=     | Greater than or equal comparison |
| >>     | Pipe Operator                    |
| \|     | Bitwise OR                       |
| \|\|   | Short-circuiting logical OR      |
| ?..:   | Conditional Ternary Operator     |
| :>     | Bitwise Shift Right              |
| <:     | Bitwise Shift Left               |
| ++     | Increase                         |
| --     | Decrease                         |

### Number Literals

    decimal_lit    = "0" | ( "1" ... "9" ) [ [ "_" ] decimal_digits ]
    binary_lit     = "0" ( "b" ) [ "_" ] binary_digits .
    hex_lit        = "0" ( "x" ) [ "_" ] hex_digits .

    decimal_float_lit = decimal_digits "." [ decimal_digits ] [ decimal_exponent ] |
                        decimal_digits decimal_exponent |
                        "." decimal_digits [ decimal_exponent ] .
    decimal_exponent  = ( "e" | "E" ) [ "+" | "-" ] decimal_digits .

    42
    4_2
    0600
    0_600
    0xBadFace
    0xBad_Face
    0x_67_7a_2f_cc_40_c6
    0b0101010101_10
    170141183460469231731687303715884105727
    170_141183_460469_231731_687303_715884_105727

    42_         // invalid: _ must separate successive digits
    4__2        // invalid: only one _ at a time
    0_xBadFace  // invalid: _ must separate successive digits

    NaN // Not a Number
    Infinity

    72.40
    072.40       // == 72.40
    2.71828
    1.e+0
    6.67428e-11
    1E6
    1_5.         // == 15.0
    0.15e+0_2    // == 15.0

    1_.5         // invalid: _ must separate successive digits
    1._5         // invalid: _ must separate successive digits
    1.5_e1       // invalid: _ must separate successive digits
    1.5e_1       // invalid: _ must separate successive digits
    1.5e1_       // invalid: _ must separate successive digits

### String Literals

String literals are immutable. All strings are utf8 encoded.

```
    'variable length \'string\''
    '
        Multiline
        String
    '
    str1 = '${1}+${1}=${1+1}'
```

#### Escape Sequences

| Symbol     | Description                    |
| ---------- | ------------------------------ |
| \n         | Newline                        |
| \r         | Carriage Report                |
| \t         | Tab                            |
| \'         | Single Quote                   |
| \0         | Null Character                 |
| \u{NNNNNN} | Hexadecimal Unicode code point |

### Boolean literals

    true | false

### Data Blocks

Data blocks are enclosed in brackets '[]' and are zero-indexed.

```
# Creates a list named `a` containing a string 'string' and the integer 2.
a = [ 'string', 2 ]
# Creates a list named `b` containing a named element `label` with the value 'string' and the integer 2.
b = [ label = 'string', 2 ]
```

By default data is immutable. The 'var' type modifier can be used to specify variable fields.

In the example below, we declare `field` as a mutable variable, allowing its value to change. However, the entire `c` data block itself cannot be reassigned to a new value.

```
c = [
    label: var boolean | string = true,
    2
]

# Valid
c[0] = 'string'
c.field = false

# Results in compiler error
c.field = 10
c[1] = 3
```

All data structures are iterable:

    [ a=1, b=2 ] >> @.each >> @.out

### Variable Definition

Variables act as named containers for data. You define a variable by giving it a name and assigning it a value using the equals sign (`=`). By default, these variables are immutable. You can declare it as mutable using the `var` keyword.

If you don't explicitly specify the type of data a variable will hold, the compiler will determine it based on the value you assign during declaration.

```
# Define a constant with name 'constant', type 'string', and value 'value'
constant = 'value'

# 'variable' will be a variable with value '10.0' and type 'float'
variable: var = 10.0
```

#### Variable Rules

1. No Variable Shadowing
2. No Unused Variables
3. Must be assigned a value during declaration.

### Ternary Operator

The ternary operator syntax is `condition ? true_value : false_value`. The `else` part (`: false_value`) is optional. If you omit it, the expression emits a value only when the condition is truthy.

```ts
condition ? { $ + 1 } >> @.out
```

The `$` keyword holds the result of the condition expression.

## Types

### Numeric Types

    uint = uint8 | uint16 | uint32 | uint64
    int = int8 | int16 | int32 | int64
    float32 | float64

### String Types

    # var str can contain any string
    str: var string = ''

    # Variable name can only contain the values 'foo' or 'bar'.
    name: var 'foo' | 'bar' = 'bar'

### Data Types

    a: [ byte, string ] = [ 10, 'foo' ]
    b: [ age: number, name: string ] = [ 20, 'foo' ]
    # b.name contains 'foo'

    c: [ [int,int,int],[int,int,float],[int,int,int] ]

    type Expr = [ p1: number, p2: string ]
    a: Expr = [ 10, 'ten' ]

### Function Types

    type Fn = fn(:number): void

### Literal Types

    'string type' | 1 | true | false

### Other Types

    boolean, void, error

### Intersection Types

A value of an intersection type must satisfy all of the constituent types.

```
type A = [ x: int ]
type B = [ y: string ]

# Intersection type AB must have both fields x (int) and y (string)
type AB = A & B

# Usage
example: AB = [ x = 42, y = 'foo' ]
```

## Modules

- Each module is a single source file.
- Modules can contain function, type, and variable definitions, along with an optional `main` block.

### Importing modules

To import members from a module, use the `@` operator followed by the module's path and the desired member name. Paths are relative to the module.

```
@module.path.function()
```

The `@` operator can also be used to access standard library functions directly by referencing it with an empty path. For example, `@.out` refers to the standard output function.

## Functions

- Functions are defined with `{}`. To declare parameters, prepend the block with `fn`.
- Functions accept a single argument. That argument can be a data block, and with `fn` syntax its fields are available as individual variables.
- Functions can accept other functions as parameters or return functions.
- The argument is available as `$`. Named arguments can be accessed by appending their name to `$`, for example `$varName`.
- One-line functions automatically emit the value of the single expression.

This function takes two integers `a` and `b` and returns their sum. The result type is optional, will be infered by compiler.

```ts
add = fn(a: int, b: int): int {
	next a + b
}

[a = 1, b = 2 ] >> { $a + $b } >> @.out
```

### Arguments

Functions can take only one argument. The call `()` operator groups comma-separated values into a data block, so `fn(1, 2, 3)` passes `[1, 2, 3]` to the function.

```
x = { $ }
x(10)        # $ is [10]
x(1, 2, 3)   # $ is [1, 2, 3]
10 >> x.     # $ is 10

y = fn(a: int) { a }
y(10)        # a is 10
```

A function call with one argument still wraps the argument into a data block, while the pipe passes the value as-is. That’s why these are not equivalent:

```
x = { $ }

x(10)        # $ is [10]
10 >> x      # $ is 10
```

If the function expects a field-based argument, piping a raw value can error:

```
z = fn(a: int) { a }

z(10)        # a is 10
[10] >> z    # a is 10
10 >> z      # type error
```

If you want the pipe to behave like a call, wrap the value:

```
[10] >> z
```

You can also provide a type for the `$` parameter.

```
inc = fn($: int) { $ + 1 }

sum = fn($: [a: int, b: int]) { $a + $b }

accept = fn($: int | string) { $ }
```

### Named Arguments

If named arguments are used, all arguments must include the name.

```ts
add = fn(a: int, b: int): int { a + b }

add(1, 2)       # Positional arguments
add(b = 1, a = 2) # Named arguments
```

### Default Parameters

```ts
greet = fn(name: string = "World"): string {
    next "Hello, " + name + "!"
}

greet()          # Output: "Hello, World!"
greet("Alice")   # Output: "Hello, Alice!"
```

The `greet` function has a default parameter `name` with a value of `"World"`.

### Recursion

Functions can call themselves recursively.

```ts
factorial = fn(n: int): int {
    next (n <= 1) ? { 1 } : { n * factorial(n - 1) }
}
factorial(5)    # Output: 120
```

### Emitting Values with `next`

The `next` keyword is used within a function to emit a value.
A function can emit one, multiple or zero values.

```ts
emitValues = {
    next(1, 2, 3)
    done
}

{ 1, 2, 3 } >> @.out

# Emit the values `1`, `2`, and `3` before calling `done` to signal completion.
emitValues() >> @.out
```

#### Comma Operator

The comma operator `,` separates expressions within a code block.
Each expression separated by a comma is evaluated, and its result is emitted as a separate value.

```ts
2 >> { $ / 2, $ * 2 } >> @.out
```

This code emits `1` (2 divided by 2) and `4` (2 multiplied by 2).

### Completion

Functions complete execution once all expressions have been evaluated and their corresponding values emitted.
The done keyword can be used to explicitly signal early termination if needed.

### Chaining

Functions can be chained to perform multiple operations in sequence.
The pipe operator `>>` passes the left value into the right stage as its argument. The argument is bound to `$`.

```ts
increment = { $ + 1 }
double = { $ * 2 }
3 >> increment >> double >> @.out
```

#### Value Flow

- If a stage emits multiple values, each value is passed downstream independently.
- If a stage emits nothing, downstream stages receive nothing for that path.
- The pipeline completes when all upstream emissions are consumed.

```
2 >> { $ / 2, $ * 2 } >> { $ + 1 } >> @.out
# Emits 2 values: 2 >> {1, 4} then +1 => 2 and 5
```

## Error Handling

Errors can be emitted by any stage in a pipeline or from direct function calls. If no `catch` is present, the error propagates to the caller and terminates the current pipeline.

Errors implement the Error type. The _error_ function can be used to create errors at runtime.

```ts
type Error = [code: string, message: string];
```

### `catch` Block

The `catch` block in a stream pipeline intercepts errors and defines custom error-handling behavior. `catch` applies to the nearest upstream pipeline stage that can emit an error.

The `$` keyword will be available inside the catch block and it will contain the caught error.

```ts
    open('file') >> catch { open('file2') } >> { ... }
```

Inside a `catch` block, you can rethrow the original error with the `error` keyword. This allows later stages of the stream or the caller to handle it.
To recover, use `next` to emit a value and continue the pipeline with it as a normal value.

```ts
fetchUser = fn(id: string) {
    @db.getUser(id) >> catch {
        $code == 'not_found'
            ? { next @cache.getUser(id) }
            : { error $ }
    }
}

fetchUser('u1') >> @.out
```

You can chain multiple `catch` blocks. The first `catch` that handles the error determines the value passed downstream.

```ts
readUser = fn(id: string) {
    @db.getUser(id)
    >> catch { $code == 'not_found' ? { next @cache.getUser($id) } : { error $ } }
    >> catch { [ code = 'unknown', message = 'fallback user' ] }
}
```

If a `catch` block completes without emitting, downstream stages receive no value. `done` can be used to terminate handling early after recovery logic.

When a function can recover with `next`, its effective output type includes both normal values and recovery values.

## Statements

### loop

Emits `void` while the condition returns a truthy value.

    loop <condition>
    5 >> loop { $ --> 5 } >> @.out
    0 >> loop { $++ < 5 } >> @.out
