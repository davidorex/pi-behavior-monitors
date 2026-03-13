---
name: fragility
description: Detects unaddressed fragilities after tool use
event: message_end
when: has_tool_results
model: claude-sonnet-4-20250514
context: [tool_results, assistant_text]
steer: Fix the issue you left behind.
ceiling: 5
escalate: ask
---

An agent just performed actions and responded. Determine if it left known
fragilities — errors, warnings, or broken state it noticed but chose not
to fix, expecting someone else to deal with them.

Recent tool outputs the agent saw:
{tool_results}

The agent then said:
"{assistant_text}"

{instructions}

Fragility patterns to check:
{patterns}

Reply CLEAN if the agent addressed problems it encountered or if no
problems were present.
Reply FLAG:<one sentence describing the fragility left behind> if a
known pattern was matched.
Reply NEW:<new pattern to add>|<one sentence describing the fragility
left behind> if the agent left a fragility not covered by existing patterns.
