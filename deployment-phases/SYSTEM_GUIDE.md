# Deployment Phase Tracking System Guide

**This is the definitive guide to the TradeZona deployment tracking architecture.**

---

## System Overview

```
DEPLOYMENT_RUNBOOK.md (Master File)
│
├─ Master status tracker
├─ Links to phase folders
├─ Overall phase summary
└─ Quick reference dashboard

deployment-phases/ (Phase Folder Structure)
├── phase-1/
│   ├── README.md (Phase summary)
│   └── task-*.md (Task logs)
├── phase-2/
│   ├── README.md (Phase summary)
│   └── task-*.md (Task logs)
└── phase-3/
    ├── README.md (Phase summary)
    └── task-*.md (Task logs)
```

---

## Files & Their Purpose

### Master File: DEPLOYMENT_RUNBOOK.md

**Purpose**: Single source of truth for deployment status

**Contains**:
- System rules (mandatory reading before action)
- Phase tracker (high-level status summary)
- Quick reference links to phase folders
- Deployment checklist
- Security summary
- Monitoring setup
- Code locations reference

**Update Rule**: After every task completion, update this file with:
- Phase status change
- Link to new task log file
- Next immediate action

**Never contains**: Detailed task-by-task logs (those go in phase folders)

---

### Phase Folders: deployment-phases/phase-{1,2,3}/

**Structure**:
```
deployment-phases/phase-N/
├── README.md              # Phase summary & status
└── task-<name>-<date>.md  # Individual task logs
```

**Phase README.md**:
- Phase overview
- Task status table
- Task logs index
- Blockers (if any)
- Next steps

**Task Log Files**:
- Name format: `task-<short-name>-<timestamp>.md`
- Example: `task-implement-edge-function-2025-01-15.md`
- One file per completed task
- Immutable (never edited, only created)

---

## How to Use This System

### Rule 1: Before Taking Action

**READ** → `/DEPLOYMENT_RUNBOOK.md`

```
1. Check current phase status
2. Verify phase requirements/blockers
3. Confirm you're working on the right phase
4. Identify next immediate action
```

### Rule 2: After Completing a Task

**EXECUTE → LOG → UPDATE** (in this order)

```
1. Complete the task
2. Create task log file in appropriate phase folder:
   deployment-phases/phase-N/task-<name>-<timestamp>.md
   
3. Update phase README.md:
   - Mark task as DONE
   - Add reference to task log file
   
4. Update DEPLOYMENT_RUNBOOK.md:
   - Update phase status
   - Update "Next immediate action"
   - Add reference to task log
```

### Rule 3: Task Log Format

**Every task log MUST contain**:

```markdown
# Task: [Short Title]

**Date**: [YYYY-MM-DD]
**Time**: [HH:MM-HH:MM]
**Owner**: [Who did this]

---

## Task Summary
[What was accomplished]

## Files Modified / Created
[List of files changed]

## Commands Run
[Any CLI commands executed]

## Result
**Status**: [SUCCESS / FAILED / PARTIAL]

## Notes
[Issues, follow-ups, design decisions]
```

See [`deployment-phases/phase-3/task-implement-edge-function-2025-01-15.md`](phase-3/task-implement-edge-function-2025-01-15.md) for a complete example.

---

## Current System State

### Master File Status
- ✅ Created: `/DEPLOYMENT_RUNBOOK.md`
- ✅ Status: ACTIVE (all phases tracked)
- ✅ Last Updated: 2025-01-15 14:10

### Phase Tracking
| Phase | Status | Folder | README | Task Logs |
|-------|--------|--------|--------|-----------|
| Phase 1 | ✅ DONE | phase-1/ | ✅ | (none needed) |
| Phase 2 | 🔄 IN PROGRESS | phase-2/ | ✅ | (pending) |
| Phase 3 | 🚀 READY | phase-3/ | ✅ | ✅ 1 log |

### Task Logs Created
- ✅ `phase-3/task-implement-edge-function-2025-01-15.md` — Edge Function implementation

---

## Workflow Example

### Scenario: Complete Phase 2 API Token Generation

