# @cxl/gbc.markdown 
	
[![npm version](https://badge.fury.io/js/%40cxl%2Fgbc.markdown.svg)](https://badge.fury.io/js/%40cxl%2Fgbc.markdown)

Markdown Parser

## Project Details

-   Branch Version: [0.0.1-beta.1](https://npmjs.com/package/@cxl/gbc.markdown/v/0.0.1-beta.1)
-   License: GPL-3.0
-   Documentation: [Link](https://github.com/giancarlo/@cxl/gbc.markdown)
-   Report Issues: [Github](https://github.com/giancarlo/gbc/issues)

## Installation

	npm install @cxl/gbc.markdown

## Embedded highlighting

```ts
import { createMarkdownHighlighter } from '@cxl/gbc.markdown/highlight';
import type { Highlighter } from '@cxl/gbc.sdk';

const languages: Record<string, Highlighter | undefined> = {};
const markdown: Highlighter = createMarkdownHighlighter(language =>
	language === 'md' ? markdown : languages[language]
);
```

Populate `languages` with the highlighters your application supports. The synchronous resolver receives the first whitespace-separated word of each fence's info string, unchanged; aliases and case normalization belong to the caller. Return stable highlighter instances to allow checkpoint convergence.

Recognized bodies stream through child checkpoints at complete-line boundaries, batched per input window. Markdown does not accumulate or rescan the whole body. Child highlighters can still buffer incomplete syntax. Closing fences and EOF finalize the child, including incomplete fences and recursive Markdown.

Delimiter spans remain `code`; body tokens retain their kinds, diagnostics and folds. All token and diagnostic positions refer to the original Markdown source, including body indentation. The fence contributes an enclosing fold; unmatched child folds are contained at the fence boundary. Resume, equivalence and rebase use the standard SDK highlighter interface; equivalence remains conservative when a child does not support it.

The default `highlight`, omitted resolvers, absent tags and unsupported languages retain plain `code` highlighting.
