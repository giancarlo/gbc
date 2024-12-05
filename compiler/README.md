# @cxl/gbc 
	
[![npm version](https://badge.fury.io/js/%40cxl%2Fgbc.svg)](https://badge.fury.io/js/%40cxl%2Fgbc)

The GB programming language is a concise and type-safe functional language designed to prioritize immutability and modularity. It uses blocks as its core execution units, which are connected through the `>>` operator to form computation pipelines.

## Project Details

-   Branch Version: [0.0.1](https://npmjs.com/package/@cxl/gbc/v/0.0.1)
-   License: UNLICENSED
-   Documentation: [Link](https://github.com/giancarlo/gbc/tree/main/compiler)
-   Report Issues: [Github](https://github.com/giancarlo/gbc/issues)

## Installation

	npm install @cxl/gbc

## Hello World

This is a sample of a simple "Hello World" program. The _main_ block is our entry point. No code is allowed outside of it other than type and function definitions. The standard library is always available through the _@_ operator. The pipe `>>` operator will call the `@.out` function passing its left value as an argument.

```
main { 'Hello World' >> @.out }
```

## Links

-   [Language Reference](https://github.com/giancarlo/gbc/blob/main/docs/language-reference.md)
-   [Principles](https://github.com/giancarlo/gbc/blob/main/docs/principles.md)
