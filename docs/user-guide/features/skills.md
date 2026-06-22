# Skills System Guide

Skills are Autolycus's procedural memory -- reusable approaches for recurring task types. They live as directories containing a `SKILL.md` file with YAML frontmatter and optional supporting files.

## Directory Structure

```
~/.autolycus/skills/
  my-skill/
    SKILL.md              # Main instructions (required)
    references/           # Supporting documentation
      api.md
      examples.md
    templates/            # Output templates
      template.md
    assets/               # Supplementary files (agentskills.io standard)
  category/               # Category folder for organization
    another-skill/
      SKILL.md
```

## SKILL.md Format

Compatible with the [agentskills.io](https://agentskills.io) open standard:

```yaml
---
name: my-skill                    # Required, max 64 chars, lowercase
description: Brief description     # Required, max 1024 chars
version: 1.0.0                     # Optional
license: MIT                       # Optional
platforms: [linux, macos]          # Optional -- restrict to OS platforms
prerequisites:                     # Optional runtime requirements
  env_vars: [API_KEY]              # Environment variables needed
  commands: [curl, jq]             # CLI tools required (advisory only)
metadata:                          # Optional arbitrary key-value
  lycus:
    tags: [deployment, ci]
    related_skills: [docker, github-actions]
---

# Skill Title

Full instructions and content here...
```

## Available Tools

### skills_list

List all available skills with metadata (token-efficient, shows only name + description):

```python
skills_list()                          # All skills
skills_list(category="devops")         # Filter by category
```

### skill_view

Load full skill content or linked files:

```python
skill_view("my-skill")                                  # Main SKILL.md
skill_view("my-skill", "references/api.md")             # Linked reference file
skill_view("my-skill", "templates/config.yaml")         # Template file
```

### skill_manage

Create, update, delete skills:

```python
# Create a new skill
skill_manage(action="create", name="my-skill", content="---\nname: my-skill\n...\n---\n\nContent...")

# Patch an existing skill (find-and-replace)
skill_manage(action="patch", name="my-skill", old_string="old text", new_string="new text")

# Full rewrite (major overhaul only)
skill_manage(action="edit", name="my-skill", content="---\n...\n---\n\nNew full content...")

# Delete a skill
skill_manage(action="delete", name="my-skill", absorbed_into="umbrella-skill")
```

## Progressive Disclosure Architecture

Skills use three tiers of disclosure to minimize token overhead:

1. **Tier 1 (Metadata)**: `skills_list` returns only name and description
2. **Tier 2 (Full Instructions)**: `skill_view` loads the complete SKILL.md
3. **Tier 3 (Linked Files)**: Reference docs, templates, scripts loaded on demand

This means listing all skills costs minimal tokens -- full content is only loaded when actually needed.

## Platform Restrictions

Skills can be restricted to specific operating systems using the `platforms` field:

```yaml
platforms: [macos]    # Only load on macOS
platforms: [linux]    # Only load on Linux
# Omit for all platforms (default)
```

## Best Practices

1. **Name skills descriptively**: Use lowercase with hyphens, max 64 characters
2. **Keep descriptions concise**: Under 1024 chars, focused on when to use the skill
3. **Include trigger conditions**: Tell the agent WHEN to load this skill
4. **Document pitfalls**: Known issues and edge cases prevent repeated mistakes
5. **Version your skills**: Use semantic versioning in the `version` field
6. **Use categories for organization**: Group related skills under category folders

## Bundled Skills

Autolycus ships with bundled skills covering common workflows. These are synced during installation and can be found in the project's skill directories. Additional skills are available through the Skills Hub.
