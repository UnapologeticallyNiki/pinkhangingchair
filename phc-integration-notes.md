# Wiring Planter Workshop into PHC (Idea Garden)

PHC is React, so this wiring looks a bit different from Critter Vault —
smaller edits, but in different places. Nothing here touches your CSS,
your card grid, your filters, your JSON/CSV import, or your view modal.

## Why this works at all

`workshop.js` builds its modal by appending a `<div>` directly to
`document.body` — a sibling of your `<div id="root">`, not a child of
it. React only manages what's inside `#root`, so Workshop can pop its
own modal open right next to your React app without React ever
knowing or caring. Same engine, no React-specific rewrite needed.

## 1. Save the three new files next to `index.html`

`workshop.js`, `phc-storage-adapter.js`, `phc-workshop.config.js` — same
folder as `index.html`, no subfolder (same rule as Critter Vault).

## 2. Add the script tags

Right before `</body>`, after your existing single `<script>...</script>`
block closes:

```html
<script src="workshop.js"></script>
<script src="phc-storage-adapter.js"></script>
<script src="phc-workshop.config.js"></script>
</body>
</html>
```

These load after your main script, so `sb`, `rowToIdea`, etc. already
exist by the time they run. (Top-level `const`/`let` in one classic
`<script>` tag are visible to later `<script>` tags on the same page —
this isn't module scoping, so it works without `type="module"`.)

## 3. Add the React ↔ Workshop bridge

Workshop is plain JS; your app state (`ideas`, `setIdeas`, `customLists`)
lives inside React hooks, which aren't visible outside the component.
Three small `useEffect` hooks expose just enough for the config file
to read/write that state. Add these inside `PinkHangingChair()`,
anywhere after the existing `useState` declarations:

```js
useEffect(() => { window.__phcIdeas = ideas; }, [ideas]);
useEffect(() => { window.__phcCustomLists = customLists; }, [customLists]);
useEffect(() => {
  window.__phcSetIdeas = setIdeas;
  window.__phcFlash = flashStatus;
}, []);
```

`setIdeas` is stable across renders (React guarantees this for
`useState` setters), so capturing it once is safe. `flashStatus` only
closes over `setSaveStatus` (also stable), so it's safe too.

## 4. Point "Plant Idea" at the Workshop

Find:
```js
React.createElement("button", { className: "phc-btn phc-btn-primary", onClick: () => setEditingIdea(blankIdea()) },
```
Change the `onClick` to:
```js
onClick: () => PhcWorkshop.open(null)
```

## 5. Point the edit trigger(s) at the Workshop

Search for `setEditingIdea(` — every remaining call (the card's pencil
icon, and the "Edit" button inside the view modal, wherever `onEdit`
is wired up) needs to change from passing the app-shaped idea straight
through, to passing it in **row shape** (matching DB column names),
since that's what Workshop and your table both use:

```js
// before (whatever the variable is named at that call site — idea, viewingIdea, etc.)
setEditingIdea(idea)

// after
PhcWorkshop.open({ id: idea.id, ...ideaToRow(idea) })
```

`ideaToRow` already exists in your file — it's the same function your
save logic already uses to convert app-shape → row-shape before
talking to Supabase.

## 6. Leave the old `EditModal` alone (for now)

Once nothing calls `setEditingIdea(...)` anymore, the `editingIdea &&
React.createElement(EditModal, {...})` branch simply never renders —
it's inert, not broken. Safe to delete later once you've confirmed
Planter Workshop fully replaces it; no need to touch it today and risk
a slip inside a big `React.createElement` tree.

## What's different from Critter Vault, and why

- **`idStrategy: 'db'`** — your `ideas` table generates its own id
  (`gen_random_uuid()` as the column default). Workshop inserts
  without an id and reads the generated one back, instead of making
  up a slug client-side like Critter Vault does.
- **`storageAdapter`** — images/audio go through `phc-storage-adapter.js`
  (Supabase Storage, private bucket, signed URLs) instead of base64.
  Workshop's `files` field type never touches Supabase directly — it
  only calls `upload` / `getUrl` / `remove` on whatever adapter you
  hand it. If PHC's media strategy ever changes, this is the only
  file that changes.
- **`combo` fields** (Type, Level, Comfort, Need) — freeform text with
  suggestions and a "Save" button, replacing your `ComboField`
  component. `onAddOption` writes the new value to `phc_lists`, same
  table your app already uses.
- **No section grouping** — your current form groups fields under
  collapsible headers (Basics, Who's story, Reflections, Connections,
  Media, Sources). Workshop v2 renders one flat list in field order.
  If you want the grouping back, that's a genuine "let's extend the
  engine" conversation — a `section` key on each field def, rendered
  the same way `chips`/`tagselect` etc. are today — not something to
  fake at the config level.

## Testing checklist

1. "Plant Idea" → fill in a title → Save → confirm it appears in the grid.
2. Refresh the page → confirm it's still there (proves it landed in Supabase, not just React state).
3. Edit that same idea from its card → confirm fields are pre-filled correctly, including any images/audio you added.
4. Upload an image, save, reopen the same idea → confirm the image preview loads (this is the signed-URL round trip working).
5. Add a brand-new Type value via the combo field's Save button → reopen the Workshop on a different idea → confirm the new value shows up in the Type suggestions.
