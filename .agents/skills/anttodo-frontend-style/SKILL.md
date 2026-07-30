---
name: anttodo-frontend-style
description: Apply and verify AntTodo's React/CSS visual language. Use for UI implementation, screenshot matching, layout polishing, component styling, typography, spacing, colors, dialogs, sidebars, task lists, and responsive Web or Electron interface work in this repository.
---

# AntTodo Frontend Style

## Workflow

1. Inspect the supplied reference at its native pixel size before editing.
2. Record measurable geometry, typography, colors, borders, radii, and shadows.
3. Preserve AntTodo interaction and domain rules; treat the reference as the visual source of truth.
4. Implement shared component styles in `src/index.css` and behavior in `src/`.
5. Verify in the browser at a viewport that makes comparison with the reference meaningful.
6. Compare a fresh screenshot, correct visible differences, then run `pnpm typecheck`, `pnpm test`, and `pnpm build`.

## General Rules

- Match reference proportions before applying generic design-system defaults.
- When a live reference page is available, measure browser computed styles and element geometry. Do not equate high-DPI screenshot pixels with CSS pixels.
- Use explicit CSS pixel values from the reference page; add responsive caps for narrow screens.
- Match font size, weight, line height, control height, padding, gap, border color, radius, and shadow independently.
- Use system UI fonts and keep typography at `#191919`; use alpha variants of the same neutral for muted content and dividers.
- Use AntTodo blue `#4772fa` for primary actions and focused controls.
- Keep focus indication visible and preserve keyboard/assistive-technology semantics.
- Reuse the same label color value in the side label indicator and associated task label.
- Do not infer new product fields from a visual reference when the request is only about styling.

## Dida Desktop Reference

Use these measured CSS values from `https://dida365.com/webapp/#q/all/tasks` as AntTodo's default desktop visual system:

### Layout

- Global type: system UI stack; base `14px`, weight `400`, primary text `#191919`.
- Main navigation rail: `50px`; surface `#f5f5f5`; right divider `1px rgba(25,25,25,.05)`.
- Sidebar: `213px`; white surface; right divider `1px rgba(25,25,25,.05)`.
- Sidebar content top padding: `8px`.
- Sidebar item: `36px` high; horizontal outer inset `10px`; inner padding `12px`; radius `10px`; `20px` text line-height.
- Selected item: `rgba(25,25,25,.06)`.
- Section caption: `12px`, weight `700`, `rgba(25,25,25,.3)`; container height `30px`.
- Main list title bar: `64px`; padding `15px 20px`.
- Main title: `20px`, weight `600`, line-height `28px`.
- Quick-add surface: list-width minus `40px`; `39px` high; `10px` radius; `rgba(25,25,25,.03)`; horizontal inset `20px`.
- Group header: `28px` high; horizontal padding `12px`; title `14px/600`, line-height `21px`.
- Task row: `40px` high; title `14px/400`, line-height `21px`; left content inset `18px`; checkbox/title separation produces a `40px` title start offset; right padding `20px`.
- Dividers: `rgba(25,25,25,.05)`.
- Hover icon background: `rgba(25,25,25,.05)` with `8px` radius.
- Main accent: `#4772fa`.
- Context menu: `164px` wide; `4px` vertical padding; white surface; `1px rgba(25,25,25,.1)` border; `12px` radius; shadow `0 5px 18px rgba(0,0,0,.2)`.
- Context menu item: `34px` high; `14px/400`.

### Label Edit Dialog

