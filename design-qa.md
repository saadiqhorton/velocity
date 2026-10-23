# Project milestone overview QA

final result: passed

Scope: the project's milestone overview rows, summary rail links, progress diamonds, and issue drill-down. The surrounding project shell retains Velocity's existing design system.

## Visual evidence

- Source visual truth: `/home/dezignerdrugz/.t3/userdata/attachments/922b072f-dac8-4cb4-90e2-3179ebae4eda-87d53490-aa4e-4c29-b1cf-b33340d9f0f7.png` (1837 × 1018, including browser chrome). The later close-up is `/home/dezignerdrugz/.t3/userdata/attachments/922b072f-dac8-4cb4-90e2-3179ebae4eda-d55045b4-9c1a-4a4f-b8c3-e9b04d90cd3a.png`.
- Production desktop implementation: `apps/web/test-results_8/project-milestones-overvie-dd967-nd-issue-drill-down-persist-chromium/milestone-overview.png` (1837 × 900 CSS pixels, device scale 1).
- Production mobile implementation: `apps/web/test-results_8/project-milestones-overvie-dd967-nd-issue-drill-down-persist-chromium/milestone-mobile.png` (390 × 844 CSS pixels, device scale 1).
- Native preview, existing project: `/home/dezignerdrugz/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mva5jspc-cf833d77.png`. Its 1837 × 900 viewport is transported at 1280 × 627; the preliminary comparison downsampled the source by the same 1280/1837 factor. No typography conclusions rely on unequal image density.
- Native preview, mobile: `/home/dezignerdrugz/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mva5lffh-2fd8a901.png`.
- Focused comparison, viewed as one combined image: `/tmp/velocity-milestones-production-comparison.png`. Source crop (438,330)–(1268,680) and implementation crop (440,430)–(1240,820), both at one image pixel per CSS pixel. Browser chrome is excluded. Source and implementation have different project data, numbers of milestones, and scroll positions; absolute page offsets and content-specific line breaks are not fidelity failures.

The full desktop and mobile captures establish page composition, the document/rail relationship, and absence of viewport overflow. The focused comparison establishes row rhythm, typography, description alignment, state diamonds, trailing dates, and completion links. Reference assets were not copied into the repository or product.

## Comparison history

1. Initial overview: compact link-only rows lacked the requested document rhythm and direct editing controls (P1). Replaced with 36px milestone headings, descriptions, 32px row gaps, status dropdowns, target dates, completion summaries, and hover/focus actions.
2. First implementation: the drag button's positioning classes conflicted with its base component, occupying layout space; narrow screens wrapped the overflow action alone (P2). Moved positioning to its wrapper and used a mobile grid to keep name, completion link, and actions together, with the date below. Rechecked in the native preview and production E2E at 390px; no horizontal overflow.
3. Focused visual comparison: descriptions aligned with the milestone name instead of the source's smaller inset (P2). Reduced their inset by 12px using existing spacing utilities. Rebuilt, recaptured, and compared the combined source/implementation image again; the corrected description alignment and row rhythm pass.
4. Progress extension: replaced status-only diamond filling with completed-issue area. A production fixture with two milestones verifies a half-filled 50% diamond and a solid 100% diamond. Existing project data verifies empty 0% diamonds and full completion in both the overview and rail.

## Required fidelity surfaces

- Fonts/typography: existing self-hosted ADS font stack, 13px semibold milestone names, 13px descriptions with 24px line height, and 12px tabular completion metadata. Velocity's token scale is retained; long names truncate without pushing persistent actions outside the viewport.
- Spacing/layout rhythm: borderless document rows, 36px headings, descriptions below, 32px between rows, small description inset, and hover/focus fill confined to the heading. Mobile controls remain usable without horizontal scrolling.
- Colors/tokens: semantic ADS surfaces and text; neutral hover and completion-pill fills; empty diamonds use subdued text, partial diamonds warning, completed diamonds primary. No new raw colors, gradients, blur, or excessive radius.
- Image/asset quality: no raster assets are needed. The existing milestone vector glyph was extended rather than importing a source asset. Each partial diamond has a unique clipping ID; percentage is proportional to filled area.
- Copy/content: product-owned messages and demo data are retained. Existing empty descriptions remain editable placeholders. Completion details use available totals, completed issues, and remaining issues; no unsupported started-issue count is invented.

No actionable P0/P1/P2 visual findings remain. Intentional differences are Velocity's font/token system, different project content, and preserving the separate planning timeline on the Milestones tab.

## Behavior and accessibility verification

- Production browser test passes: status, description and target-date edits persist after reload; a 50% milestone shows the expected partial diamond; clicking its count opens the project's Issues tab with server-side milestone scope; the URL survives reload; clearing the chip restores all project issues; new issues inherit the milestone; mobile remains within the viewport. No CSP violations.
- Native preview confirms the existing Alpha count opens its one assigned issue, reload retains the filter, and clearing returns to the whole project. No console errors or failed network requests were reported during inspection.
- Status announces its current value. Description and date controls reference their visible values for assistive technology. Reordering has keyboard-accessible menu alternatives, and deletion requires confirmation.
- 770 web tests pass, including new component, filtering, creation-context, cache-scope, and diamond-area regressions. Web typecheck, production build, lint, color-token check, and legal check pass. Review reports no remaining actionable findings.

## Implementation checklist

- [x] Document-style milestone rows with real editing and ordering controls.
- [x] Shared progress diamonds in overview, rail, and active filter chip.
- [x] Shareable milestone issue links and removable scope.
- [x] Prevent stale milestone defaults and incorrect optimistic cache insertion.
- [x] Browser verification at desktop and mobile sizes; focused visual comparison after fixes.
- [x] Regression checks and independent code review.

Existing visual baseline snapshots were not regenerated.
