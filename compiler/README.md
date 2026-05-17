# @cxl/gbc.compiler 
	
[![npm version](https://badge.fury.io/js/%40cxl%2Fgbc.compiler.svg)](https://badge.fury.io/js/%40cxl%2Fgbc.compiler)

A concise and type-safe functional language designed to prioritize immutability and modularity. It uses blocks as its core execution units to form computation pipelines.

## Project Details

-   Branch Version: [0.0.1](https://npmjs.com/package/@cxl/gbc.compiler/v/0.0.1)
-   License: GPL-3.0
-   Documentation: [Link](https:/github.com/giancarlo/gbc/compiler)
-   Report Issues: [Github](https://github.com/giancarlo/gbc/issues)

## Installation

	npm install @cxl/gbc.compiler

## Hello World

This is a sample of a simple "Hello World" program. The _main_ block is our entry point. No code is allowed outside of it other than type and function definitions. The standard library is always available through the _@_ operator. The pipe `>>` operator will call the `@.out` function passing its left value as an argument.

```
main { 'Hello World' >> @.out }
```

## Links

-   [Language Spec (test.ts)](https://github.com/giancarlo/gbc/blob/main/compiler/test.ts) — the normative spec
-   [Design Decisions](https://github.com/giancarlo/gbc/blob/main/docs/decisions.md) — rationale behind language design choices
-   [Potential Features](https://github.com/giancarlo/gbc/blob/main/docs/potential-features.md) — deferred and unsettled designs