- Dialog: `380 × 285px`; white surface; no visible border; `16px` radius; shadow `0 5px 18px rgba(0,0,0,.2)`.
- Header: `56px` high; `20px` horizontal padding.
- Title: left aligned; `16px`, weight `700`, line-height `20.8px`.
- Body horizontal inset: `20px`; usable width `340px`.
- Name input: `340 × 36px`; radius `8px`; `14px/400`; padding `0 12px 0 36px`; focused border `1px #4772fa`.
- Gap from input to color row: `21px`.
- Field label: `13px/400`; label column `80px`.
- Color row: `20px` high. Swatches are `18 × 18px` with `8px` right gap.
- Palette: red `#ff6161`, orange `#ffac38`, yellow `#ffd324`, lime `#e6ea49`, green `#35d870`, blue `#4ca1ff`, purple `#6e75f4`, then custom gradient.
- Selected swatch: `20px` outer color, `16px` white separation, `12px` inner color.
- Footer: `58px` high; padding `12px 20px 16px`; buttons right aligned.
- Buttons: `100 × 30px`; radius `8px`; `14px/400`; `8px` horizontal gap.
- Secondary button: transparent/white, border `1px rgba(25,25,25,.1)`, text `rgba(25,25,25,.6)`.
- Primary button: `#4772fa`, white text, transparent border.
- When the product request limits editing to name and color, omit the parent-label control but preserve the reference dialog's `285px` outer height and footer baseline unless a compact variant is explicitly requested. This keeps the modal silhouette and vertical rhythm aligned with the target site.

### Due-Date Popover

- Popover width: `260px`; point-date mode height: `539px`; date-range mode height: `315px`.
- Place the popover `8px` from its trigger and keep it at least `12px` from viewport edges.
- Surface: white; no visible border; `14px` radius; shadow `0 5px 18px rgba(0,0,0,.2)`.
- Mode switch: `228 × 30px` at `12px 16px 0`; `8px` radius; background `rgba(25,25,25,.05)`. Each label is `13px/400`; selected segment has a white `26px`-high surface with `6px` radius.
- Quick-date icons: four `26 × 26px` controls distributed across a `216px` row at `x:22px`, `y:66px`; use `rgba(25,25,25,.6)` and `1.5px` icon strokes.
- Calendar: `240px` wide with `10px` side insets. Month header is `20px` high at `y:116px`, `14px/400`; navigation icons are `12px`.
- Weekday row: `28px` high, `12px/400`, `rgba(25,25,25,.4)`. Day cells are `28 × 28px`, `12px/400`, arranged in six `30px` rows.
- Selected day: white text on `#4772fa`; today: `#4772fa` on `rgba(71,114,250,.08)`; outside-month days: `rgba(25,25,25,.4)`.
- Time/reminder/repeat rows: `34px` high, `13px/400`, `4px` outer inset and `12px` inner horizontal padding. Use `18px` leading icons and `12px` trailing chevrons. The selected reminder text uses `#4772fa`.
- Range fields begin at `y:61px` with `16px` horizontal insets. Use columns `30px 87px 95px`, `8px` gaps, and `28px`-high controls. Labels and values use `13px`.
- Render dates in the compact visible form `M月d日`; keep the native date input overlaid for interaction rather than exposing browser-dependent long date formatting.
- Range rows start at `y:61px` and `y:97px`; the all-day row starts at `y:140px`. Reminder and repeat rows start at `y:179px` and `y:217px`.
- Footer begins at `y:493px` in point mode and `y:269px` in range mode. Use `16px` side insets, an `8px` gap, and two `110 × 30px` buttons with `8px` radius and `14px/400`.
- Secondary button: white, `1px rgba(25,25,25,.1)` border, `rgba(25,25,25,.6)` text. Primary button: `#4772fa` with white text.

## Verification

- Confirm the right-click target opens exactly one dialog.
- Confirm the current name and color are selected when the dialog opens.
- Confirm changing either value enables Save.
- Confirm Save closes the dialog and updates both the side label marker and every associated task label.
- For due dates, verify both point-date and date-range modes, including their distinct `539px` and `315px` heights.
- Confirm date selection, time selection, all-day toggling, Clear, and Confirm remain functional after visual changes.
- Inspect browser console errors and capture a screenshot at the comparison viewport.
