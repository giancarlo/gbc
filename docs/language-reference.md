# GB Programming Language

The GB programming language is a concise, type-safe, and functional programming language that emphasizes immutability, modularity, and streamlined syntax. Its design revolves around the use of blocks as fundamental execution units, chained through the `>>` operator to represent pipelines of computation.

## Hello World

This is a sample of a simple "Hello World" program. The _main_ block is our entry point. No code is allowed outside of it other than type and function definitions. The standard library is always available through the _@_ operator. The pipe `>>` operator will call the `@.out` function passing its left value as an argument.

```
main { 'Hello World' >> @.out }
```

## Design Constitution

Language features must avoid breaking these rules:

1. **One Way:** The language design should restrict multiple ways to accomplish the same task.
2. **Built-in Best Practices:** Enforce optimal patterns via syntax and types.
3. **Transparency:** No hidden or implicit behavior.
4. **No Bloat:** Only essential, mainstream features.
5. **Readable:** Prioritize clarity and concise code.
   Syntax is clear enough to reduce need for comments.

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

    _42         // an identifier, not an integer literal
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

Data blocks are typed structures stored in -contiguous- memory. Data blocks are enclosed in brackets '[]' and are zero-indexed.

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
    field: var boolean | string = true,
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

1. **No Variable Shadowing:** Prevent variables within a block from masking wider scope variables with the same name.
2. **No Unused Variables:** Flag variables declared but never used.
3. **Mandatory Initialization:** All variables must be assigned a value during declaration.

### Ternary Operator

The ternary operator syntax is `condition ? true_value : false_value`. Here, the `else` part (`: false_value`) is optional. If you omit it, the expression emits a value only when the condition is true; otherwise, it emits nothing.

Example:

```ts
condition ? { $ + 1 }
```

This emits `$ + 1` when `condition` is true, and nothing if false.

The `$` identifier holds the result of the condition expression and represents the current value in the ternary operation.

## Types

### Numeric Types

    uint8       the set of all unsigned  8-bit integers (0 to 255)
    uint16      the set of all unsigned 16-bit integers (0 to 65535)
    uint32      the set of all unsigned 32-bit integers (0 to 4294967295)
    uint64      the set of all unsigned 64-bit integers (0 to 18446744073709551615)

    uint = uint8 | uint16 | uint32 | uint64

    int8        the set of all signed  8-bit integers (-128 to 127)
    int16       the set of all signed 16-bit integers (-32768 to 32767)
    int32       the set of all signed 32-bit integers (-2147483648 to 2147483647)
    int64       the set of all signed 64-bit integers (-9223372036854775808 to 9223372036854775807)

    int = int8 | int16 | int32 | int64

    float32     the set of all IEEE-754 32-bit floating-point numbers
    float64     the set of all IEEE-754 64-bit floating-point numbers

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

    type Fn = { (:number): void }
    type Fn2 = { (name: type): void }

### Type Parameters

    type Fn<T> = (:T): void

### Literal Types

    'string type' | 1 | true | false

### Other Types

    boolean, void, error

### Intersection Types

Intersection types allow you to create new types by combining multiple types together. A value of an intersection type must satisfy all of the constituent types.

```
# Define two types
type A = [ x: int ]
type B = [ y: string ]

# Intersection type AB must have both fields x (int) and y (string)
type AB = A & B

# Usage
example: AB = [ x = 42, y = 'foo' ]

# Functions can take intersection types as parameters
fn printFields(value: A & B) {
    @.out('${value.x}, ${value.y}')
}
```

## Modules

Modules serve as the primary building blocks for code organization and reusability. Each module is encapsulated within a single source file.

Modules can contain function and variable definitions, along with an optional `main` block. However, only functions are explicitly exported from a module.

### Importing modules

To import functions from a module, use the `@` operator followed by the module's path and the desired function name. Paths are relative to the

Only functions can be exported.

```
@module.path.function()
```

The `@` operator can also be used to access standard library functions directly by referencing it with an empty path. For example, `@.out` refers to the standard output function.

## Functions

Functions can have multiple parameters and are defined using the `fn` keyword.

-   Functions are defined using the `fn` keyword followed by the parameter list, return type, and body.
-   Functions can accept other functions as parameters or return functions.

This function takes two integers `a` and `b` and returns their sum.

```ts
add = fn(a: int, b: int): int {
	next a + b
}
```

