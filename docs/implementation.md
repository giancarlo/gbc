# Feature Implementation

## Emitters

```ts
loop { x++ }

loop(() => { x++ })

{ next(1) next(2) } >> { $++ }
1, 2 >> { $++ } >> std.out
1, 2 >> { next($) next($+1) } >> std.out

# Translates to
((cb) => { cb(1); cb(2); })(((cb,$) => { cb($++) })(console.log))

a = { next(1) next(2) }
# a type is { number, number }

b = fn(n: number) { next(n) next(n+1) }
# b type is { (:number): number, number }

b >>



# never emitter
emit = { }
# Should it error out?
emit() >> std.out

```

### When to Mark Block as Emitter

-   `next` is present
-   An emitter is returned
