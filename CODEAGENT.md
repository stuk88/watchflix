---
applyTo: '**'
---
Core Principles
Reliability first – code must run correctly and predictably.
Simplicity over cleverness – prioritize readable and maintainable solutions.
If it works, don't touch it – never modify working code unless absolutely necessary.
 - Working code is battle-tested; changes introduce risk of regressions.
 - Refactoring for "cleanliness" without a concrete benefit is not a valid reason.
 - Valid reasons to modify working code: security vulnerabilities, critical bugs, performance issues affecting users, or required feature changes.
 - Before touching working code, ask: "What breaks if I don't change this?" If the answer is "nothing," don't change it.
 - Cosmetic changes, style preferences, and "modernization" are not justifications.
 - If you must modify, ensure comprehensive test coverage exists first.
Security at every step – validate all inputs and never expose secrets.
Ethical responsibility – avoid code that compromises privacy or legality.
Transparency – clearly document assumptions, limitations, and risks.
Completeness over shortcuts – default to thorough, complete implementations.
 - Do not take shortcuts, skip edge cases, or implement partial solutions by default.
 - Write complete error handling, validation, and test coverage.
 - Implement full features, not placeholders or "good enough for now" code.
 - Document thoroughly, don't leave "TODO" comments for basic requirements.
 - EXCEPTION: A simpler approach is acceptable ONLY when it genuinely produces a better end result.
 - "Better" means: more maintainable, more performant, more readable, or better aligned with requirements.
 - "Better" does NOT mean: faster to write, easier to skip tests, or avoiding difficult problems.
 - Before choosing a simpler path, ask: "Is this simpler because it's elegant, or because I'm avoiding work?"
 - If the simpler solution compromises quality, reliability, or completeness, it's not better—it's just lazy.
 - When in doubt, choose the thorough approach. The cost of incompleteness compounds over time.
Insanity in debugging – doing the same thing and expecting different results.
 - If a fix didn't work, trying it again won't magically make it work.
 - "Maybe it'll work this time" is not a debugging strategy.
 - Each attempt must change something: inputs, environment, approach, or assumptions.
 - If you've tried the same solution twice with the same result, STOP. Re-analyze the problem.
 - Track what you've tried – don't repeat failed attempts.
 - When stuck, step back and question your assumptions about what's causing the issue.
 - Different results require different actions. Period.
 - NEVER cycle between failed solutions (A→B→A→B). If A and B both failed, you need C.
 - Looping back to a previously failed approach without new information is wasted effort.
 - Maintain a mental or written log: "Tried X, failed because Y" – refer to it before each attempt.
Solve properly – fix the real problem, not the symptom.
 - Before writing any code, understand the problem fully. Read the error, trace the flow, identify the root cause.
 - NEVER apply band-aid fixes that mask the issue – patching symptoms creates hidden failures that resurface later.
 - If a function throws an error, don't wrap it in try-catch and swallow it. Find out WHY it throws and fix that.
 - If a value is unexpectedly null, don't add a null check and move on. Trace why the value is null and fix the source.
 - If a test fails, don't adjust the assertion to match wrong behavior. Fix the code to produce correct behavior.
 - Avoid "shotgun debugging" – making random changes hoping something sticks. Each change must be intentional and reasoned.
 - Ask "Why?" five times (5 Whys technique) to drill down to the actual root cause before implementing a fix.
 - A proper solution addresses the cause, not the effect. If users report a crash, fixing the crash screen is not a fix – preventing the crash is.
 - Validate your fix by confirming: "Does this prevent the problem from happening, or does it just hide the problem when it happens?"
 - If a fix requires disabling functionality, catching and ignoring exceptions, or adding special cases for broken data – it's not a fix, it's a cover-up.
 - When multiple issues appear simultaneously, solve them one at a time. Isolate, fix, verify, then move to the next.
 - Document what caused the issue and why your solution works – future developers (and future you) need to understand the reasoning.

Project Context
These rules apply to all areas of development including frontend, backend, APIs, infrastructure, AI systems, and data services. Code must align with business goals, user safety, and performance constraints. Always consider deployment environments, data sensitivity, and long-term maintenance.

Coding Guidelines

Architecture and Design
Design modular components with clear boundaries.
Follow SOLID and clean architecture principles where appropriate.
Separate business logic, configuration, and presentation.
Ensure the system is scalable, observable, and testable.

Code Quality and Maintainability
Use clear, descriptive names for variables, functions, and classes.
Write modular, testable functions.
Remove unused or commented-out code.
Keep consistent formatting and follow linting rules.
Comment on why code exists instead of what it does.

Documentation
Document setup, dependencies, and usage.
Explain architectural decisions.
Write clear commit messages and changelogs.

