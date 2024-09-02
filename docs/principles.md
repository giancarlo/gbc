# Rules

The language will abide by the following principles:

1. **Limited Choice:** Minimize ways to achieve the same functionality.
2. **Enforce Best Practices:** Integrate critical practices into syntax/type system.
3. **Explicit Errors:** Throw errors with clear messages and suggestions.
4. **Convention over Configuration:** Define most behaviors with minimal configuration.
5. **No Hidden Magic:** Maintain transparency, avoid unexpected behavior.
6. **No Unnecessary Features:** Focus on essential development features.
7. **Prioritize Readability:** Code should be clear, concise, and easy to understand.

## Variable Rules

1. **No Variable Shadowing:** Prevent variables within a block from masking wider scope variables with the same name.
2. **No Unused Variables:** Flag variables declared but never used.
3. **Mandatory Initialization:** All variables must be assigned a value during declaration.
4. **Constant by Default:** Variables are immutable by default, but can be explicitly declared as mutable if needed.