### Named Arguments

Functions can be called with named arguments for clarity. If named arguments are used, all arguments must include the name.

```ts
add = fn(a: int, b: int): int { a + b }
add(1, 2)       # Positional arguments
add(b = 1, a = 2) # Named arguments
```

### Default Parameters

Functions can have default values for parameters, which are used if no argument is provided for that parameter.

```ts
greet = fn(name: string = "World"): string {
    next "Hello, " + name + "!"
}

greet()          # Output: "Hello, World!"
greet("Alice")   # Output: "Hello, Alice!"
```

The `greet` function has a default parameter `name` with a value of `"World"`.

### Closures

Functions can capture variables from their surrounding scope, creating closures.

```ts
fn makeCounter {
    count: var = 0
    next { count += 1 }
}

counter = makeCounter()
counter()    # Output: 1
counter()    # Output: 2
```

### Recursion

Functions can call themselves recursively.

```ts
factorial = fn(n: int): int {
    next (n <= 1) ? { 1 } : { n * factorial(n - 1) }
}

factorial(5)    # Output: 120
```

The `factorial` function calculates the factorial of a number using recursion.

## Error Handling

### `catch` Block

The `catch` block in a stream pipeline intercepts errors and defines custom error-handling behavior. It can emit new values to replace the error and continue processing the stream.

The `"done"` keyword can be used to signal completion of the stream. This prematurely terminates the stream processing due to the encountered error.

The code within the `catch` block can choose to re-throw the original error. This allows subsequent parts of the stream or the caller to handle the error in their own way.

The `$` variable will be available inside the catch block and it will contain the caught error.
Errors are data and are part of the function return type. Errors implement the Error type. The _error_ function can be used to create errors at runtime.

```ts
    open('file') >> catch { next open('file2') } >> {
    	# $ can be File or 'Error!'
    }
```

## Code Blocks

-   Blocks are enclosed within curly braces `{}`.
-   Each block accepts a single parameter, referenced using the `$` symbol.
-   Blocks can be chained together using the `>>` operator.

```
1 >> { $ + $ } >> @.out
```

This block adds its input to itself.
Output: `2`

### Emitting Values with `next`

The `next` keyword is used within a block to emit a value to the next function or code block in the chain.
A block can emit multiple values by calling `next` multiple times.

```ts
emitValues = {
    next(1, 2, 3)
    done()
}

emitValues() >> @.out
```

This block emits the values `1`, `2`, and `3` before calling `done` to signal completion.

### Completion

Blocks complete execution once all expressions have been evaluated and their corresponding values emitted to the next block in the chain. This means:

-   The function does not wait for any response or processing from the next block in the chain before continuing.
-   The function cannot access the results or modify the behavior of the next block in the chain based on its emitted values.
-   Once all expressions are evaluated, the function is considered finished and moves on to the next statement in your code.
-   The done keyword can be used to explicitly signal early termination if needed.

### Sequences

Sequences allow you to emit multiple values from within a single code block.
The comma operator can be used to create sequences by separating expressions,
each of which is evaluated and emitted as a separate value.
This is equivalent to using the `next` keyword for each expression.

#### Comma Operator

The comma operator `,` separates expressions within a code block.
Each expression separated by a comma is evaluated, and its result is emitted as a separate value.

```ts
2 >> { $ / 2, $ * 2 } >> @.out
```

This code emits `1` (2 divided by 2) and `4` (2 multiplied by 2).

### Equivalent `next` Usage

The above example is equivalent to using the `next` keyword for each expression:

```ts
operation = fn {
	next($ / 2, $ * 2)
}
2 >> operation >> @.out
```

-   This also emits `1` and `4`.

### Chaining

Functions can be chained to perform multiple operations in sequence.

Example:

```ts
fn increment(:number) { $ + 1 }
fn double(:number) { $ * 2 }
3 >> increment >> double >> @.out
```

-   This chain increments the input by 1 and then doubles the result.
-   Output: `8`

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

## Statements

### loop

Repeats the block indefinitely. The loop block itself does not emit values unless you explicitly call `next`. To exit the loop, use the `done` keyword.

    i: var = 0
    loop { next i++ } >> @.out

Example: A while loop

```ts
fn while(condition: { (): boolean }) {
	loop { condition() ? next : done }
}

while { n > 0 } >> { @.out(n); n-- }
# Prints:
# 3
# 2
# 1
```
