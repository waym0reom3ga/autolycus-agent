# Cron Scheduling Guide

Autolycus includes a built-in cron scheduler for running autonomous tasks on a schedule. Jobs run in isolated sessions with their own context, then deliver results to connected platforms or back to the current chat.

## CLI Commands

```bash
lycus cron list              # List all scheduled jobs
lycus cron status            # Check if the scheduler is running
```

## Job Management Tool

The `cronjob` tool provides a single compressed interface for all job operations:

### Create a Job

```python
# Recurring job (every 30 minutes)
cronjob(
    action="create",
    name="Daily briefing",
    prompt="Search for new AI research papers and summarize the top 5.",
    schedule="every 24h"
)

# One-shot job at a specific time
cronjob(
    action="create",
    name="Backup check",
    prompt="Verify backup integrity and report status.",
    schedule="2026-07-01T09:00:00"
)

# Cron expression (daily at 9 AM)
cronjob(
    action="create",
    name="Morning report",
    prompt="Generate a daily summary of project activity.",
    schedule="0 9 * * *"
)
```

### Schedule Formats

| Format | Example | Description |
|--------|---------|-------------|
| Interval | `"30m"`, `"every 2h"` | Repeating interval |
| Cron expression | `"0 9 * * *"` | Standard cron syntax |
| ISO timestamp | `"2026-07-01T09:00:00"` | One-shot at specific time |

### Other Actions

```python
# List all jobs
cronjob(action="list")

# Update a job
cronjob(action="update", job_id="abc123", prompt="New prompt text")

# Pause/resume a job
cronjob(action="pause", job_id="abc123")
cronjob(action="resume", job_id="abc123")

# Remove a job
cronjob(action="remove", job_id="abc123")

# Trigger immediately
cronjob(action="run", job_id="abc123")
```

## Job Types

### LLM-Driven Jobs (Default)

The agent runs the prompt each tick, reasoning about the task and producing a response:

```python
cronjob(
    action="create",
    name="Research digest",
    prompt="Search arXiv for new papers on differential geometry and summarize.",
    schedule="every 24h"
)
```

### Script-Only Jobs (no_agent=True)

For simple scripts where the output IS the message -- no LLM involved, just run the script and deliver stdout:

```python
cronjob(
    action="create",
    name="Disk watchdog",
    script="scripts/check_disk.py",
    schedule="every 6h",
    no_agent=True
)
```

Script jobs are ideal for:
- System health monitoring (disk, memory, GPU)
- API polling with fixed output format
- Heartbeat notifications
- CI status checks

## Delivery Options

By default, job results are delivered back to the chat where the job was created. Override with the `deliver` parameter:

```python
# Deliver to Telegram group
cronjob(
    action="create",
    name="Alerts",
    prompt="Check system health and report issues.",
    schedule="every 1h",
    deliver="telegram:-1001234567890:17585"
)

# Deliver to Discord channel
cronjob(
    action="create",
    name="Deploy status",
    prompt="Check deployment pipeline and report.",
    schedule="every 30m",
    deliver="discord:#deployments"
)

# Deliver everywhere connected
cronjob(action="create", ..., deliver="all")
```

## Skills Attachment

Attach skills to jobs so they load before the prompt runs:

```python
cronjob(
    action="create",
    name="Code review",
    prompt="Review recent PRs and provide feedback.",
    schedule="every 4h",
    skills=["github-code-review"]
)
```

## Chaining Jobs

Job B can consume output from Job A using `context_from`:

```python
# Job A collects data
cronjob(action="create", name="Data collector", prompt="...", schedule="0 */6 * * *")

# Job B processes it (uses job_id from the list)
cronjob(
    action="create",
    name="Data analyzer",
    prompt="Analyze the collected data and produce a report.",
    schedule="15 */6 * * *",
    context_from=["data-collector-job-id"]
)
```

## Security Scanning

Cron prompts are scanned for threat patterns at creation time:

- Prompt injection directives ("ignore previous instructions")
- Secret reading commands (`cat ~/.autolycus/.env`)
- SSH backdoor attempts, destructive operations
- Invisible Unicode characters

When skills are attached, a looser pattern set avoids false positives on security documentation that describes attacks in prose.

## Best Practices

1. **Keep prompts self-contained**: Jobs run without the current chat context -- include all necessary details
2. **Use script jobs for monitoring**: `no_agent=True` saves tokens and runs faster for simple checks
3. **Set appropriate schedules**: Avoid overlapping jobs that deliver to the same channel
4. **Test with `action="run"`**: Trigger immediately to verify output before scheduling
