# Phase 2 — Cloudflare R2 Infrastructure Setup

**Status**: `[IN PROGRESS]` 🔄

**SCOPE**: R2 infrastructure ONLY - No Supabase schema changes

## Overview

Infrastructure phase - Setting up Cloudflare R2 bucket, API credentials, and Supabase secret storage.

## Phase Summary

| Task | Type | Status | Responsibility | System Touchpoint | Notes |
|------|------|--------|-----------------|-------------------|-------|
| R2 bucket created | R2 | ✅ DONE | User | None | `tradezona-images` bucket exists |
| API token generated | R2 | ⏳ PENDING | User | None | Need R2 Read + Write scopes |
| Credentials to Supabase | Integration | ⏳ PENDING | DevOps | Supabase Secrets | Add to Edge Functions Secrets only |
| CORS configured | R2 | ⏳ PENDING | DevOps | None | Allow upload domain |
| Bucket set to PRIVATE | R2 | ⏳ PENDING | User | None | Verify in Cloudflare dashboard |
| Test upload | R2 | ⏳ PENDING | QA | None | Verify can write to bucket |

## 🔐 SYSTEM TOUCHPOINTS (CRITICAL)

**PROHIBITED IN THIS PHASE**:
- ❌ NO Supabase database schema changes
- ❌ NO SQL migrations
- ❌ NO table alterations
- ❌ NO auth system changes

**ALLOWED ONLY**:
- ✅ Supabase Edge Function Secrets (environment variables)
- ✅ R2 bucket configuration
- ✅ R2 API credential generation

---

## Known Information

```
R2_ACCOUNT_ID: 393fdc11838d18b9d1793acd906cdffe
R2_BUCKET_NAME: tradezona-images
R2_ENDPOINT: https://393fdc11838d18b9d1793acd906cdffe.r2.cloudflarestorage.com
```

**Supabase Secrets to Configure** (NOT database):
```
SUPABASE_URL: https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY: [service role key]

R2_ACCOUNT_ID: 393fdc11838d18b9d1793acd906cdffe
R2_ACCESS_KEY_ID: [from Cloudflare R2 token]
R2_SECRET_ACCESS_KEY: [from Cloudflare R2 token]
R2_BUCKET_NAME: tradezona-images
R2_ENDPOINT: https://393fdc11838d18b9d1793acd906cdffe.r2.cloudflarestorage.com
```

## Task Logs

- (None yet - awaiting API token generation)

## EXECUTION ORDER (STRICT)

```
Step 1: USER ACTION (Cloudflare dashboard)
   └─ Generate R2 API token (Read + Write scopes)
   └─ Obtain: ACCESS_KEY_ID and SECRET_ACCESS_KEY

Step 2: USER ACTION (Cloudflare dashboard)
   └─ Verify bucket "tradezona-images" is set to PRIVATE
   └─ Configure CORS if needed

Step 3: BACKEND ACTION (Supabase dashboard)
   └─ Add credentials to Edge Function Secrets
   └─ DO NOT modify database schema
   └─ DO NOT run migrations

Step 4: QA ACTION (curl or similar)
   └─ Test direct upload to R2 bucket
   └─ Verify file appears in Cloudflare dashboard
```

## Blockers

🚫 **BLOCKED**: Cannot proceed to Phase 3 until ALL Step 3 is complete
- Awaiting R2 API token (Step 1)
- Awaiting Supabase secrets configuration (Step 3)

## Next Action (Current)

**IMMEDIATE** (User responsibility):
1. Go to Cloudflare dashboard → R2 → API Tokens
2. Create new API token with R2:Read + R2:Write scopes
3. Copy ACCESS_KEY_ID and SECRET_ACCESS_KEY
4. Verify bucket "tradezona-images" is PRIVATE

**THEN** (Backend responsibility):
1. Go to Supabase → Project Settings → Edge Functions Secrets
2. Add environment variables (see SYSTEM TOUCHPOINTS section)
3. Verify secrets are saved

## Next Phase

→ Phase 3: Edge Function & Direct Upload Migration  
**BLOCKED UNTIL**: Phase 2 Step 3 complete (Supabase secrets added)
