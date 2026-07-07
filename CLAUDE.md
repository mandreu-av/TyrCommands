# Coding Guidelines and Project Conventions for `tyr-commands`

## Project Overview
`tyr-commands` is a TypeScript-based project designed to manage various command scripts. It utilizes the `@orxataguy/tyr` library and follows a modular architecture.

## Stack
- **Language**: TypeScript (ES Modules)
- **Dependencies**: 
  - `@orxataguy/tyr`
- **Development Dependencies**: 
  - `@types/node`

## Architecture
- **Directory Structure**:
  - `.tyr/`: Contains bash-related configurations and scripts.
  - `commands/`: Contains all command scripts, each with a `.tyr.ts` extension.
  - `logs/`: Stores log files for command executions.
  - Root files include configuration files, environment variables, and project metadata.

## Naming Conventions
- **File Naming**: 
  - Command files should be named in lowercase with hyphens separating words (e.g., `cache-remover.tyr.ts`).
- **Variable and Function Naming**:
  - Use camelCase for variable and function names (e.g., `fetchData`, `processCommand`).
- **Constants**:
  - Use UPPER_SNAKE_CASE for constants (e.g., `MAX_RETRIES`).

## Coding Standards
- **TypeScript**: 
  - Ensure all variables and function parameters have explicit types.
  - Use interfaces for complex data structures.
- **Linting**: 
  - Follow the ESLint rules defined in the project (if applicable).
- **Formatting**: 
  - Use Prettier for code formatting to maintain consistency.

## Testing
- **Test Files**: 
  - Place test files alongside the command files they test, following the naming convention `*.test.ts` (e.g., `cache-remover.test.ts`).
- **Testing Framework**: 
  - Use Jest or a similar testing framework (ensure compatibility with TypeScript).
- **Test Coverage**: 
  - Aim for at least 80% test coverage for all command scripts.

## Error Handling
- **Error Handling Strategy**:
  - Use try-catch blocks for asynchronous operations.
  - Log errors to the appropriate log file in the `logs/` directory.
- **Custom Error Classes**:
  - Create custom error classes for specific error types to improve error management and debugging.

## Logging
- **Log Format**: 
  - Use a consistent format for log entries, including timestamps and log levels (INFO, ERROR, etc.).
- **Log Rotation**: 
  - Implement log rotation to manage log file sizes and prevent excessive disk usage.

## Environment Variables
- **Configuration**: 
  - Store sensitive information in the `.env` file and provide a `.env.example` for reference.
- **Accessing Variables**: 
  - Use a configuration management library to access environment variables safely.

## Code Reviews
- **Pull Requests**: 
  - All changes must be submitted via pull requests.
- **Code Ownership**: 
  - Refer to the `CODEOWNERS` file for specific areas of responsibility.

## Documentation
- **README**: 
  - Keep the README updated with relevant project information, installation instructions, and usage examples.
- **Inline Comments**: 
  - Use inline comments to explain complex logic or decisions in the code.

By adhering to these guidelines, we ensure a consistent and maintainable codebase for the `tyr-commands` project.
