# Potential Features

## Modules

### Modules as Functions

-   Modules are functions that return exports.

```ts
module = {
	a = { }...
	export [ a, b c ]
}

# Translates to
module = () => { ... return {a,b,c} }
```

### Main Block

The main block is only executed for the entry module. Imported module's main blocks are ignored.

### Object Destructuring

The `use` operator after the data block allows member autocomplete.

```
# Add symbols to current scope
module use a, b, c.d

```

## Default Parameters

-   https://quuxplusone.github.io/blog/2020/04/18/default-function-arguments-are-the-devil/

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

### Types are also functions?

```ts
    type Point = [number, number];
    a = Point(10, 10)
    a: Point = [ 10, 10 ];

	type Point = [x:number=0, y:number=0];
    # Type with constructor
    type Point {
    	x = 0;
    	y = 0;
    }

    point = { |x: number, y: number| [x, y] }
	point2 = { | :[number,number] | [$.0, $.1]}
    a = point(10, 10);
	b = point(a);
```

```ts
type Person {
	name = '';
	age = 18;
}

growUp = { |:Person| $.age++ }

main {
	me = Person('Name', 20)
	'I\'m ${me.name} and I\'m ${me.age}' >> std.out:
}
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

### switch

```
    x = expr >> switch {
        is(3) => 2;
        is(4) => 3;
        else => 4;
    }
```

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
import '@cxl/component' [ Component, augment, attribute, bind, get, tagName ]
import './a11y' [ role ]

[ a, slot ] = std.dom

##
# Bindable Link Component.
#
@tagName('cxl-a')
type A {
	extends($, Component)
	bind($, {
		el = a(style=[color='inherit'] children=[slot()])

		return [
			el,
			{ get($, 'href') >> { el.href = $ } },
			{ get($, 'target') >> { el.target = $ } }
		]
	})

	setAttribute('role', 'link');

	@attribute()
	target: '_blank' | '' = ''

	@attribute()
	var href = ''
}

export [ A ]
```
