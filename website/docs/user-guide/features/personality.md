---
sidebar_position: 9
title: "Personality & MASK.md"
description: "Customize Lycus Agent's personality with a global MASK.md, built-in personalities, and custom persona definitions"
---

# Personality & MASK.md

Lycus Agent's personality is fully customizable. `MASK.md` is the **primary identity** — it's the first thing in the system prompt and defines who the agent is.

- `MASK.md` — a durable persona file that lives in `AUTOLYCUS_HOME` and serves as the agent's identity (slot #1 in the system prompt)
- built-in or custom `/personality` presets — session-level system-prompt overlays

If you want to change who Lycus is — or replace it with an entirely different agent persona — edit `MASK.md`.

## How MASK.md works now

Lycus now seeds a default `MASK.md` automatically in:

```text
~/.autolycus/MASK.md
```

More precisely, it uses the current instance's `AUTOLYCUS_HOME`, so if you run Lycus with a custom home directory, it will use:

```text
$AUTOLYCUS_HOME/MASK.md
```

### Important behavior

- **MASK.md is the agent's primary identity.** It occupies slot #1 in the system prompt, replacing the hardcoded default identity.
- Lycus creates a starter `MASK.md` automatically if one does not exist yet
- Existing user `MASK.md` files are never overwritten
- Lycus loads `MASK.md` only from `AUTOLYCUS_HOME`
- Lycus does not look in the current working directory for `MASK.md`
- If `MASK.md` exists but is empty, or cannot be loaded, Lycus falls back to a built-in default identity
- If `MASK.md` has content, that content is injected verbatim after security scanning and truncation
- MASK.md is **not** duplicated in the context files section — it appears only once, as the identity

That makes `MASK.md` a true per-user or per-instance identity, not just an additive layer.

## Why this design

This keeps personality predictable.

If Lycus loaded `MASK.md` from whatever directory you happened to launch it in, your personality could change unexpectedly between projects. By loading only from `AUTOLYCUS_HOME`, the personality belongs to the Lycus instance itself.

That also makes it easier to teach users:
- "Edit `~/.autolycus/MASK.md` to change Lycus' default personality."

## Where to edit it

For most users:

```bash
~/.autolycus/MASK.md
```

If you use a custom home:

```bash
$AUTOLYCUS_HOME/MASK.md
```

## What should go in MASK.md?

Use it for durable voice and personality guidance, such as:
- tone
- communication style
- level of directness
- default interaction style
- what to avoid stylistically
- how Lycus should handle uncertainty, disagreement, or ambiguity

Use it less for:
- one-off project instructions
- file paths
- repo conventions
- temporary workflow details

Those belong in `AGENTS.md`, not `MASK.md`.

## Good MASK.md content

A good SOUL file is:
- stable across contexts
- broad enough to apply in many conversations
- specific enough to materially shape the voice
- focused on communication and identity, not task-specific instructions

### Example

```markdown
# Personality

You are a pragmatic senior engineer with strong taste.
You optimize for truth, clarity, and usefulness over politeness theater.

## Style
- Be direct without being cold
- Prefer substance over filler
- Push back when something is a bad idea
- Admit uncertainty plainly
- Keep explanations compact unless depth is useful

## What to avoid
- Sycophancy
- Hype language
- Repeating the user's framing if it's wrong
- Overexplaining obvious things

## Technical posture
- Prefer simple systems over clever systems
- Care about operational reality, not idealized architecture
- Treat edge cases as part of the design, not cleanup
```

## What Lycus injects into the prompt

`MASK.md` content goes directly into slot #1 of the system prompt — the agent identity position. No wrapper language is added around it.

The content goes through:
- prompt-injection scanning
- truncation if it is too large

If the file is empty, whitespace-only, or cannot be read, Lycus falls back to a built-in default identity ("You are Lycus Agent, an intelligent AI assistant created by Nous Research..."). This fallback also applies when `skip_context_files` is set (e.g., in subagent/delegation contexts).

## Security scanning

