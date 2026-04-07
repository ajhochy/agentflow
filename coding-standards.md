# Coding Standards

## General

- Use TypeScript with strict mode enabled
- Prefer `const` over `let`; never use `var`
- Use meaningful, descriptive names for variables and functions
- Keep functions small and focused on a single responsibility
- Handle errors explicitly; never silently swallow exceptions

## Style

- Use 2-space indentation
- Use single quotes for strings
- Add trailing commas in multi-line arrays and objects
- Maximum line length: 100 characters

## Functions

- Prefer arrow functions for callbacks and short expressions
- Use named functions for top-level declarations
- Document public APIs with JSDoc when intent is not obvious from the signature

## Testing

- Write tests for all public functions
- Use descriptive test names that explain the expected behavior
- Cover edge cases: empty inputs, boundary values, error conditions
- Keep tests independent and deterministic

## Error Handling

- Throw typed errors with descriptive messages
- Validate inputs at system boundaries (CLI args, API responses)
- Use early returns to reduce nesting

## Security

- Never commit secrets, API keys, or credentials
- Validate and sanitize file paths before I/O operations
- Use parameterized queries for any data store interactions
