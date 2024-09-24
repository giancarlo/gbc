# Rules

## Constitution

The compiler enforces the following rules to ensure efficient and clear coding standards:

1. **Limited Choice:** The language design should restrict multiple ways to accomplish the same task. This simplification aids in code consistency and reduces confusion for developers when choosing the best approach.

2. **Enforce Best Practices:** The syntax and type system should naturally incorporate industry-best practices. This integration helps developers write optimal code without needing extra tools or external guidelines.

3. **Explicit Errors:** The compiler provides error messages that are not only clear but also include suggestions for corrections. This helps developers quickly understand and resolve issues in their code.

4. **Convention over Configuration:** Most behaviors and patterns should be defined by default conventions, requiring minimal additional setup. This approach reduces configuration overhead and lets developers focus on writing their code.

5. **No Hidden Magic:** The language should operate transparently, minimizing unexpected behavior. Developers should understand exactly what their code does without relying on hidden or implicit features.

6. **No Unnecessary Features:** The focus is on essential features required for mainstream development, avoiding feature bloat. This ensures that the language remains intuitive and accessible.

7. **Standard Library:** All libraries included in the standard distribution must adhere to a predefined quality standard, ensuring reliability and consistency in library use.

8. **Prioritize Readability:** Code readability is paramount. Developers should be able to quickly grasp what the code does due to its clarity and conciseness.

9. **Unit Tests:** Unit tests must be placed close to the code they verify. They should be integrated seamlessly, ensuring they enhance rather than obstruct the main codebase.

10. **Documentation:** The syntax should be self-explanatory, thus removing the need for excessive comments or external documentation like JSDoc. This encourages code that is inherently understandable.

## Variable Rules

1. **No Variable Shadowing:** Prevent variables within a block from masking wider scope variables with the same name.
2. **No Unused Variables:** Flag variables declared but never used.
3. **Mandatory Initialization:** All variables must be assigned a value during declaration.
4. **Constant by Default:** Variables are immutable by default, but can be explicitly declared as mutable if needed.
