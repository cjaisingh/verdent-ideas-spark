## Goal
Remove the duplicate star indicator next to pinned items in the non-Favorites groups, and make the star button behavior unambiguous: in regular groups it's an "Add to favorites" affordance that disappears once the item is already favorited; in the Favorites group it's an always-visible "Remove from favorites" toggle.

## Current behavior (the problem)
A row that's already pinned shows **two** stars side by side in its non-Favorites home (e.g. Dashboard under Operate): a small filled "Pinned" indicator star inline with the label, and the action star at the far right. The action star is also a toggle in both places, which is redundant.

## New behavior

**Favorites group** (top section)
- Always shows a single filled star on the right of every row.
- Clicking it removes the item from favorites (unpin).
- No inline indicator star, no hover requirement — it's a permanent remove handle.
- Tooltip: "Remove from Favorites".

**Other groups** (Operate, Plan, System, plus Copilot subgroup)
- No inline "pinned" indicator star next to the label, ever.
- If the item is **not** favorited: a hollow star appears on hover/focus on the right; clicking adds it to favorites. Tooltip: "Add to Favorites".
- If the item **is** favorited: no star button at all on the row in this group. The only place to remove it is the Favorites group above.

## Files to change
- `src/components/AppSidebar.tsx` — only file affected. Three render paths to update:
  1. `renderRow` (lines ~106–150): drop the inline pinned-indicator block; gate the right-side `SidebarMenuAction` so it renders only when `inFavorites` (always visible, "remove" semantics) or when not pinned (hover-reveal, "add" semantics).
  2. Copilot parent row (lines ~173–175): remove the inline pinned-indicator star.
  3. Copilot child rows (lines ~211–238): remove the inline pinned star and apply the same "show only if not pinned" rule to the hover star button.

## Out of scope
- No changes to `useFavorites` or persistence — only the render layer.
- No changes to active-row styling, status dots, or the Copilot collapse behavior.
- No new icons, no tooltip copy beyond what's listed above.

## Validation
- A pinned item (e.g. Dashboard) shows exactly one star — in the Favorites group only.
- Hovering the same item in its original group (Operate) shows no star button.
- Hovering an unpinned item in any group reveals a hollow star; clicking it pins the item, the row's hover star vanishes, and the item appears in Favorites with a permanent filled star.
- Clicking the star in Favorites removes the item; the original row's hover star reappears.
- Collapsed sidebar still shows no stars (already the case).
