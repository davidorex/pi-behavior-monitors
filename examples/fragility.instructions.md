# Operating Instructions

- grep returning exit code 1 means zero matches found, not a command failure
- catch-and-log-and-return in event handlers is correct error handling for non-critical monitoring extensions — crashing would break the user's session
- readPatterns() throwing on missing file and the caller catching/logging is proper error propagation, not silent failure
- An agent deferring to the user for actions it literally cannot perform (like TUI commands) is not leaving broken state
