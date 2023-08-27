# GC Programming Language

A language designed for the web.

## Hello World

```
main { "Hello World" >> std.out }
```

## Lexical Elements

### Comments

Comments starts with `#` and end at the end of line. Multiline comments are not supported.

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
export - Export module symbol
var -

### Operators

| Symbol | Function             | Description                      |
| ------ | -------------------- | -------------------------------- |
| !      | _not_                | Bitwise OR                       |
| &      | _bitAnd_             | Bitwise AND                      |
| &&     | _and_                | Short-circuiting logical AND     |
| \*     | _multiply_           | Arithmetic multiplication        |
| +      | _add_                | Addition                         |
| -      | _neg_                | Arithmetic Negation              |
| -      | _substract_          | Arithmetic Substraction          |
| .      | _get_                | Member Access                    |
| /      | _divide_             | Arithmetic Division              |
| <      | _lessThan_           | Less than comparison             |
| <=     | _lessThanOrEqual_    | Less than or Equal               |
| =      | _set_                | Assignment                       |
| ==     | _equal_              | Equality Comparison              |
| >      | _greaterThan_        | Greater than Ccmparison          |
| >=     | _greaterThanOrEqual_ | Greater than or equal comparison |
| >>     | _next_               |
| \|     | _bitOr_              | Bitwise Or                       |
| \|\|   | _or_                 | Short-circuiting logical OR      |
| ?      | _if_                 | conditional statement            |
| :      | _else_               | conditional statement            |

### Number Literals

    decimal_lit    = "0" | ( "1" ... "9" ) [ [ "_" ] decimal_digits ]
    binary_lit     = "0" ( "b" | "B" ) [ "_" ] binary_digits .
    hex_lit        = "0" ( "x" | "X" ) [ "_" ] hex_digits .

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

# Will result in compiler error
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

A variable is a storage location for holding a value. Variables are defined with the '=' operator. By default their value is constant, unless defined with the `var` keyword. If the variable type is omitted, it is inferred by the compiler.

```
# Define a constant with name 'constant', type 'string', and value 'value'
constant = 'value'

# 'variable' will be a variable with value '10.0' and type 'float'
var variable = 10.0;
```

## Types

### Numeric Types

    uint8       the set of all unsigned  8-bit integers (0 to 255)
    uint16      the set of all unsigned 16-bit integers (0 to 65535)
    uint32      the set of all unsigned 32-bit integers (0 to 4294967295)
    uint64      the set of all unsigned 64-bit integers (0 to 18446744073709551615)

    int8        the set of all signed  8-bit integers (-128 to 127)
    int16       the set of all signed 16-bit integers (-32768 to 32767)
    int32       the set of all signed 32-bit integers (-2147483648 to 2147483647)
    int64       the set of all signed 64-bit integers (-9223372036854775808 to 9223372036854775807)

    float32     the set of all IEEE-754 32-bit floating-point numbers
    float64     the set of all IEEE-754 64-bit floating-point numbers

    byte        alias for uint8

### String Types

    # var str can contain any string
    var str: string = '';

    # Variable name can only contain the values 'foo' or 'bar'.
    var name: 'foo' | 'bar' = 'bar';

### Data Types

    a: [ byte, string ] = [ 10, 'foo' ]
    b: [ age: number, name: string ] = [ 20, 'foo' ]
    c: [ [int,int,int],[int,int,float],[int,int,int] ]

    # b.name contains 'foo'

### Function Types

    type Fn = (number): void;
    type Fn2 = (named: type): void;

### Type Parameters

    type Fn<T> = (T): Void;

### Other Types

    Boolean, True, False, Void, Error

## Code Blocks

    # Code Block with Parameters
    add = (a: int, b: int) { next(a + b) }

    # Anonymous parameters
    add = (:int, :int) { => $0 + $1 }

    [1, 2] >> add # returns 3

    # Named arguments
    add(b=1, a=2)
    [ b=1, a=2 ] >> add

### Emitting Values

Code blocks can emit multiple values. The block automatically completes once it reaches the end of the function.

    { next 1 next 2 } >> std.out # Will print 1 and 2
    { next(1) done next(2) } >> std.out # Unreachable code compiler error.

## Built In Functions

### loop

Emits void indefinetely.

    var i=0; loop >> { i++ } >> std.out;

### time

The `time` emitter, emits the current time indefinetely.

```
std.time >> std.out; # print the current time infinite times.
x = await std.time[0]; # Current time

fn std.now() => await std.time[0];
```

## Operators

### is

    10 >> is(2, 3, 4) # false
    'foo' >> is(/f../) # true

### switch

The switch operator can be used for pattern matching, the difference between _switch_ and _is_ is that the former requires all values to be matched.

```
    x = expr >> switch {
        is(3) => 2;
        is(4) => 3;
        else => 4;
    }
```

### while

```
    while = (condition: fn => boolean) {
        loop >> { fn() ? next : done }
    }
    var x = 0;
    while { x < 2 } >> { x++ } >> { x==1 ? done }
```

### each

```
    each = <T>(iterable: T[]): T {
        len = length(iterable);
        var i = 0;
        while { i < len } >> next
    }

    [ 1, 2, 3, 4 ] >> each >> { $==2 ? done }
```

### for

    for(10, 5) >> std.out # Prints 10 9 8 7 6 5
    for(0, 5) >> std.out # Prints 0 1 2 3 4 5

## Errors

Errors are data and are part of the function return type. Errors must implement the Error type. The _Error_ function can be used to create errors at runtime.

    open = (filename: string) {
    	try { f = std.file(filename); } # f type is File | Error
    }

    open('file') >> catch { = open('file2') } >> {
    	# $ can be File or 'Error!'
    }
