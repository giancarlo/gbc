# @cxl/gbc 
	
[![npm version](https://badge.fury.io/js/%40cxl%2Fgbc.svg)](https://badge.fury.io/js/%40cxl%2Fgbc)

GB Language CLI

## Project Details

-   Branch Version: [0.0.1](https://npmjs.com/package/@cxl/gbc/v/0.0.1)
-   License: GPL-3.0
-   Documentation: [Link](https://github.com/giancarlo/@cxl/gbc)
-   Report Issues: [Github](https://github.com/giancarlo/gbc/issues)

## Installation

	npm install @cxl/gbc

## Usage

	gbc run main.gb        # compile and run
	gbc run app.wasm       # run a built .wasm
	gbc build main.gb      # build one .wasm (with `main` runnable, else host exports)
	gbc build --native main.gb --outdir ./bin
	gbc library lib.gb     # bundle a library into lib.gbm
	gbc test file.gb       # run #test blocks
	gbc file.gb            # type-check only

Modules: `@.file.path` imports a local module (relative to the importing
file); `@name` imports a library through the entry's `#importmap { @name =
'<path>'; }`. `(a, b) = @…` destructures exports by name; `m = @…` binds a
namespace. `run` requires `main`; libraries must not declare one. Exit code
is non-zero on compile errors, a runtime trap, or any failed assertion.
