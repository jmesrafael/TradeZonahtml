# Visual Guide to New Features

## 1. 🔄 Pair Input with Auto-Suggestions

### When you CLICK the Pair field:
```
┌─────────────────────────┐
│ Pair Input   [focused]  │
├─────────────────────────┤
│ • EURUSD                │  ← All 10 pairs show
│ • GBPUSD                │
│ • USDJPY                │
│ • AUDUSD                │
│ • XAUUSD                │
└─────────────────────────┘
```

### When you TYPE:
```
┌─────────────────────────┐
│ Pair Input: EUR         │
├─────────────────────────┤
│ • EURUSD                │  ← Filtered matches
│ • EURJPY                │     (up to 12)
│ • EURCHF                │
│ • EURGBP                │
└─────────────────────────┘
```

---

## 2. ⭐ Auto Negative Ratio

### When you enter negative PNL:
```
Step 1: Click PNL field and enter value
┌─────────────┐
│ PNL: -100   │
└─────────────┘

Step 2: Click away (blur)
┌─────────────┐
│ PNL: -$100  │  → Automatically sets Ratio: -1R
│ Ratio: -1R  │     (no need to manually enter!)
└─────────────┘
```

---

## 3. 💾 Auto-Save with Loading Indicator

### While editing a row:
```
┌──────────────────────────────────────────┐
│ EURUSD │ Long │ -$100  │ -1R  │ ★★★     │
│                         ↓ Saving...      │
│                     (row fades slightly)  │
└──────────────────────────────────────────┘
```

After ~800ms:
```
✅ Row returns to normal opacity (saved to database)
✓ Cache cleared automatically
```

---

## 4. 🔘 Button Loading States

### Add Trade Button:
```
BEFORE: [+ Add Trade]

DURING:  [⟳ Loading...] (disabled, spinning icon)

AFTER:   [+ Add Trade] (restored, new row appears)
```

### Delete Button:
```
BEFORE: [🗑️ Delete]

DURING:  [⟳ Loading...] (disabled, spinning icon)

AFTER:   ✓ Toast: "Trade deleted."
```

### Notes Save Button:
```
BEFORE: [💾 Save Notes]

DURING:  [⟳ Loading...] (uploading images + saving)

AFTER:   ✓ Toast: "Notes saved."
```

---

## 5. 📊 Multi-Delete Progress

### Selection:
```
[Select] button activates
You check: ☑️ 3 trades selected

Shows: "3 selected" with [🗑️ Delete (3)] button
```

### Confirmation Dialog:
```
┌─────────────────────────────────────────┐
│ 🗑️ Delete 3 Trades                      │
│                                          │
│ Permanently removes the selected trades │
│ their notes and images. Cannot be undone.│
│                                          │
│ [Cancel]  [🟡 Deleting... ⟳]          │
└─────────────────────────────────────────┘
```

### Progress:
```
Deleting trades...
████████░░░░░░░░░░░ 2 / 3

Completes:
✓ Toast: "3 trades deleted."
```

---

## 6. 💾 Data Persistence - The Game Changer

### OLD BEHAVIOR:
```
1. User enters: EURUSD in Pair field
2. User types: -100 in PNL field
3. User clicks: "Add Trade" button
4. Result: ❌ Data LOST (inputs cleared, row replaced)
```

### NEW BEHAVIOR:
```
1. User enters: EURUSD in Pair field
   → Saved to browser cache immediately ✓
   
2. User types: -100 in PNL field
   → Saved to browser cache ✓
   
3. User clicks: "Add Trade" button
   → Shows loading spinner [⟳ Loading...]
   → New row created
   → Previous data preserved in new row! ✓
```

---

## 7. 📱 Toast Notifications

### Success Toasts (green):
```
┌────────────────────────────┐
│ ✓ Trade deleted.           │
└────────────────────────────┘

┌────────────────────────────┐
│ ✓ Notes saved.             │
└────────────────────────────┘
```

### Error Toasts (red):
```
┌──────────────────────────────┐
│ ❌ Save error: Network failed │
└──────────────────────────────┘
```

### Automatically disappears after 3.5 seconds

---

## 8. 🔄 Flow Example: Complete Trade Entry

### Step 1: Click "Add Trade"
```
Button shows: [⟳ Loading...] (spinner spinning)
New row appears in table
```

### Step 2: User enters data
```
Pair input field: Click → Shows all available pairs
Type "EUR" → Filters to EURUSD, EURJPY, etc.
Select EURUSD → Field auto-fills

Position: Select "Long"
Strategy: Click → "Breakout" selected
Timeframe: Click → "1H" selected

PNL: Enter "-100"
→ As you blur away, Ratio automatically becomes "-1R"

Confidence: Click ★ → ★★★ (3 stars)

All data saved to localStorage continuously ✓
```

### Step 3: User clicks "Notes"
```
Inputs are saved to database first
✓ Toast: "Saving..." (if needed)
Then Notes modal opens
```

### Step 4: Refresh browser
```
All inputs still there! ✓
(Restored from localStorage cache)
```

### Step 5: Page fully loads
```
Data syncs from database
Cache cleared automatically
Row saved state confirmed ✓
```

---

## Key Visual Indicators

| Indicator | Meaning |
|-----------|---------|
| 🟢 Green Toast | Action completed successfully |
| 🔴 Red Toast | Error occurred, check message |
| [⟳ Spinning] | Button disabled, operation in progress |
| Faded Row | Row is being saved to database |
| ✓ in Field | Data is cached locally (optional visual) |
| 📊 Progress Bar | Multi-delete progress (2 / 10) |

---

## Testing Workflow

### Quick Test (30 seconds):
1. Add new trade → See [⟳ Loading...]
2. Type pair → See suggestions appear
3. Enter negative PNL → See ratio auto-fill to -1
4. Click away → Row briefly fades (saving)
5. Refresh page → See your data still there!

### Comprehensive Test (2 minutes):
1. Edit multiple rows with different data
2. Click Notes button → Data saves first
3. Click Add Trade → Previous row data persists
4. Select multiple trades
5. Delete them → See progress bar: 1/3, 2/3, 3/3
6. See green success toast ✓

---

## Browser Developer Tools Tip

### To see cached data:
```
DevTools → Application → Local Storage
Look for entries like: tz_draft_[journalId]_[tradeId]
```

Each entry contains:
```json
{
  "pair": "EURUSD",
  "position": "Long",
  "pnl": "-100",
  "r": "-1",
  "confidence": 3,
  "date": "2026-04-20",
  "time": "14:30",
  "strategy": ["Breakout"],
  "timeframe": ["1H"],
  "mood": ["Focused"]
}
```

Cache is automatically cleared after successful save ✓