`MASK.md` is scanned like other context-bearing files for prompt injection patterns before inclusion.

That means you should still keep it focused on persona/voice rather than trying to sneak in strange meta-instructions.

## MASK.md vs AGENTS.md

This is the most important distinction.

### MASK.md
Use for:
- identity
- tone
- style
- communication defaults
- personality-level behavior

### AGENTS.md
Use for:
- project architecture
- coding conventions
- tool preferences
- repo-specific workflows
- commands, ports, paths, deployment notes

A useful rule:
- if it should follow you everywhere, it belongs in `MASK.md`
- if it belongs to a project, it belongs in `AGENTS.md`

## MASK.md vs `/personality`

`MASK.md` is your durable default personality.

`/personality` is a session-level overlay that changes or supplements the current system prompt.

So:
- `MASK.md` = baseline voice
- `/personality` = temporary mode switch

Examples:
- keep a pragmatic default SOUL, then use `/personality teacher` for a tutoring conversation
- keep a concise SOUL, then use `/personality creative` for brainstorming

## Built-in personalities

Lycus ships with built-in personalities you can switch to with `/personality`.

| Name | Description |
|------|-------------|
| **helpful** | Friendly, general-purpose assistant |
| **concise** | Brief, to-the-point responses |
| **technical** | Detailed, accurate technical expert |
| **creative** | Innovative, outside-the-box thinking |
| **teacher** | Patient educator with clear examples |
| **kawaii** | Cute expressions, sparkles, and enthusiasm ★ |
| **catgirl** | Neko-chan with cat-like expressions, nya~ |
| **pirate** | Captain Lycus, tech-savvy buccaneer |
| **shakespeare** | Bardic prose with dramatic flair |
| **surfer** | Totally chill bro vibes |
| **noir** | Hard-boiled detective narration |
| **uwu** | Maximum cute with uwu-speak |
| **philosopher** | Deep contemplation on every query |
| **hype** | MAXIMUM ENERGY AND ENTHUSIASM!!! |

## Switching personalities with commands

### CLI

```text
/personality
/personality concise
/personality technical
```

### Messaging platforms

```text
/personality teacher
```

These are convenient overlays, but your global `MASK.md` still gives Lycus its persistent default personality unless the overlay meaningfully changes it.

## Custom personalities in config

You can also define named custom personalities in `~/.autolycus/config.yaml` under `agent.personalities`.

```yaml
agent:
  personalities:
    codereviewer: >
      You are a meticulous code reviewer. Identify bugs, security issues,
      performance concerns, and unclear design choices. Be precise and constructive.
```

Then switch to it with:

```text
/personality codereviewer
```

## Recommended workflow

A strong default setup is:

1. Keep a thoughtful global `MASK.md` in `~/.autolycus/MASK.md`
2. Put project instructions in `AGENTS.md`
3. Use `/personality` only when you want a temporary mode shift

That gives you:
- a stable voice
- project-specific behavior where it belongs
- temporary control when needed

## How personality interacts with the full prompt

At a high level, the prompt stack includes:
1. **MASK.md** (agent identity — or built-in fallback if MASK.md is unavailable)
2. tool-aware behavior guidance
3. memory/user context
4. skills guidance
5. context files (`AGENTS.md`, `.cursorrules`)
6. timestamp
7. platform-specific formatting hints
8. optional system-prompt overlays such as `/personality`

`MASK.md` is the foundation — everything else builds on top of it.

## Related docs

- [Context Files](/user-guide/features/context-files)
- [Configuration](/user-guide/configuration)
- [Tips & Best Practices](/guides/tips)
- [MASK.md Guide](/guides/use-soul-with-lycus)

## CLI appearance vs conversational personality

Conversational personality and CLI appearance are separate:

- `MASK.md`, `agent.system_prompt`, and `/personality` affect how Lycus speaks
- `display.skin` and `/skin` affect how Lycus looks in the terminal

For terminal appearance, see [Skins & Themes](./skins.md).
