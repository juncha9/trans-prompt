---
name: gitflux
description: Git commit, branch, and PR conventions - automatically applied when writing commit messages
allowed-tools: Bash, Read, Grep
---

# Gitflux Skill

Defines Git workflow and commit conventions.

## Commit Message Format

### Structure

```
[type] <subject>

<body> (optional)
```

Language: English

### Type

- `feature`: Add new feature
- `fix`: Fix bug
- `docs`: Change docs
- `refactor`: Format code, refactor
- `test`: Add/modify tests
- `chore`: Modify build, config files

### Subject

- English base
- Briefly describe what changed
- No period
- Under 50 chars

### Examples

```bash
# Good
[feature] Add database-expert agent for PostgreSQL queries
[fix] Fix npm package init path
[docs] Update README install steps
[refactor] Simplify auth token validation logic
[chore] Upgrade to typescript 5.8.3

# Bad
[feature] Added new feature.  # Past tense, period
[FEATURE] ADD AGENT  # Uppercase
```

### Always add for Claude-written code

Always add for Claude-written code:
```
Co-authored-by: Claude 🤓
```

## Branch Strategy

### Main Branches

- `main` or `master`: Production (main recommended)
- `docs`: Docs only
- `next_release`: Pre-release
- `test`: Testing
- `dev/{type}__{description}`: Dev work (branch from main/master)
- `hotfix/{issue_number}__{description}`: Urgent fix (issue# optional)

Examples:
```bash
next_release
docs
dev/feature__user_authentication
dev/refactor__cleanup
hotfix/101__login_error
hotfix/critical_bugfix
```

## Commit Principles

- Explain what and why changed
- Focus on "why" over "what"
- Skip obvious code details
- One logical change = one commit

## Pull Request

### PR Title

Same format as commit message:
```
[feat] Add database expert agent
```

### PR Body

```markdown
## Summary
- Summary of changes (2-3 items)

## Changes
- Specific change details

## Test Plan
- [ ] Local testing complete
- [ ] Related test cases pass

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Prohibited

❌ Commit `.env`, API keys, passwords
❌ Commit `node_modules/`, build outputs
❌ Commit IDE config files
❌ Meaningless commit messages ("fix", "update", "wip")
❌ Force push to main/master

## Warnings

⚠️ Split large changes into multiple commits
⚠️ Always check `git diff` before commit
⚠️ Local testing required before push
⚠️ Keep main branch always deployable

## Basic Workflow

```bash
# Create and switch to dev branch
git checkout -b dev/feat__new_feature

# Check changes and commit
git status
git diff
git add .
git commit -m "[feature] New feature description"

# Push and PR
git push -u origin dev/feat__new_feature
```