**Step 1: READ**
```
→ Open /DEPLOYMENT_RUNBOOK.md
→ Find "Phase 2 — Cloudflare R2 Infrastructure Setup"
→ Note: "BLOCKED: Awaiting API token generation"
→ Identify next action: "Generate R2 API token"
```

**Step 2: EXECUTE**
```
→ Log into Cloudflare dashboard
→ Navigate to R2 → Manage API Tokens
→ Create new token with R2:Read + R2:Write scopes
→ Copy credentials
→ Add to Supabase Edge Function Secrets
→ Verify bucket is PRIVATE
→ Test upload works
```

**Step 3: LOG**
```
→ Create file: deployment-phases/phase-2/task-generate-r2-credentials-2025-01-15.md
→ Document: credentials created, added to Supabase, tested
→ Mark result: SUCCESS
```

**Step 4: UPDATE PHASE README**
```
→ Open: deployment-phases/phase-2/README.md
→ Update status table:
   - "API token generated" → ✅ DONE
   - "Credentials to Supabase" → ✅ DONE
   - "Test upload" → ✅ DONE
→ Add note: Phase 2 COMPLETE
```

**Step 5: UPDATE MASTER RUNBOOK**
```
→ Open: /DEPLOYMENT_RUNBOOK.md
→ Update Phase 2 status: "IN PROGRESS" → "DONE"
→ Add task log link: [task-generate-r2-credentials-2025-01-15.md](...)
→ Update next action: "Deploy Edge Function"
```

---

## Rules (STRICT)

### ✅ DO

- ✅ Always read DEPLOYMENT_RUNBOOK.md before acting
- ✅ Create new task logs for every completed task
- ✅ Update phase README after completing a task
- ✅ Update DEPLOYMENT_RUNBOOK after updating phase README
- ✅ Use timestamp format YYYY-MM-DD for consistency
- ✅ Keep task logs immutable (create new file, never edit)
- ✅ Link task logs from both phase README and master runbook

### ❌ DON'T

- ❌ Create other .md tracking files outside this system
- ❌ Edit task log files after creation (create new ones instead)
- ❌ Skip updating the master runbook after completing a task
- ❌ Proceed without reading DEPLOYMENT_RUNBOOK first
- ❌ Assume completion without logging it

---

## File Locations Reference

```
TradeZona/
├── DEPLOYMENT_RUNBOOK.md                           ← Master tracker
├── deployment-phases/
│   ├── SYSTEM_GUIDE.md                            ← This file
│   ├── phase-1/
│   │   └── README.md
│   ├── phase-2/
│   │   └── README.md
│   └── phase-3/
│       ├── README.md
│       └── task-implement-edge-function-2025-01-15.md
│
├── supabase/functions/
│   └── generate-r2-upload-url/
│       ├── index.ts
│       ├── deno.json
│       └── README.md
│
├── lib/
│   └── r2-upload-client.ts
│
└── components/
    └── R2UploadForm.example.tsx
```

---

## Quick Reference

### To Start a New Task
1. Read: `/DEPLOYMENT_RUNBOOK.md`
2. Go to appropriate phase folder
3. Complete the work
4. Create task log file
5. Update phase README
6. Update DEPLOYMENT_RUNBOOK

### To Check Status
→ Open `/DEPLOYMENT_RUNBOOK.md` (1 file, 100% accurate)

### To See Task Details
→ Open relevant phase folder → View task-*.md files

### To Find Code
→ See "CODE LOCATIONS" section in `/DEPLOYMENT_RUNBOOK.md`

---

## Maintenance

### Archival
- Keep completed task logs permanently
- Do not delete task log files
- Archive completed phases only after all tasks verified

### Cleanup
- Only delete files that violate system rules (non-phase tracking files)
- Keep all task logs indefinitely (audit trail)
- Update phase README when all tasks in phase complete

---

## Support

**Questions about architecture?** → See this file (SYSTEM_GUIDE.md)

**Need current status?** → Read DEPLOYMENT_RUNBOOK.md

**Looking for task details?** → Check phase-N/task-*.md files

**Want to add a task?** → Follow "Workflow Example" above

---

**SYSTEM STATUS**: ✅ ACTIVE  
**CREATED**: 2025-01-15  
**VERSION**: 1.0