Security and Privacy
Never hardcode credentials or tokens.
Always validate and sanitize user input.
Use encrypted connections and secure authentication.
Apply the principle of least privilege to data access.
Avoid collecting unnecessary personal data.

Testing and Review
Write automated tests for new features.
Cover positive and negative cases.
Review code for functionality, security, and clarity.
Treat warnings and failed tests as blockers.

Failing Tests - CRITICAL
NEVER skip, disable, or mark tests as `.skip()` or `.todo()` to bypass failures.
ALWAYS fix the underlying issue causing the test to fail.
If a test is flaky, fix the flakiness – do not ignore it.
If the test expectation is wrong, fix the test to match correct behavior.
If the code is wrong, fix the code to pass the test.
Skipping tests hides bugs and creates technical debt – this is unacceptable.
EXCEPTION: Tests may be skipped ONLY if the user explicitly states it's an unfinished feature.

Debug Procedure (follow strictly)
1. Found error – identify and reproduce the issue clearly.
2. Add logs – insert targeted logging following these rules:
 - Log at entry and exit points of suspected functions.
 - Include function name, input parameters, and return values.
 - Log variable states before and after critical operations.
 - Use structured logging with context (e.g., requestId, userId).
 - Add timestamps to track execution timing.
 - Log caught exceptions with full stack traces.
 - Log the reason for the error – capture the conditions, inputs, or state that caused the failure.
 - For generic errors (e.g., "Something went wrong"):
 - Log the full error object, not just the message.
 - Unwrap nested errors to find the original cause (error.cause, error.originalError).
 - Check for swallowed exceptions that hide the real error.
 - Add granular logs before and after each operation in the suspected code path.
 - Log the complete request/response cycle to identify where it fails.
 - Use distinct log levels: ERROR for failures, WARN for anomalies, DEBUG for tracing.
 - Never log sensitive data (passwords, tokens, PII).
3. Run tests – execute relevant tests to gather diagnostic data.
4. Find error reason – analyze logs and test output to pinpoint root cause.
5. Approve solution – propose a fix and validate it addresses the root cause.
6. Resolve – implement the fix, verify with tests, and remove debug logs.

Performance and Resource Use
Profile before optimizing.
Avoid unnecessary loops or heavy operations.
Use caching where safe and document cache behavior.
Prefer asynchronous or streaming patterns for I/O operations.

Collaboration and Communication
Report issues early and transparently.
Review code respectfully and quickly.
Encourage constructive feedback and continuous learning.
Promote empathy and professionalism in team work.

AI and Automation Guidelines
AI-generated code must follow the same standards as human code.
Explain reasoning, assumptions, and limitations clearly.
Do not fabricate code or dependencies.
Mark experimental outputs for manual review.
Avoid using copyrighted material.

VS Code Tools - PREFERRED
When working in VS Code, prefer built-in tools over terminal commands:
- Use VS Code's file creation/editing tools instead of `touch`, `echo >`, or `cat >`.
- Use VS Code's search and replace features instead of `grep`, `sed`, or `awk` for code modifications.
- Use VS Code's integrated Git tools for staging, committing, and viewing diffs.
- Use VS Code's built-in terminal for commands that must run in a shell.
- Use VS Code's debugging tools instead of print-based debugging when possible.
- Leverage VS Code extensions for linting, formatting, and testing.
- Use VS Code's Problems panel to view and navigate errors and warnings.

Git Commit Rules - CRITICAL
NEVER use `git add -A` or `git add .` - these stage all files indiscriminately.
ALWAYS use `git add <specific-file-path>` to stage only the files that were intentionally changed.
Before committing, only stage files directly related to the current task.
Never commit test artifacts, playwright reports, or generated files unless explicitly requested.

Atomic and Reversible Commits
Each commit must represent ONE logical change that can be reverted independently.
Never mix unrelated changes in a single commit – separate features, bug fixes, and refactors.
Structure commits so reverting one does not break other functionality.
Use descriptive commit messages that explain what the commit does and why.
If a feature requires multiple changes, break it into sequential commits that each leave the codebase in a working state.
Before committing, ask: "Can this commit be reverted without side effects on unrelated code?"

Feature Separation Guidelines
One feature = one branch = one or more atomic commits.
Do not combine multiple features or fixes in a single commit.
If changes span multiple areas (frontend, backend, config), consider separate commits for each layer.
Keep refactoring commits separate from feature commits – refactor first, then add features.
When fixing bugs discovered during feature work, commit the bug fix separately before the feature.

Final Responsibility
Understand context before coding.
Clarify uncertain requirements.
Refactor regularly for clarity and reliability.
Take responsibility for the impact of code on users and teams.
