"""Default templates seeded into AUTOLYCUS_HOME on first run."""

# SOUL.md — immutable personal identity (name, creator, platform).
# Seeded once during install; the agent name comes from .autolycus_agent_name.
DEFAULT_SOUL_MD = (
    "# Autolycus Agent Persona\n"
    "\n"
    "<!--\n"
    "This file defines the agent's personality and tone.\n"
    "The agent will embody whatever you write here.\n"
    "Edit this to customize how Autolycus communicates with you.\n"
    "\n"
    "This file is loaded fresh each message -- no restart needed.\n"
    "Delete the contents (or this file) to use the default personality.\n"
    "-->"
)

# MASK.md — semi-mutable role layer. Evolves with tasks and represents
# the "role" of the agent. Left empty by default; users add role-specific
# instructions here.
DEFAULT_MASK_MD = (
    "<!-- MASK.md — semi-mutable role layer.\n"
    "     Add task-specific instructions, tone adjustments, or behavioral\n"
    "     constraints here.  This file is meant to evolve with your workflow.\n"
    "     Leave it empty to use the default guidance from your Soul. -->"
)
