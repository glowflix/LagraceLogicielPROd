# Intelligent Backoff for Google Sheets Sync

## Problem
The sync worker was continuously retrying failed sync operations to Google Sheets without any delay or backoff strategy. When offline or experiencing network errors, it would:

1. **Spam error logs** with 200+ identical failures per second
2. **Overload the backend** making it unresponsive to API requests
3. **Cause the Electron launcher to disconnect** when backend became unresponsive
4. **Permanently lose operations** if sync gave up unexpectedly

Example of the spam:
```
[backend]    📡 pushBatch: 200 ops vers https://script.google.com/...
[backend]    ❌ BATCH ERROR: getaddrinfo ENOTFOUND script.google.com (2ms)
[backend]    📡 pushBatch: 200 ops vers https://script.google.com/...
[backend]    ❌ BATCH ERROR: getaddrinfo ENOTFOUND script.google.com (1ms)
[backend]    📡 pushBatch: 200 ops vers https://script.google.com/...
[backend]    ❌ BATCH ERROR: getaddrinfo ENOTFOUND script.google.com (2ms)
... (repeated 200+ times within seconds)
```

## Solution: Intelligent Exponential Backoff

### Implementation Details

**File Modified:** `src/services/sync/sync.worker.js`

#### 1. Backoff State Tracking (Line 36-42)
```javascript
let _backoffState = {
  consecutiveFailures: 0,      // Count consecutive failures
  lastFailureTime: 0,          // Track when last failure occurred
  nextRetryTime: 0,            // When to attempt next retry
  baseDelayMs: 1000,          // 1 second base delay
  maxDelayMs: 60000,          // 60 second max delay
  maxConsecutiveFailures: 10  // Stop after 10 errors
};
```

#### 2. Exponential Backoff Calculation
Uses the formula: `delay = min(2^(failures-1) * 1000ms, 60000ms)`

**Retry Schedule:**
- Failure 1: 1 second
- Failure 2: 2 seconds
- Failure 3: 4 seconds
- Failure 4: 8 seconds
- Failure 5: 16 seconds
- Failure 6: 32 seconds
- Failure 7+: 60 seconds (maximum)
- Failure 10: **PAUSE** - wait 60s before giving up

#### 3. Helper Functions
- `getBackoffDelayMs(consecutiveFailures)` - Calculates the exponential delay
- `recordSyncFailure()` - Increment failure counter and update retry time
- `recordSyncSuccess()` - Reset failure counter when sync succeeds
- `shouldSkipRetryDueToBackoff()` - Check if we should wait before retrying

#### 4. Integration Points

**In `startPushSyncLoop()` (Line 224-330):**
- Check `shouldSkipRetryDueToBackoff()` before attempting push
- Call `recordSyncSuccess()` after successful push
- Call `recordSyncFailure()` on error and calculate next delay

**In `pushPendingOperations()` (Line 397-419):**
- Track success/failure at the operation push level
- Reset backoff on any successful push

### Behavior Changes

**Before:**
```
Time 0.0s: Push attempt 1 → FAIL (ENOTFOUND)
Time 0.0s: Push attempt 2 → FAIL (ENOTFOUND)
Time 0.0s: Push attempt 3 → FAIL (ENOTFOUND)
... (100+ attempts per second)
```

**After:**
```
Time 0.0s: Push attempt 1 → FAIL (ENOTFOUND) [Backoff: wait 1s]
Time 1.0s: Push attempt 2 → FAIL (ENOTFOUND) [Backoff: wait 2s]
Time 3.0s: Push attempt 3 → FAIL (ENOTFOUND) [Backoff: wait 4s]
Time 7.0s: Push attempt 4 → FAIL (ENOTFOUND) [Backoff: wait 8s]
Time 15.0s: Push attempt 5 → FAIL (ENOTFOUND) [Backoff: wait 16s]
Time 31.0s: Push attempt 6 → FAIL (ENOTFOUND) [Backoff: wait 32s]
Time 63.0s: Push attempt 7 → FAIL (ENOTFOUND) [Backoff: wait 60s]
Time 123.0s: Push attempt 8 → FAIL (ENOTFOUND) [Backoff: wait 60s]
...
Time 543.0s: Push attempt 10 → FAIL [SYNC PAUSED - waiting for connectivity]
```

### Logging Output

The system now logs clearly when backoff is active:

```
⏸️  [BACKOFF] Failure #1 - retrying in 1.0s
⏸️  [BACKOFF] Failure #2 - retrying in 2.0s
⏸️  [BACKOFF] Failure #3 - retrying in 4.0s
⏸️  [BACKOFF] Failure #10/10 failures - sync paused for 60.0s
✅ [BACKOFF] Connection restored - reset backoff (was 5 failures)
```

### Benefits

1. **Prevents Backend Overload** - No more 200 log lines per second
2. **Preserves Operations** - Operations queue persists and will retry when connection returns
3. **Intelligent Retry** - Exponential backoff prevents hammering the API
4. **Clear Status** - Logs show exactly when sync is waiting and why
5. **Automatic Recovery** - When connection returns, backoff resets and sync resumes normally
6. **Configurable** - All delays and limits can be adjusted via code

### Testing

To test the intelligent backoff:

1. **Simulate Offline:** Disconnect internet or block `script.google.com` in firewall
2. **Observe Logs:** Watch for `[BACKOFF]` messages with increasing delays
3. **Make Sale/Invoice:** Create a sale - operation will queue
4. **Reconnect:** Restore internet connection
5. **Verify Sync:** Operations will automatically sync after connection returns

The sync system will NOT spam errors, and the backend will remain responsive even when completely offline.

### Configuration

All parameters can be customized by modifying `_backoffState`:
- `baseDelayMs`: Initial retry delay (default: 1000ms)
- `maxDelayMs`: Maximum retry delay (default: 60000ms)
- `maxConsecutiveFailures`: Limit before pausing sync (default: 10)

---

**Status:** ✅ IMPLEMENTED - Ready for testing

**Next Steps:**
1. Test sync behavior when offline
2. Test sync recovery when connection returns
3. Suppress Vosk STT model warnings (optional)
