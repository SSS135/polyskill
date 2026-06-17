---
name: hello-greeter
description: Demonstrates an author-once skill compiled to multiple harnesses.
allowed-tools: Read, Grep
model: inherit
---

# Hello Greeter

A tiny example skill, authored once and emitted to every target. Everything
outside a macro tag is shared verbatim.


On Claude Code, dispatch read-only checks with `subagent_type: "Explore"`.



See `reference.md` for the canned greetings; `greeting.txt` ships verbatim.
