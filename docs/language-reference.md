# GB Programming Language

## Design Principles

The language will abide by the following rules:

-   There should be one, and preferably only one, obvious way to do it. ( Borrowed from [Python](https://peps.python.org/pep-0020/) )
-   Errors should be clear, never pass silently, and should contain enough information to quickly determine where the issue is.
-   Convention over Configuration
-   No hidden magic, or excessive syntactic sugar.
-   No unnecessary features.

## Rules

-   Variable shadowing is not allowed.
-   Unused variables are not allowed.
-   Variables must be defined with a value.
-   Variables are constant by default

## Hello World

This is a sample of a simple "Hello World" program. The _main_ block is our entry point. No code is allowed outside of it other than type and function definitions. The standard library is always available through the _std_ namespace. The pipe `>>` operator will call the `std.out` function passing its left value as an argument.

```
main { 'Hello World' >> std.out }
```

## Lexical Elements

### Comments

Comments start with the `#` character and end at the end of line. Multiline comments are not supported.

### Identifiers

Identifiers must start with an alphabetic character or underscore and might be followed by any number of alphanumeric characters or underscores.

### Keywords

The following keyboards are reserved.

as - Type Casting
done - Mark the function as complete
next - Emit the next value from a function
return - Emit value and complete.
type - Define a type alias or structure
use - Bring symbols into scope (import)
main - Source File entry point
export - Export module symbol
var -

### Operators

| Symbol | Description                      |
| ------ | -------------------------------- |
| !      | Boolean NOT                      |
| ~      | Bitwise NOT                      |
| &      | Bitwise AND                      |
| &&     | Short-circuiting logical AND     |
| \*     | Arithmetic multiplication        |
| +      | Addition                         |
| -      | Arithmetic Negation              |
| -      | Arithmetic Substraction          |
| .      | Member Access                    |
| /      | Arithmetic Division              |
| <      | Less than comparison             |
| <=     | Less than or Equal               |
| =      | Assignment                       |
| ==     | Equality Comparison              |
| >      | Greater than Ccmparison          |
| >=     | Greater than or equal comparison |
| >>     | Pipe Operator                    |
| \|     | Bitwise OR                       |
| \|\|   | Short-circuiting logical OR      |
| ?      | conditional statement            |
| :      | conditional statement            |

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

| \n | Newline |
| \r | Carriage Report |
| \t | Tab |
| \' | Single Quote |
| \0 | Null Character |
| \u{NNNNNN} | Hexadecimal Unicode code point |

### Boolean literals

    true | false

### Data Blocks

Data blocks are typed structures stored in -contiguous- memory. Data blocks are enclosed in brackets '[]' and are zero-indexed.

```
a = [ 'string', 2 ]
b = [ label = 'string', 2 ]
```

By default data is immutable. The 'var' keyword can be used to specify variable fields.

```
c = [
    var field: bool | string = true,
    2
];

# Valid
c[0] = 'string';
c.field = false;

# Results in compiler error
c.field = 10;
c[1] = 3

# Is [ 10 ] equivalent to 10 ?
[10] == 10
a = [10];
a + 2 == 12;
```

All data structures are iterable:

    [ a=1, b=2 ] >> each >> std.out

### Variable Definition

A variable is a storage location for holding a value. Variables are defined with the '=' operator. By default their value is constant, unless defined with the `var` keyword. If the variable type is omitted, it is inferred by the compiler. All variables must be defined with a value.

```
# Define a constant with name 'constant', type 'string', and value 'value'
constant = 'value'

# 'variable' will be a variable with value '10.0' and type 'float'
var variable = 10.0;
```

## Types

Types must start with a capital letter.

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
    var str: string = '';

    # Variable name can only contain the values 'foo' or 'bar'.
    var name: 'foo' | 'bar' = 'bar';

### Data Types

    a: [ byte, string ] = [ 10, 'foo' ]
    b: [ age: number, name: string ] = [ 20, 'foo' ]
    # b.name contains 'foo'

    c: [ [int,int,int],[int,int,float],[int,int,int] ]

    type Expr = [ p1: number, p2: string ]
    a: Expr = [ 10, 'ten' ]

### Function Types

    type Fn = |number|: void;
    type Fn2 = |name: type|: void;
    type A = |number|: void;

### Type Parameters

    type Fn<T> = (T): Void;

### Other Types

    Boolean, True, False, Void, Error

## Modules

-   Code is only allowed inside the `main` statement.

## Code Blocks

-   Blocks can only have one parameter. If more than one parameter is specified, the parameter is converted into a data structure.
-   The `$` constant points to the current block parameter.

```ts
    # Code Block with Parameters
    add = fn(a:int, b:int):int { a + b }

	add(1, 2)
    add(b=1, a=2) # Named arguments

    # Anonymous parameters
    add = fn(:int, :int) { $.0 + $.1 }

	# Generics
	add = fn<T extends int>(:T,:T) { ($.0 + $.1) }
```

### Emitting Values

Code blocks can emit multiple values. The block automatically completes once it reaches the end of the function.

```ts
    { next 1 next 2 } >> std.out # Prints 1 and 2
	{ 1, 2 } >> std.out # Same as above
    { next(1) done next(2) } >> std.out # Unreachable code compiler error.
```

## Built In Functions

### loop

Emits void indefinetely.

    var i=0; loop >> { i++ } >> std.out;

### while

```ts
while = { (condition: { :boolean })
	loop >> { condition() ? next : done }
}
var x = 0;

while { x < 2 } >> { x++ } >> std.out # Prints 1
```

### each

```ts
    each = fn<T>(iterable: T[]): T  {
        len = length(iterable);
        var i = 0;
        while { i < len } >> next iterable[i++]
    }

	a = each(1, 2) # a contains 2

    [ 1, 2, 3, 4 ] >> each >> { $==2 ? done }
```

## Errors

Errors are data and are part of the function return type. Errors must implement the Error type. The _Error_ function can be used to create errors at runtime.

```ts
    open = (filename: string) {
    	try { f = std.file(filename); } # f type is File | Error
    }

    open('file') >> catch { = open('file2') } >> {
    	# $ can be File or 'Error!'
    }
```
