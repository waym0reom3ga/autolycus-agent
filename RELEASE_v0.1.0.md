```
 ░▒▓██████▓▒░░▒▓█▓▒░░▒▓█▓▒░▒▓████████▓▒░▒▓██████▓▒░░▒▓█▓▒░   ░▒▓█▓▒░░▒▓█▓▒░░▒▓██████▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓███████▓▒░ 
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░  ░▒▓█▓▒░  ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░   ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░        
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░  ░▒▓█▓▒░  ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░   ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░        
░▒▓████████▓▒░▒▓█▓▒░░▒▓█▓▒░  ░▒▓█▓▒░  ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░    ░▒▓██████▓▒░░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░░▒▓██████▓▒░  
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░  ░▒▓█▓▒░  ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░   ░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░      ░▒▓█▓▒░ 
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░  ░▒▓█▓▒░  ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░   ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░      ░▒▓█▓▒░ 
░▒▓█▓▒░░▒▓█▓▒░░▒▓██████▓▒░   ░▒▓█▓▒░   ░▒▓██████▓▒░░▒▓████████▓▒░▒▓█▓▒░    ░▒▓██████▓▒░ ░▒▓██████▓▒░░▒▓███████▓▒░  

                A U T O L Y C U S
              v e r s i o n  0 . 1 . 0
```

---

## Release Notes — Autolycus v0.1.0

**Release Date:** May 8, 2026

> The true Lycus branch — personality system, dynamic greetings, and the foundation for adaptive AI behavior. This marks the transition from proof-of-concept to a living, breathing agent framework.

---

## ✨ Highlights

- **True Lycus Branch** — The first release that establishes Lycus as a distinct identity from upstream Hermes Agent, with its own personality, behavior patterns, and evolution path.

- **Personality System** — Dynamic greeting templates that adapt to time, weather, and location. Lycus now introduces itself with context-aware greetings that feel alive and present.

- **HIAL Protocol Foundation** — The groundwork for Human Interface Adaptive Loop (HIAL), enabling Lycus to self-reflect daily and pursue mastery of subjects voluntarily.

---

## 🎭 Personality System

- **Dynamic Greetings** — Lycus generates personalized greetings on every startup
  - Real-time weather integration via wttr.in
  - Location detection via ipapi.co
  - Time-aware contextual messages

- **Switchable Templates** — Six personality templates available:
  - `default` — Friendly and professional
  - `casual` — Relaxed and informal
  - `formal` — Professional and structured
  - `enthusiastic` — Energetic and upbeat
  - `minimalist` — Brief and to-the-point
  - `poetic` — Literary and descriptive

- **Template Management** — Use `/lycus-greeting` to switch templates or view available options

---

## 🧠 Agent Identity

- **Separate Lycus Identity** — Lycus now maintains its own agent name file (`.lycus_agent_name`)
- **Random Name Assignment** — Each install receives a unique name from 80 possible identities
- **Persistent Identity** — Name persists across sessions and restarts

---

## 🔮 Planned Features (Roadmap)

### Key Memories
- Persistent memory system for Lycus to retain important information across sessions
- Contextual recall of user preferences and project history

### Personality Emulation
- Advanced personality modeling beyond greetings
- Adaptive behavior based on user interaction patterns

### HIAL Protocol (Human Interface Adaptive Loop)
- Daily self-reflection cycles
- Voluntary subject mastery pursuit
- Continuous improvement loops

---

## 🛠 Technical Changes

- Added `get_dynamic_greeting()` function in `agent/onboarding.py`
- Added `get_lycus_agent_name()` function in `agent/prompt_builder.py`
- Added `/lycus-greeting` slash command in `cli.py`
- Created `~/.hermes/lycus_personality.yaml` configuration file
- Updated banner version to 0.1.0

---

## 📝 Notes

This release marks the transition from FreeBSD proof-of-concept to a true personality-driven agent framework. The prior versions (0.0.1-0.0.5) were exploratory; v0.1.0 is the first stable foundation for Lycus's evolution.

**Previous versions were proofs of concept. This is the beginning.**
