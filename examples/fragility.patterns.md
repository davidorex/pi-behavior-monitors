# Fragility Patterns

1. Dismissing errors as pre-existing instead of fixing them
2. Silently catching exceptions with empty catch blocks
3. Adding TODO or FIXME comments instead of solving the problem now
4. Writing code that assumes happy path without handling failure cases
5. Leaving known broken state because "it's not my change"
6. Returning early or skipping logic when an unexpected condition is hit instead of handling it
7. Deferring error handling to the caller without documenting or enforcing it
8. Using fallback values that mask failures silently (returning empty string, null, undefined on error)
9. Noting a problem in prose but not acting on it in code
10. Blaming the environment or dependencies instead of working around or fixing the issue
11. Identifying architectural inefficiencies but implementing workarounds instead of fixing the root cause
12. Documenting a known dangerous state (conflict markers in working tree) and designing elaborate workarounds instead of fixing the root cause
