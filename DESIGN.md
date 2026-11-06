# Frontend design direction

## Design Read

Reading this as an internal SLA workflow and monitoring application for branch employees, Korwil staff, central divisions, supervisors, and management, in a Vercel-inspired high-contrast product UI, dial ENERGY 2 / RHYTHM 2 / MOTION 1.

## Identity

- Character: precise, calm, accountable, and focused on the next action.
- Product name: “SLA Pengajuan”; keep SLA as the established Service Level Agreement term. Descriptor: “Pelacakan pengajuan Cabang, Korwil, dan Pusat.”
- Mark: a compact dark-green tile with one continuous route through three checkpoint nodes, representing Cabang → Korwil → Pusat. Keep the wordmark in editable text in the application and provide the complete SVG lockup as a standalone asset.
- Palette: warm-neutral canvas and white surfaces, near-black text, dark green as the single brand accent, and semantic green/amber/red for SLA state only.
- Typography: Inter Variable is retained because its compact forms remain legible in dense Indonesian labels, ticket references, and operational tables. Ticket identifiers may use the system monospace stack as data, not as display typography.
- Motif: a fine connected rule appears only where it explains workflow sequence or timeline. Ticket number and current owner remain easy to scan.
- Surfaces: mostly flat; borders distinguish data groups and controls. Use elevation only for dialogs and floating menus.
- Radius: restrained variation. Inputs and buttons use a small radius, cards use a medium radius, and status badges remain compact rather than pill-shaped.
- Motion: short opacity fades for overlays, without scale or slide movement; short hover/focus transitions only. Reserve the document scrollbar gutter so overlay scroll locking does not shift the page. Respect `prefers-reduced-motion`; loading animation is limited to the active loading state.

## Composition

- Desktop navigation stays compact and horizontal. Tablet and mobile use an explicit labeled menu.
- Dashboard hierarchy prioritizes SLA summary, filters, and the ticket list.
- Dense work queues and ticket details use compact shadcn card sizing; metadata stays grouped with the ticket and does not stretch into empty rows.
- Inbox prioritizes claimable work and current ownership.
- Request forms keep routing context next to the fields that affect routing.
- Admin screens use data tables on wide screens and readable records on narrow screens.
- Manajemen and Supervisor details remain read-only.

## Component rules

- Use the installed shadcn-svelte components for buttons, cards, fields, dialogs, alerts, badges, and selects.
- Keep native scrollbars thin, visible, and theme-aware through the shared base stylesheet so page and nested scrolling areas match.
- Keep visual tokens in `frontend/src/routes/layout.css`; avoid one-off colors and decorative effects in route styles.
- Keep visible field labels, explicit empty/loading/error messages, and keyboard-visible focus states.
- Do not add mock numbers, sample people, placeholder charts, or links to unbuilt pages.
