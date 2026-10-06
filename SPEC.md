# Velocity — Technical & Product Specification

**An open-source, self-hostable, no-limits issue tracker and project manager with the interaction quality of Linear, the visual language of the Atlassian Design System, and first-class AI-agent connectivity — purpose-built for single users and small teams.**

| Field | Value |
|---|---|
| Project name | Velocity (working title — see §1.6 Naming) |
| Version | Spec v1.1 (2026-10-03) |
| Status | Approved for implementation |
| License | AGPL-3.0-or-later |
| Repository | Monorepo, single SPEC.md as source of truth |

**Changelog**
- v1.1 — Refocus: single-user/small-team product ("solo-first"). Removed: triage, 4-role RBAC, guest accounts, email/SMTP, OAuth client registry, team admin flags, insights dashboards (trimmed), Redis/MinIO/separate worker from stack. Simplified: auth, workspace model (single workspace), deployment (3 containers). Added: explicit Linear-layout-parity shell spec (§4.10).
- v1.0 — Initial full-team specification.

---

## Table of Contents

- [1. Overview](#1-overview)
  - [1.1 Mission](#11-mission)
  - [1.2 Problem](#12-problem)
  - [1.3 Product Principles](#13-product-principles)
  - [1.4 Competitive Landscape](#14-competitive-landscape)
  - [1.5 Legal Posture](#15-legal-posture)
  - [1.6 Naming](#16-naming)
- [2. Scope](#2-scope)
  - [2.1 v1.1 Scope](#21-v11-scope)
  - [2.2 Explicit Non-Goals for v1.1](#22-explicit-non-goals-for-v11)
  - [2.3 Post-MVP Roadmap](#23-post-mvp-roadmap)
- [3. Product Requirements — Core Domain](#3-product-requirements--core-domain)
  - [3.1 Concept Map](#31-concept-map)
  - [3.2 Accounts & Authentication](#32-accounts--authentication)
  - [3.3 Workspace](#33-workspace)
  - [3.4 Teams](#34-teams)
  - [3.5 Issues](#35-issues)
  - [3.6 Workflows (Custom Statuses)](#36-workflows-custom-statuses)
  - [3.7 Labels](#37-labels)
  - [3.8 Cycles](#38-cycles)
  - [3.9 Projects](#39-projects)
  - [3.10 Views](#310-views)
  - [3.11 Notifications](#311-notifications)
  - [3.12 Settings & Administration](#312-settings--administration)
- [4. Design System & User Experience](#4-design-system--user-experience)
  - [4.1 Design Philosophy: Behavior Parity, Visual Independence](#41-design-philosophy-behavior-parity-visual-independence)
  - [4.2 Atlassian Design System Token Architecture](#42-atlassian-design-system-token-architecture)
  - [4.3 Dark Theme (Default)](#43-dark-theme-default)
  - [4.4 Light Theme](#44-light-theme)
  - [4.5 Theme Switching](#45-theme-switching)
  - [4.6 Typography](#46-typography)
  - [4.7 Iconography](#47-iconography)
  - [4.8 Spacing, Radius, Elevation](#48-spacing-radius-elevation)
  - [4.9 Component Specifications](#49-component-specifications)
  - [4.10 Application Shell & Layout — Linear-Parity Geometry (Binding)](#410-application-shell--layout--linear-parity-geometry-binding)
  - [4.11 Screen Specifications](#411-screen-specifications)
  - [4.12 Interaction & Keyboard Specification](#412-interaction--keyboard-specification)
  - [4.13 Command Palette](#413-command-palette)
  - [4.14 Copy & Content Rules](#414-copy--content-rules)
  - [4.15 Accessibility](#415-accessibility)
  - [4.16 Performance Budgets (UI)](#416-performance-budgets-ui)
  - [4.17 Anti-Patterns (Explicitly Banned)](#417-anti-patterns-explicitly-banned)
- [5. Architecture](#5-architecture)
  - [5.1 System Overview](#51-system-overview)
  - [5.2 Technology Stack](#52-technology-stack)
  - [5.3 Monorepo Layout](#53-monorepo-layout)
  - [5.4 Frontend Architecture](#54-frontend-architecture)
  - [5.5 Realtime & Synchronization Model](#55-realtime--synchronization-model)
  - [5.6 Background Jobs](#56-background-jobs)
  - [5.7 Search](#57-search)
  - [5.8 File Storage](#58-file-storage)
  - [5.9 Deployment (Docker Compose)](#59-deployment-docker-compose)
  - [5.10 Configuration](#510-configuration)
  - [5.11 Data Model](#511-data-model)
  - [5.12 Event & Audit Log](#512-event--audit-log)
- [6. API & Integrations](#6-api--integrations)
  - [6.1 GraphQL API](#61-graphql-api)
  - [6.2 Authentication (API Keys)](#62-authentication-api-keys)
  - [6.3 Rate Limiting](#63-rate-limiting)
  - [6.4 Webhooks](#64-webhooks)
  - [6.5 GitHub Integration](#65-github-integration)
  - [6.6 MCP Server](#66-mcp-server)
  - [6.7 Importers](#67-importers)
  - [6.8 Issue Reference Syntax](#68-issue-reference-syntax)
- [7. Non-Functional Requirements](#7-non-functional-requirements)
  - [7.1 Security](#71-security)
  - [7.2 Privacy & Data Ownership](#72-privacy--data-ownership)
  - [7.3 Testing Strategy](#73-testing-strategy)
  - [7.4 Observability](#74-observability)
  - [7.5 Internationalization](#75-internationalization)
  - [7.6 Compatibility & Support Matrix](#76-compatibility--support-matrix)
- [8. Delivery Plan](#8-delivery-plan)
  - [8.1 Milestones](#81-milestones)
  - [8.2 Definition of Done — v1.0](#82-definition-of-done--v10)
  - [8.3 Post-MVP Roadmap Detail](#83-post-mvp-roadmap-detail)
  - [8.4 Risks & Mitigations](#84-risks--mitigations)

---

# 1. Overview

## 1.1 Mission

Build the issue tracker / project manager that an individual developer or small team actually wants to use — **fully open source (AGPL-3.0), free, with zero limits on teams, issues, or features** — matching the layout and interaction quality of Linear, self-hostable with one `docker compose up`, and connectable to AI agents (MCP) and GitHub from day one.

**What "no limits" means concretely:** every feature ships to everyone. There is no paid tier, no feature matrix, no seat counting. (Linear's free tier caps at 250 issues / 2 teams; Velocity has no caps because it is yours.)

## 1.2 Problem

Linear defined the modern issue-tracker interaction model: keyboard-first navigation, an instant client, cycles, and a GraphQL API that makes the product scriptable and agent-accessible. But it is proprietary and built for product organizations — invites, roles, triage duty, SSO — machinery an individual or a two-person team pays complexity for without needing it.

The open-source alternatives skew the other way: **Plane** and **Huly** are multi-product platforms aimed at Jira's market; lighter trackers lack Linear-class interaction quality. Nobody offers a **solo-first** Linear-class experience: the layout, the keyboard flow, cycles and projects — minus the org machinery.

**Velocity's positioning:** the personal issue tracker that feels like Linear, works like Linear, looks like a serious tool (Atlassian Design System), syncs with GitHub, and talks to your AI coding agent. If your team grows, it grows with you (multi-user remains supported, simply without enterprise ceremony) — but the product is designed for the solo/small use case first.

## 1.3 Product Principles

1. **Solo-first.** One user must be able to install, use, and love it. Every collaboration feature must be optional, not structural. Admin surface area is a cost we refuse.
2. **Keyboard-first.** Every action reachable via keyboard; the mouse is optional. Command palette (`Cmd/Ctrl+K`) is the universal entry point.
3. **Instant.** Interactions commit to pixels in < 100ms. Optimistic UI everywhere; no spinner-first workflows.
4. **Linear layout parity.** The application shell — sidebar navigation, list views, right detail panel, no top bar, dense issue rows — imitates Linear's layout geometry. Visual styling comes from the Atlassian Design System (§4.1).
5. **Opinionated but bendable.** Strong defaults (cycles, priorities, workflows); everything configurable where it matters.
6. **One API for everything.** The GraphQL API that powers the web app is the same API exposed publicly, to the MCP server, and to importers. If the UI can do it, an agent or script can do it.
7. **Simple to run.** `docker compose up` with 3 containers. No Redis, no object store, no message broker required for the default deployment.
8. **Zero limits by design.** No artificial caps. Performance bounds come from hardware, not licensing.

## 1.4 Competitive Landscape

| Capability | Velocity v1.1 (target) | Linear | Plane | GitHub Issues |
|---|---|---|---|---|
| License | AGPL-3.0 | Proprietary | AGPL-3.0 | Proprietary |
| Self-host | 3 containers, 1 command | No | ~10 containers | No |
| Solo-first (no org setup) | Yes | No (team product) | No (workspace product) | Yes |
| Linear-parity layout & keyboard UX | Yes | Yes | No | No |
| Per-team issue prefixes (ENG-123) | Yes | Yes | Yes | No |
| Custom workflows/statuses | Yes | Yes | Yes | No |
| Cycles | Yes | Yes | Yes | No |
| Projects w/ milestones | Yes | Yes | Yes | Partial (milestones) |
| GraphQL public API | Yes | Yes | No (REST) | REST |
| Webhooks | Yes (HMAC) | Yes | Yes | Yes |
| MCP server | Yes | Yes | Yes | No |
| GitHub PR sync | Yes | Yes | Yes | Native |
| Import (Linear/Jira/GitHub) | Yes | N/A | Yes | N/A |
| Dark default + light theme | Both | Both | Both | Limited |

**Differentiators to defend:** (a) Linear-class layout/keyboard UX in an open-source tracker, (b) solo-first operation without org ceremony, (c) GraphQL+MCP API surface, (d) genuinely simple self-hosting.

## 1.5 Legal Posture

**CRITICAL — READ BEFORE IMPLEMENTING.**

Velocity achieves parity with Linear in *layout geometry, interaction model, and behavior* only. The implementation must be clean-room:

1. **No Linear code.** Do not copy, port, decompile, or reference Linear's proprietary source code, SDK internals, or client bundles.
2. **No Linear assets.** Do not copy Linear's logo, wordmark, marketing copy, illustrations, screenshots into the repo or docs.
3. **No Linear trademarks.** The product must not be branded "Linear" or anything confusingly similar. Comparisons in docs are nominative fair use ("a Linear alternative").
4. **Layout parity ≠ asset copying.** §4.10 specifies Linear's layout *geometry* (sidebar + list + panel structure, proportions, density) from publicly observable, functional characteristics. Functional layouts are not copyrightable subject matter; all visual styling comes from the openly-published Atlassian Design System. No Linear screenshots may be used as design references in-repo; use §4.10's written geometry spec.
5. **Feature parity ≠ code parity.** Implement from the behavioral descriptions in this document, never from reverse-engineering Linear's client.
6. All Linear behaviors in this spec derive from public documentation (linear.app/docs, developers.linear.app, public changelogs) and general knowledge of issue trackers.

## 1.6 Naming

**"Velocity" is a working title.** Known collisions exist (a Minecraft proxy, a legacy JS engine). The eventual name must be trademark-clear, short, developer-friendly, and rename-safe: no hard-coded branding outside `packages/ui` tokens and a single `BRANDING.md`. This spec uses "Velocity" throughout; a rename is a single-PR mechanical change.

---

# 2. Scope

## 2.1 v1.1 Scope

**Core tracker + GitHub integration + MCP server, solo-first** — as locked in planning:

- Accounts (single-user or small-team), single workspace per deployment, members optional
- Teams with issue prefixes (`ENG-123`) — used as categories/projects-for-code, not org units
- Issues: full property model (priority, estimate, labels, assignee, cycle, project, relations, sub-issues)
- Custom workflows (statuses) per team
- Cycles (optional per team, auto-rotation, velocity)
- Projects (milestones, progress, health)
- Views (saved filters, group/sort/display)
- Notifications: in-app inbox only (no email in v1.1)
- My Issues, Favorites
- Basic insights (velocity, created vs completed — minimal charts)
- Full keyboard navigation + command palette, Linear-parity layout
- GraphQL API (public parity with app), personal API keys
- HMAC webhooks (single-user-friendly: optional)
- GitHub App integration (PR linking, auto-close, status transitions)
- MCP server (12 tools, stdio + optional HTTP)
- Importers: Linear (CSV + API-assisted), GitHub Issues, Jira (CSV)
- Dark (default) + light themes, token-driven
- Docker Compose (3 containers: app, postgres, caddy)
- i18n infrastructure (English default)

## 2.2 Explicit Non-Goals for v1.1

Cut from v1.0 spec (recorded here to prevent re-scope creep):

- **Triage inbox, triage duty rotation, triage rules** — solo users self-triage; all issues land in the default status
- **4-role RBAC / guests / team-admin flags** — replaced by: every member is a peer; only workspace-level "Owner" distinction (the person who can delete the workspace) — see §3.2.3
- **Email/SMTP, notification digests** — in-app inbox only; email is post-MVP
- **OAuth client registry** (public integration apps) — personal API keys suffice for v1.1
- **Slack/Sentry/Figma/Zendesk integrations, customer requests, documents, initiatives, releases, SLAs, SSO/SAML/SCIM**
- **Insights dashboards (full), custom dashboard builder** — trimmed to two charts
- **Redis, MinIO, separate worker container** — replaced by Postgres-native equivalents (§5.1)
- **Local-first sync engine** — remains a research track

## 2.3 Post-MVP Roadmap

- **v1.2 — Integrations:** email notifications (SMTP), Slack, Sentry, GitLab, Figma
- **v1.3 — Growth:** multi-workspace tenancy, guest accounts, simple role separation, SAML/OIDC, triage inbox (for when solo users become teams)
- **v1.4 — Planning:** initiatives/roadmap, documents, releases
- **Research:** local-first offline client, Kubernetes/Helm

---

# 3. Product Requirements — Core Domain

## 3.1 Concept Map

```
Workspace (your deployment; single workspace, zero ceremony)
├── Members (optional; 1 = solo mode)
├── Teams (categories with issue prefixes — "ENG", "WEB", "PERSONAL")
│   ├── Team workflows (custom statuses)
│   ├── Labels (workspace-wide, grouped)
│   └── Cycles (optional timeboxes, per team)
├── Issues (belong to exactly one team; TEAM-123 identifiers)
│   ├── Properties: priority, estimate, status, assignee?, labels, project?, cycle?
│   ├── Relations: blocks / blocked-by / related / duplicate
│   ├── Sub-issues (tree, max depth 5)
│   ├── Comments & activity timeline
│   └── Attachments (local disk)
├── Projects (cross-team efforts: milestones, progress, health)
└── Views (saved filters), Notifications (in-app)
```

**Identifier formats:**

- Workspace: single, slug fixed at install (configurable once in settings)
- Team: key, uppercase, 1–10 chars, unique, e.g. `ENG`
- Issue: `{TEAM-KEY}-{number}` per-team monotonic sequence, e.g. `ENG-123`
- All entities expose public UUIDs via API

## 3.2 Accounts & Authentication

### 3.2.1 Identity

- **Install-time owner setup:** first-run wizard creates the owner account (email optional — username + password suffices; email only needed for future email features). No workspace ceremony beyond naming.
- **Additional members (optional):** owner can create accounts from settings (name + password, shared-secret invite). No email flow required; invite links work offline/printable.
- **Login:** username-or-email + password. Sessions: httpOnly cookies, 7-day default ("remember me" 30 days).
- **Password rules:** min 10 chars, common-password deny list, argon2id hashing.

### 3.2.2 API keys

Personal API keys (`vel_`-prefixed, scopes read/write) from settings; shown once, stored hashed; for scripts, CI, and MCP sessions. See §6.2.

### 3.2.3 Permission model (deliberately minimal)

| Action | Member | Owner |
|---|---|---|
| Everything issue/team/project/cycle/view related | ✔ | ✔ |
| Invite/create members, manage API keys (own) | own keys ✔ | ✔ |
| Workspace settings (name, integrations, webhooks, import/export) | ✖ | ✔ |
| Delete workspace | ✖ | ✔ |

All members are peers otherwise — no admin/member distinction, no guests, no per-team permissions. This is a product decision, not an oversight; solo-first means permissions are mostly irrelevant, and small teams self-organize.

## 3.3 Workspace

- **Single workspace per deployment.** No workspace switcher, no org picker. (Deployment = workspace; multi-workspace is post-MVP.)
- Settings: name, slug (URL), timezone, locale, danger zone (export/delete).
- **First-run wizard:** name your workspace → create your first team (suggest `ENG`) → (optional) install GitHub App → done. Total time target: < 2 minutes.
- **Deletion:** owner-only, type-the-name confirmation, 7-day recovery via retained volume, then unrecoverable.

## 3.4 Teams

Teams are **categories for work**, not org units — e.g. `ENG` (engineering), `OPS`, `PERSONAL`. Solo users typically have 1–3.

- **Properties:** name, key (uppercase alphanumeric, 1–10 chars, unique), color, icon (emoji), description, cycle settings (§3.8), workflow (§3.6), membership (optional per-member join; default: all members see all teams — see §3.4.1).
- **Sidebar appearance:** per team — Active (current cycle's issues), Backlog, Cycles, Projects, Views (as Linear does).
- **Deletion:** soft-delete with issue reassignment flow to another team.

### 3.4.1 Visibility

Default: all workspace members can see and work every team (small-team assumption). Optional per-team "hidden from member X" list exists only as a post-MVP candidate; v1.1 ships no visibility controls — the workspace is a trusted room. (Simplification recorded deliberately.)

## 3.5 Issues

| Property | Type | Values / Behavior |
|---|---|---|
| `title` | string | 1–512 chars. Required. |
| `description` | rich text | Markdown (CommonMark), sanitized render; code blocks, task lists, images |
| `team` | ref | Exactly one team. |
| `number` | int | Per-team sequence, atomic (§5.11). |
| `status` | ref | One of team workflow statuses (§3.6). Default = first backlog/todo status. |
| `assignee` | ref \| null | Any member. Solo mode: usually null or self. |
| `priority` | enum | `0` Urgent, `1` High, `2` Medium (default), `3` Low, `4` No priority |
| `estimate` | int \| null | 0–40; scale configurable (points) |
| `labels` | set | 0–10 from workspace labels (§3.7) |
| `project` | ref \| null | Optional (§3.9) |
| `cycle` | ref \| null | Optional (§3.8); auto-carryover per team setting |
| `parent` | ref \| null | Sub-issue tree, depth ≤ 5 |
| `relations` | set | typed edges (§3.5.3) |
| `archived` | bool | Soft-archive; excluded from default views |
| `trashed` | bool | 30-day soft-delete recovery |
| `order` | float | Fractional ordering within groups |
| `created/updated` | timestamps | Audit-tracked |

### 3.5.1 Issue lifecycle

- **Create:** `C` opens the Linear-style modal: title + team; all other properties inline in the modal. Server assigns number atomically.
- **Edit:** all properties inline on detail panel; every change emits activity.
- **Move between teams:** mints a new number in target team; permanent moved-pointer in UI/API (`movedToIssueId`).
- **Duplicate:** shallow copy (title, description, labels), links as related.
- **Bulk:** multi-select (`X`, shift-click, cmd-click) → status/assignee/priority/labels/project/cycle/archive/delete.
- **Archive vs trash:** archive = keep forever, out of default views; trash = 30-day recovery then hard delete.

### 3.5.2 Sub-issues

Tree depth ≤ 5; expandable tree on detail view; parent shows `done/total` rollup counts; re-parenting within depth limit.

### 3.5.3 Relations

| Type | Meaning | UI |
|---|---|---|
| `blocks` | A blocks B | "Blocks" list both directions |
| `blocked_by` | derived inverse | "Blocked by" list |
| `related` | undirected | "Related" list |
| `duplicate` | A duplicates B (B canonical) | duplicate marker on A |

Relations are informational + filterable (`is:blocked`); no enforcement automation.

### 3.5.4 Comments & activity

- Rich-text comments, editable by author, soft-deletable; `@member` mentions (notify + link); activity timeline merges property changes, comments, GitHub events; reactions (emoji picker).

## 3.6 Workflows (Custom Statuses)

Each team owns an ordered status set with category semantics:

- **Status properties:** name (1–32, unique per team), category (`backlog`, `todo`, `in_progress`, `done`, `canceled`), color (from §4.2.3 palette), order, description.
- **Default workflow:** `Backlog → Todo → In Progress → Done → Canceled`; moving to `done` stamps `completed_at`.
- Max 20 statuses per team; deletable when unused (or reassign flow).
- Category drives behavior: cycle completion counts `done`; WIP groups use `in_progress`.

## 3.7 Labels

Workspace-wide shared:

- Properties: name (unique), description, color (§4.2.3 palette), group (parent for picker grouping).
- Defaults: `Bug`, `Feature`, `Improvement`, `Design`, `Performance`, `Security` + group `Type`.
- Filter: `label:bug`; lozenge display (§4.9.5).

## 3.8 Cycles

Optional per team (off by default for personal teams — deliberate solo-first default):

- **Properties:** number, name ("Cycle N"), starts/ends, auto-rotation on/off.
- **Length:** 1–8 weeks, default 2; rotation anchored to team timezone.
- **Auto-rotation:** daily cron (in-app, §5.6): close cycle at end (snapshot stats: completed points/count, scope changes), carry incomplete issues to next cycle or backlog (team setting), open next cycle.
- **Cycle view:** status-grouped issue list + progress bar + velocity sparkline (last 6 cycles); "added after start" scope markers via cycle history.
- Cycles are per-team; no cross-team cycles.

## 3.9 Projects

Cross-team efforts with Linear-parity semantics:

- **Properties:** name, description (rich), icon/color, status (`planned`, `in_progress`, `completed`, `canceled`), lead (any member), target date, health (`on_track`, `at_risk`, `off_track` — manual).
- **Progress:** auto-computed from issues (count + points); event-driven recompute, cached.
- **Milestones:** ordered; name, target date, status; optional per-issue assignment; rollup progress.
- **Project view:** header with progress/health; tabs — Overview, Issues (embedded view), Milestones, Activity.

## 3.10 Views

- Filter chips (property+operator+value) compiling to/from the DSL (§6.1.4); chips canonical, DSL is interchange format.
- Display: grouping (`status`, `assignee`, `priority`, `label`, `project`, `cycle`, `team`, `none`), ordering (priority, status, created, updated, estimate, manual), layout (`list`, `board`), visible columns.
- Personal views only in v1.1 (no team-shared views — small-team sharing happens by URL).
- **URL-serialized state:** every view state is a query string; shareable links; saved views get slugs.
- Presets: per team Active/Backlog/All; workspace My Issues (Open, Created, Subscribed).

## 3.11 Notifications

In-app only (v1.1):

- Events: assignment, @mention, comment on subscribed issue, status/priority change on subscribed issue, relation added, GitHub PR linked/merged, cycle closing tomorrow (workspace-level banner).
- Inbox: single feed, unread-first, day-grouped; subscribe/unsubscribe per issue; presets "Assigned", "Subscribed", "All".
- No email, no digests (post-MVP with SMTP support).

## 3.12 Settings & Administration

Minimal settings surface (owner-gated where noted):

- **Workspace:** name, slug, timezone, locale, export (JSON), delete (owner).
- **Members:** list, add (invite link), deactivate, remove, change password (owner).
- **Teams:** create/edit/archive/delete, workflow editor, cycle settings.
- **Labels:** CRUD.
- **API keys:** create/revoke (own keys; owner sees all).
- **Integrations:** GitHub App (§6.5), MCP info (§6.6), webhooks (§6.4).
- **Import/Export:** launchpad (§6.7).
- **Audit:** owner-only, filterable activity on security-relevant actions (§5.12).

---

# 4. Design System & User Experience

## 4.1 Design Philosophy: Behavior Parity, Visual Independence

Velocity's UX is governed by a two-layer model, resolved deliberately:

1. **Layout & interaction layer (Linear parity — binding):** the application shell geometry imitates Linear: persistent left sidebar as the primary navigation, dense list views as the work surface, right-side detail panel for issue focus, minimal top chrome (search and user affordances live in the sidebar's bottom, not a top bar). Keyboard-first, command palette, optimistic updates, Linear's mental model of teams/cycles/views.
2. **Visual layer (Atlassian Design System — binding):** tokens, component styling, density, theming, accessibility patterns from the openly-published ADS.

**Conflict resolution rules:**

- Where ADS *component chrome* and Linear *layout geometry* disagree, **layout follows Linear, styling follows ADS**. E.g.: navigation lives in a Linear-style sidebar, but the sidebar's items, hover/selected states, and colors are ADS side-navigation patterns.
- Where ADS interaction defaults conflict with keyboard-first operation, **keyboard parity wins**.
- Density target: Linear-like density in issue lists (32px rows); ADS medium density in settings/forms.

**Binding rules:**

- All styling MUST derive from ADS as codified in §4.2. No hard-coded hex outside `packages/tokens`.
- The shell layout MUST implement §4.10's geometry spec. The layout is what makes Velocity *feel* like Linear; the tokens are what make it *look* like a serious tool — and legally distinct.

## 4.2 Atlassian Design System Token Architecture

Tokens are the single source of styling truth. Implementation: CSS custom properties (`--ds-*`) generated by the `tokens` package, consumed by Tailwind theme config and component classes. **No hard-coded hex values anywhere outside the token definitions.** Semantic tokens only — components never reference raw palette tokens.

### 4.2.1 Token naming

```
--ds-color-{role}          e.g. --ds-color-text, --ds-color-surface
--ds-color-{role}-{state}  e.g. --ds-color-border-hover
--ds-space-{n}             4px base grid: 0,25,50,75,100,150,200,300,400,600,800,1000 (0–40px)
--ds-radius-{n}            4,8,12 → rounded-sm (4), rounded (8), rounded-lg (12); NO larger radii
--ds-font-{role}           body, heading, code, ui
--ds-font-size-{n}          100 (11px), 200 (12px), 300 (14px), 400 (16px), 500 (18px), 600 (20px), 700 (24px)
--ds-shadow-{n}            none, card, overlay (minimal usage)
--ds-duration-{n}           100ms, 150ms, 200ms
--ds-z-index-{n}           sticky=100, dropdown=300, modal=400, flag=500, tooltip=600
```

### 4.2.2 Semantic token inventory

| Role | Light value | Dark value | Usage |
|---|---|---|---|
| `primary` | `#0C66E4` | `#579DFF` | Primary actions, active nav, links, focus |
| `primary-hover` | `#0055CC` | `#85B8FF` | Primary hover/pressed |
| `primary-subtle` | `#E9F2FF` | `#22272B` + primary border | Selected rows, filter-active chips |
| `text` | `#172B4D` | `#CCE0FF`→ per published ADS dark text token | Body & headings |
| `text-subtle` | `#44546F` | `#8C9AB0` | Metadata, labels, helper text |
| `text-disabled` | `#091E4247` | `#10192873` family | Disabled controls |
| `surface` | `#FFFFFF` | `#1D2125` | Cards, modals, inputs, dropdowns |
| `surface-sunken` | `#F7F8F9` | `#161A1D` | Panels, table headers, row hover, app bg |
| `surface-raised` | `#FFFFFF` | `#22272B` | Dropdowns, modals, popovers (dark) |
| `border` | `#D0D4DB` / `#091E4224` | `#A6C5E229` | All borders; the ONLY border color |
| `focus` | `#85B8FF` | `#85B8FF` | Focus ring (2px, offset 2px) |
| `danger` | `#CA3521` | `#F87166` | Destructive actions, errors |
| `danger-subtle` | `#FFECEB` | `#251D21` family | Error banners/field backgrounds |
| `warning` | `#DC6803` | `#E2B203` | Warning lozenges/flags |
| `success` | `#1F845A` | `#57D9A3` | Success flags, done lozenge text |
| `success-subtle` | `#DCFFF1` | `#12251E` family | Success banner backgrounds |
| `discovery` | `#5E4DB2` | `#9F8FEF` | Secondary accent (sparing: AI/MCP badges) |

Border strategy (ADS): `1px solid --ds-color-border`; separation via surface value shifts and borders, **not shadows**.

### 4.2.3 Status palette (workflow statuses & labels)

Per-team status colors and label colors draw from a fixed ADS-anchored palette. Each color defines a light/dark pair (light / dark):

| Color | Light | Dark | ADS semantic |
|---|---|---|---|
| blue | `#0C66E4` | `#579DFF` | primary / in-progress |
| green | `#1F845A` | `#57D9A3` | success / done |
| red | `#CA3521` | `#F87166` | danger / removed |
| yellow | `#DC6803` | `#E2B203` | warning / needs-attention |
| purple | `#5E4DB2` | `#9F8FEF` | discovery / moved |
| teal | `#22A06B` | `#6DE3B2` | success variant |
| grey | `#6B778C` | `#8C9AB0` | neutral / backlog |
| pink | `#E2493F` | `#F97A9C` | danger variant |

Default workflow status colors: Backlog=grey, Todo=blue, In Progress=yellow, Done=green, Canceled=grey. Teams may recolor statuses from this palette only (lozenge rendering per §4.9.5). Status colors used as text must meet AA contrast in both themes.

## 4.3 Dark Theme (Default)

Dark is the default theme (Linear-class feel), built on ADS dark theme semantics:

- Surfaces: canvas `surface` (#1D2125 family); sunken panels darker (#161A1D); raised overlays lighter (#22272B). Binding relationship: sunken < surface < raised in luminance.
- Text: near-white per published ADS dark text tokens; subtle metadata #8C9AB0; all pairs ≥ 4.5:1 (WCAG AA).
- Borders: translucent light-on-dark (ADS dark border formula, `#A6C5E229` family).
- Status palette dark pairs per §4.2.3.
- Selected state: `surface-raised` + 2px left `primary` border (§4.9.15), not fill-tinting.

**Implementation note (binding):** exact dark values MUST be generated from the published ADS dark theme tokens at https://atlassian.design/foundations/color-new during `packages/tokens` implementation — structural relationships above are binding; published tokens are the source of truth where hexes differ. Light values (§4.4) are from the ADS skill reference and are binding.

## 4.4 Light Theme

- Light is a complete, first-class theme: every component ships both themes with equal visual QA (§7.3 visual regression in both).
- Surfaces: `#FFFFFF` primary, `#F7F8F9` sunken; raised overlays = white + overlay shadow.
- Text: `#172B4D` body, `#44546F` subtle — the ADS reference text pair.
- Status palette light pairs per §4.2.3.
- Selected rows: `#E9F2FF` (primary-subtle) + 2px left primary border; focus #85B8FF.

## 4.5 Theme Switching

- `data-theme="dark" | "light"` on `<html>`; tokens swap atomically; no reload; persisted per user.
- `prefers-color-scheme` respected on first visit; dark default when no signal (explicit product decision).

## 4.6 Typography

- Stack: `Atlassian Sans Variable` self-hosted (fallback: `"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`).
- Scale (rem): 11/12/14/16/18/20/24 (§4.2.1 token names). UI default 14px/1.5; dense issue rows use 14px title + 12px metadata; semibold sparingly (titles, primary buttons, selected nav).
- Code: `ui-monospace, "SFMono-Regular", Menlo, Consolas` — issue identifiers (`ENG-123`) always mono, 12px, subtle color.

## 4.7 Iconography

- **@atlaskit/icon** preferred; fallback per skill rule: **Font Awesome 6** free (self-hosted subset) with a semantic mapping table.
- Sizes: 16px inline, 20px buttons, 24px nav; stroke/currentColor.
- Icon-only buttons banned without `aria-label` (binding skill rule); each carries a tooltip with its accessible name.
- Fixed priority mapping: Urgent=alarm, High=arrow-up-circle, Medium=arrow-right-circle, Low=arrow-down-circle, None=dash-circle — theme-aware colors.

## 4.8 Spacing, Radius, Elevation

ADS foundation rules (binding):

- **Spacing:** 4px base grid via `--ds-space-*` tokens (§4.2.1). Component paddings from the token scale only — no ad-hoc pixel values.
- **Radius:** `4px` controls/inputs/lozenges, `8px` cards/panels/dropdowns, `12px` modals only. Nothing rounder; pill-radius only on badges/avatars. (Skill rule: no over-rounding.)
- **Elevation:** shadows minimal — dropdowns and modals get the `overlay` shadow; everything else separates via surface value shifts (`surface` vs `surface-sunken`) and 1px borders. No shadow stacking on nested elements; no depth theatrics.
- **Motion:** 100–200ms transitions on color/background only; the only movement animations are dropdown/modal enter (150ms opacity + 4px translate) and toast slide (200ms). `prefers-reduced-motion` disables all transform/opacity animation.

## 4.9 Component Specifications

The component library (`packages/ui`) implements these ADS components; the skill's DESIGN.md examples are canonical references.

### 4.9.1 Button
Variants: `primary`, `default` (outlined), `subtle`, `link`, `danger`. Sizes: sm 28 / md 32 / lg 40px. States: rest, hover, active, focus-visible (`focus` ring), disabled, loading (spinner, width locked). One primary per view region; destructive via `danger` variant.

### 4.9.2 Text field / Textarea
32px (sm 28); 1px border; focus ring; invalid = danger border + 12px inline error; helper text 12px subtle. Labels always visible (placeholder-only banned); max 2 primary inputs per row (skill rule).

### 4.9.3 Select / Combobox / Popup select
Native select ≤ 15 static options; custom popup select for filterable sets (assignee, label, status, member pickers) with search, ↑↓/Enter/Esc keyboard, grouped sections, selected check, `primary-subtle` hover. Structured choices never free text (skill rule).

### 4.9.4 Checkbox / Radio / Switch
Checkbox 16px + indeterminate for bulk headers; radios ≤ 5 options; switch 32×18px for immediate-effect settings only, never form submit (skill rule).

### 4.9.5 Lozenge (status badges)
Signature status display: variant-tinted (status color at 15% bg / full-color text), 4px radius, 11px semibold, `nowrap`. Issue lists render a 6px color dot + name (density); full lozenge in detail views, boards, tables.

### 4.9.6 Table (DynamicTable)
Header: `surface-sunken`, 12px uppercase subtle, sortable columns with ↑/↓ indicator via `aria-sort` (never raw sort text — skill rule). Rows 40px, border-top separators, hover sunken, selected = `primary-subtle` + 2px left primary border, roving tabindex, sticky header. Empty state: icon + one sentence + primary action.

### 4.9.7 Flag (toast)
Bottom-left stack, max 3, auto-dismiss 5s (errors persist), 200ms slide-in, dismiss ×, optional action link, severity dot. Never for critical errors (those become inline messages/banners — skill rule).

### 4.9.8 Modal dialog
Destructive confirms, issue-create modal (Linear-parity `C`), focused secondary tasks; NEVER routine inline edits (skill rule). Widths sm 400 / md 560 / lg 760; `surface-raised`, 12px radius, focus trapped, Esc closes (dirty confirm), Enter submits primary.

### 4.9.9 Inline message / Banner
`*-subtle` bg, 4px radius, icon + 12px text — form sections, permission notices, offline state, cycle-ending warnings.

### 4.9.10 Tooltip
Delay 300ms; 12px text; max-width 240px; `aria-describedby` linked; Esc/blur dismiss. Never hides required info (skill rule).

### 4.9.11 Progress / Skeleton
Skeletons for route-level loads; small spinners (16px) adjacent for component fetches; determinate progress bar + % for imports/exports.

### 4.9.12 Pagination
Views default to infinite scroll (Linear-parity, `J/K` page-through); explicit ADS pagination where chunking aids orientation (imports report, audit log).

### 4.9.13 Menu (dropdown)
Overflow menus (⋯): grouped items, danger text for destructive, submenu for moves; keyboard navigable; primary actions never buried in menus (skill rule).

### 4.9.14 Tabs
ADS tabs (bottom border active `primary`) for object-page siblings: project tabs, issue detail (Comments/Activity/GitHub), settings sections. 32px height, 14px text.

### 4.9.15 Side navigation
Persistent left nav per §4.10 geometry. Item states: rest (`text-subtle`), hover (`surface-sunken`), selected (`surface-sunken`/`surface-raised` + `primary` text + 2px left `primary` border + weight 500), focus ring. Collapsible groups; collapse persists; keyboard-navigable as combined list with group separators.

### 4.9.16 Breadcrumbs
Only where depth exists (Settings paths). Subtle links, current = text + semibold; `>` separators; truncation beyond 4 levels.

## 4.10 Application Shell & Layout — Linear-Parity Geometry (Binding)

**The shell imitates Linear's layout.** This section specifies the geometry precisely; all styling (colors, borders, hover states) comes from §4.2 tokens. Layout constants are binding; deviation requires spec change.

### 4.10.1 Shell structure

```
┌──────────┬──────────────────────────────────┬───────────────────┐
│          │                                  │                   │
│ SIDEBAR  │         LIST / CONTENT            │   DETAIL PANEL    │
│ 220px    │         (fills remaining)        │   400px (open     │
│ fixed    │                                  │   on issue focus) │
│          │  ┌────────────────────────────┐  │                   │
│ ┌──────┐ │  │ View header                │  │  issue title      │
│ │srch⌕ │ │  │ (title, count, filters,    │  │  status lozenge   │
│ └──────┘ │  │  display options, +)        │  │  properties       │
│          │  ├────────────────────────────┤  │  description      │
│ Inbox    │  │ Grouped issue rows          │  │  sub-issues       │
│ My Issues│  │ ──────────────────────────  │  │  comments         │
│ ── Teams │  │ ● Todo           (12)       │  │  activity         │
│ ▾ ENG    │  │   ENG-121 Fix login …      │  │                   │
│   Active │  │   ENG-118 Add cache …      │  │                   │
│   Backlog│  │ ● In Progress     (3)       │  │                   │
│   Cycles │  │   ENG-123 Refactor …       │  │                   │
│   Projects│  │ …                          │  │                   │
│   Views  │  └────────────────────────────┘  │                   │
│ ▾ WEB    │                                  │                   │
│ ── Projects (cross-team)                    │                   │
│ ── Favorites                               │                   │
│            │                                  │                   │
│ ────────  │                                  │                   │
│ + New ⌘N  │                                  │                   │ (bottom-left)
│ ⚙ Settings│                                  │                   │
│ 👤 avatar │                                  │                   │
└──────────┴──────────────────────────────────┴───────────────────┘
```

### 4.10.2 Geometry rules (binding constants)

| Element | Spec |
|---|---|
| **Top bar** | **None.** No top navigation bar, no top app bar, no top header strip. Search, New, settings, avatar live in the sidebar (bottom or top inset). This is the defining Linear geometry trait. |
| Sidebar | 220px fixed, full-height, `surface-sunken`; no top bar means sidebar owns identity: workspace name (plain text, 14px semibold) at top; below it the search input; then nav sections. |
| Content | Fills remaining width between sidebar and optional panel. View header (48px): title (16px semibold), count badge, filter chips, display options menu, `+ New issue` primary button (32px). |
| Issue rows | 32px height, single-line: priority icon, team-key+number (mono 12px subtle), title (14px), right-aligned metadata (label lozenges condensed, assignee avatar 20px). Row hover = `surface-sunken`; focused row = 2px left primary border; selected = `primary-subtle`. |
| Status groups | Section header: 6px status-color dot + name (12px semibold subtle) + count (12px subtle) + collapse chevron; sticky within scroll. |
| Detail panel | 400px fixed right panel, opens on issue focus (`Enter`); `Esc` closes and returns focus to list; full-page issue view available via `⌘Enter`; panel = `surface` with 1px left border. |
| Empty states | Centered in content: icon + one sentence + primary action. |
| Modal | Issue-create modal centered (per §4.9.8), Linear-parity `C` flow. |
| Density | Lists dense (Linear-like); settings/forms medium (ADS). |
| Responsive | ≥1280 full shell; 1024–1280 sidebar 180px, panel 360px; 768–1024 panel overlays content (no sidebar collapse — sidebar is the product); <768: sidebar as drawer + list + full-page issue view (panel becomes route). |

### 4.10.3 Sidebar sections (top to bottom, binding order)

1. Workspace name (identity row)
2. Search input (⌕, `/` focuses, §4.12)
3. **Workspace nav:** Inbox (unread badge), My Issues
4. **Teams:** per team — collapsible: Active, Backlog, Cycles, Projects, Views
5. **Projects** (cross-team list, ≤ 8 shown + overflow)
6. **Favorites** (starred views, orderable)
7. **Bottom inset:** `+ New` (opens menu: Issue/Team/Project/View), Settings gear, user avatar + name + workspace

### 4.10.4 Layout-parity conformance tests

- Visual regression suite snapshots the shell at 1440px and 1024px in both themes; geometry diffs (column widths, row heights, section presence/order) fail CI.
- A checklist test asserts: no top-bar element exists in the DOM shell; sidebar is 220px±2; panel is 400px±2; issue row height 32px±2.

## 4.11 Screen Specifications

All screens: keyboard-complete (§4.12), skeletons on route load, empty states per §4.9.6.

### 4.11.1 Team — Active (default landing)
View header: team icon+name, cycle picker (`Cycle 17 ⌄`) when cycles on, progress bar, `+ New issue`. Content: status-grouped list (§4.10.2 row anatomy). `B` toggles board layout (status columns, DnD + keyboard `M`).

### 4.11.2 Team — Backlog
Flat manual-ordered list (drag + `⌥↑/↓`), group-by-priority toggle, bulk "add to cycle".

### 4.11.3 Issue detail (panel default, page optional)
Header: `ENG-123` mono + status lozenge + inline-editable title (500ms debounce autosave). Properties block: status, assignee, priority, labels, project, cycle, estimate — popup-select inline editors. Description editor; sub-issue tree; relations; tabs Comments / Activity / GitHub (when linked); subscribe toggle + timestamps.

### 4.11.4 Cycles screen
Cycle header: range + velocity sparkline + progress; grouped issue list; "added" scope markers; closed-cycles archive list.

### 4.11.5 Projects list / Project detail
List: ADS table (name, status lozenge, lead, progress bar, target, health). Detail: tabs Overview / Issues (embedded view) / Milestones (timeline) / Activity per §3.9.

### 4.11.6 Views / view builder
Filter chips (popup-select per property+operator+value); display options dropdown (grouping, ordering, layout, columns); save view (name+icon, personal). Chips canonical — no raw DSL text in UI (skill rule).

### 4.11.7 Insights (minimal, v1.1)
Two ADS cards on workspace home: created vs completed (12-week dual-line), cycle velocity per team (6-cycle bars). Every chart links to its underlying live view.

### 4.11.8 Search
Palette-integrated (§4.13) + sidebar input: grouped results (Issues, Teams, Projects, Members, Views), debounced 150ms, recent searches.

### 4.11.9 Settings
Per §3.12; ADS form sections; settings open as content-region route (no separate shell).

### 4.11.10 Inbox
Single feed: notification rows (icon by type, issue ref mono, action summary, relative time), unread-first, day-grouped, `E`-mark-read, bulk mark-all.

## 4.12 Interaction & Keyboard Specification

Keyboard model is Linear-parity. All shortcuts work regardless of focus (except text fields):

| Key | Action |
|---|---|
| `Cmd/Ctrl+K` | Command palette |
| `C` | Create issue (modal) |
| `/` | Focus search |
| `?` | Shortcuts help (searchable modal) |
| `G` then `B` | Go to Backlog (current team context) |
| `G` then `I` | Inbox |
| `G` then `M` | My Issues |
| `G` then `A` | All issues (workspace view) |
| `G` then `P` | Projects |
| `G` then `S` | Settings |
| `G` then `T` | Cycle (current team) |
| `↑/↓` | Navigate issue rows / palette / menu items |
| `Enter` | Open focused issue in right panel / `⌘Enter` full page |
| `Esc` | Close panel/menu/modal/clear selection |
| `X` | Toggle selection; `⇧X` range; selection action bar (bottom) |
| `E` | Mark done (toggle; when inbox-focused: mark read) |
| `I` | Assign to me |
| `A` | Assign to… (combobox) |
| `L` | Add label… |
| `P` | Set priority… |
| `S` | Set status… |
| `M` | Move to team… |
| `R` | Add relation… |
| `V` | Move issue (context menu) |
| `Y` | Archive |
| `#` | Delete (confirm) |
| `B` | Toggle board/list |
| `⌥/Alt`+`↑/↓` | Reorder within group |
| `Tab` | Between regions (sidebar / content / panel) |
| `Cmd/Ctrl+Enter` | Submit comment |

**In text fields:** `Esc` returns focus to list; `@` opens member-mention combobox; `#`-prefix opens issue-ID autocomplete.

**Selection semantics:** `X` toggle; `⇧X` range; bottom action bar (ADS banner) with bulk status/assignee/priority/labels/archive/delete + count.

**Focus rules (binding):** modal close returns focus to prior element; panel close returns to list at same position; roving tabindex on lists; no dead-ends; every focusable element shows the `focus` ring — `outline: none` without replacement is banned.

## 4.13 Command Palette

`Cmd/Ctrl+K` (Linear-parity):

- Grouped results: Actions (context-aware), Navigation ("Go to: ENG Active"), Issues (fuzzy on `ENG-123 — Title`), Recent.
- Keyboard-complete: ↑↓, Enter, Esc, Tab between groups; fuzzy match actions + issue IDs/titles.
- Mode prefixes: `>` commands; `#` issue-ID jump; `@` member. Same grammar as text fields.
- Palette never the only path — every action has a shortcut or visible control.

## 4.14 Copy & Content Rules

Binding (ADS skill):

- Operational UI copy only; no marketing copy, taglines, or design commentary in-app.
- Headings/labels describe state/content/action; helper text short and only where genuinely helpful.
- Empty states: one sentence + action; never raw sort/filter tokens as text.
- Icon-only controls carry accessible names; ≤ 8-char strings in compact controls never wrap.
- Errors: human sentences with recovery action.
- Issue identifiers always mono.

## 4.15 Accessibility

- WCAG 2.1 AA minimum; AAA where tokens allow.
- Full keyboard operation verified by test suite (§7.3).
- ARIA authoring patterns for lists/tables/menus/tabs/dialogs; roving tabindex; `aria-sort/selected/expanded` completeness.
- Quarterly manual NVDA + VoiceOver passes; automated axe audits (§7.3).
- Reduced motion honored; focus-visible never suppressed.

## 4.16 Performance Budgets (UI)

| Metric | Budget |
|---|---|
| Interaction latency (keydown → visual) | < 100ms p95 (optimistic updates mandatory) |
| Route transition (cached) | < 200ms p95 |
| First contentful paint (cold) | < 2.5s p75; bundle ≤ 350KB gz initial JS |
| Issue list scroll | 60fps @ 10k rows (virtualization for > 100 rows) |
| GraphQL query server | p50 < 50ms; issues query p95 < 150ms |
| Memory | < 150MB steady-state @ 10k issues |

Bundle discipline: route-level splitting; SVG-native charts; lazy editor; icon subsetting.

## 4.17 Anti-Patterns (Explicitly Banned)

1. Glassmorphism, backdrop-blur, translucent surfaces.
2. Gradients as hierarchy.
3. Consumer-soft styling: oversized whitespace, lifestyle layouts, playful illustration in-app.
4. Radius > 12px containers; shadow stacking.
5. Hard-coded hex outside `packages/tokens`.
6. Placeholder-only labels; unlabeled icon buttons; raw sort/filter tokens as text.
7. Spinner-first interaction loading (skeletons for routes, optimism for mutations).
8. Marketing copy or commentary in-app.
9. Modals for routine inline edits.
10. **A top bar.** Any top navigation strip above the content region violates the Linear-parity shell (§4.10.2). The only fixed chrome is the sidebar.

---

# 5. Architecture

## 5.1 System Overview

Deliberately minimal — solo-first simplicity is architectural, not cosmetic:

```
┌────────────────────────────────────────────┐
│              Browser (SPA)                 │
│  React + Apollo Client + WS subscriptions  │
└──────────────┬─────────────────────────────┘
   HTTPS / WSS │
┌──────────────▼─────────────────────────────┐
│              app (Node.js)                 │
│  GraphQL API (Pothos + graphql-yoga)        │
│  Static SPA serving                        │
│  Auth (sessions + API keys)                │
│  Domain services (permissions §3.2.3)            │
│  Background jobs: pg-boss queues (in-proc) │
│  GitHub webhook receiver                   │
│  MCP HTTP transport (optional flag)         │
├──────────────┬─────────────────────────────┤
│  PostgreSQL 16          │ local disk        │
│  data + FTS + queues   │ attachments       │
│  + outbox (LISTEN/     │ (uploads dir)     │
│    NOTIFY realtime)    │                   │
└──────────────┴─────────┴───────────────────┘
   + Caddy (reverse proxy, auto-TLS)

Docker Compose: caddy + app + postgres  (3 containers)
MCP stdio: `npx -y <server>/mcp/client-<hash>.tgz` (separate process, talks to app over HTTP; served by the app, not npm)
```

**Key decisions (ADR summaries):**

1. **One process.** api, jobs, webhooks, and (optionally) MCP-HTTP all run in the single `app` process — pg-boss provides durable queues inside Postgres; no Redis, no separate worker container, no MinIO (local disk via mounted volume). For a solo deployment this is the right complexity budget; scale-out (separate worker) is a config flag, not a redesign — pg-boss queue tables move with the database.
2. **One API.** GraphQL is the only data plane (app, public API, MCP, importers) — parity by construction.
3. **Postgres does everything relational + search (FTS) + queues + realtime signaling.** Realtime fan-out uses Postgres `LISTEN/NOTIFY` piggybacked on the transactional outbox — no Redis pub/sub needed at this scale (hundreds of connections, not tens of thousands).
4. **Single workspace per deployment.** No tenant rows in the domain; `workspace_id` is dropped from tables (§5.11). The workspace concept exists in UX (settings) but not as a tenancy dimension.
5. **Local-disk attachments** in a mounted volume with a documented S3 escape hatch (env-configurable storage driver; post-MVP).

## 5.2 Technology Stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript 5.x strict, no `any` in domain | Single language everywhere |
| Monorepo | pnpm + Turborepo | Task graph caching |
| Frontend | React 18 + Vite + Apollo Client 3 | Optimistic updates + subscriptions |
| UI | Tailwind CSS v4 mapped to ADS tokens (§4.2) | Skill examples are Tailwind |
| GraphQL server | Pothos + graphql-yoga (HTTP + WS) | Code-first schema shared types |
| Client codegen | @graphql-codegen | Typed documents |
| DB | PostgreSQL 16 | Relational + FTS + LISTEN/NOTIFY |
| ORM | Drizzle + drizzle-kit migrations | SQL-first typed |
| Jobs | pg-boss (Postgres-backed) | Durable queues, no Redis |
| Auth | Custom sessions + argon2id | Simple, auditable |
| Rich text | tiptap, markdown-serialized | ProseMirror-grade editor |
| MCP SDK | @modelcontextprotocol/sdk | Official |
| GitHub | octokit + @octokit/webhooks | Official |
| Charts | hand-rolled SVG (tokened) | Bundle discipline |
| Testing | vitest, Playwright, k6 | §7.3 |
| Runtime | Node 22 LTS; Caddy proxy | LTS + auto-TLS |

## 5.3 Monorepo Layout

```
velocity/
├── SPEC.md, README.md, LICENSE (AGPL-3.0), BRANDING.md
├── docker-compose.yml, .env.example, Caddyfile
├── apps/
│   ├── web/          # React SPA (Vite) — built statics served by app
│   ├── server/       # GraphQL server + jobs + webhooks + static serving
│   └── mcp/          # MCP server (stdio always; HTTP flag) — thin client of server
├── packages/
│   ├── schema/       # Drizzle tables + zod domain schemas
│   ├── services/     # Domain services: IssueService, TeamService, CycleService,
│   │                 #   ProjectService, ViewService, NotificationService,
│   │                 #   SearchService, ImporterService, GitHubService, AuditService
│   ├── graphql/      # Pothos schema: types, queries, mutations, subscriptions, filters
│   ├── events/       # Domain event contracts + outbox publisher/consumer
│   ├── ui/           # ADS component library (§4.9)
│   ├── tokens/       # ADS token definitions (§4.2) — the ONLY hex-value location
│   ├── mcp-tools/    # MCP tool definitions shared by apps/mcp + docs
│   └── importers/    # Linear, GitHub Issues, Jira importers
├── scripts/          # dev seeds, e2e bootstrap
└── docs/             # setup, self-hosting, API, agents, import guides
```

Dependency rule (eslint-enforced): `schema` ← `events` ← `services` ← `graphql` ← apps; `ui` ← `tokens`; apps never import each other; all domain mutations happen in `services` (this is what makes MCP/importers/web share behavior exactly).

## 5.4 Frontend Architecture

- React Router routes: `/team/{key}/{active|backlog|cycles|projects|views}`, `/issue/{uuid}` (full-page), `/project/{uuid}`, `/inbox`, `/my-issues`, `/insights` (home cards), `/search`, `/settings/*`. Issue focus in right panel is route-state (`?issue=uuid`) — deep-linkable, back-button correct.
- Apollo normalized cache; typed documents; **every mutation ships an optimistic counterpart** (lint-enforced); optimistic create mints client UUID, reconciles or rolls back with a flag.
- Zustand for local UI state (selection, panel, theme); no Redux.
- TanStack Virtual for lists; sticky group headers; fixed row heights.
- Keyboard engine: single global listener, layered (global → list-context → field-context), declarative chord registry (`G` prefix), every command registered appears in palette (§4.13).

## 5.5 Realtime & Synchronization Model

Server-driven with optimistic updates + subscriptions (the v1.0 decision, retained). Mechanism, slimmed:

1. Mutations run in a Postgres transaction; domain events append to `event_outbox` in the same transaction.
2. Postgres triggers `NOTIFY velocity_events` from a trigger on outbox insert; the app process `LISTEN`s, drains new rows, and pushes typed invalidation payloads (`issue:updated {id, changedFields}`) over existing graphql-ws subscriptions — no Redis hop.
3. Apollo merges entity deltas; lists refetch their visible page when the filter matches.

**Conflict policy:** last-write-wins per field; `expectedUpdatedAt` optional guard for API writers → typed `CONFLICT` error. **Optimistic contract:** every mutation defines optimistic change, rollback flag text, and typed error mapping; > 300ms reconcile shows a 200ms subtle "sync pulse" on the row. Reconnect: exponential backoff 1–30s, refetch active queries; offline inline-message banner after 5s down.

## 5.6 Background Jobs

pg-boss queues in the `app` process (all idempotent):

| Queue | Jobs |
|---|---|
| `cycles` | rotation (daily cron per team), close-time stats snapshot |
| `notifications` | inbox row fan-out per event |
| `webhooks` | HMAC-signed delivery, 5× exp backoff, dead-letter + settings UI |
| `github` | inbound event processing, backfill on install, PR sync |
| `importers` | pipeline stages (parse → map → dry-run → commit in 500-row chunks), resumable |
| `maintenance` | trash purge (30d), workspace-delete retention (7d), session sweep, outbox purge |

`mcp` is not a queue consumer; it's a thin GraphQL client (§6.6).

## 5.7 Search

Postgres FTS: GIN on `issue_search(search_vector)` — title (weight A) + description + comments (weight C); `websearch_to_tsquery`; ts_rank with recency boost; `pg_trgm` + identifier fast-path for `ENG-123`. Searchable: issues, projects, teams, members. Same GraphQL `search()` powers palette, search screen, and MCP `search_issues`.

## 5.8 File Storage

- Default: local disk (`uploads/` mounted volume), paths opaque (UUID names), served by `app` with auth-scoped GETs.
- Storage driver interface (`packages/services`): `LocalDiskDriver` (default), `S3Driver` (post-MVP, env-configurable — the seam exists from day one).
- Uploads ≤ 25MB (configurable); mime allowlist; image thumbnails strip EXIF; deletion follows trash purge.
- Editor embeds via presigned-style time-limited URLs generated by `app`.

## 5.9 Deployment (Docker Compose)

`docker compose up` → working product on `http://localhost` (or your domain with Caddy auto-TLS).

- Services: `caddy` (80/443 → app), `app` (Node, serves SPA statics + API + WS), `postgres`. Optional profile `scale`: run `worker` flag separately (same image, different entrypoint) — pg-boss supports multiple pollers safely.
- **Single-user defaults:** 1 vCPU / 1GB RAM / 2GB disk comfortably runs a 10k-issue workspace (documented); scale linearly.
- Migrations: app container entrypoint runs drizzle-kit migrate (advisory lock, idempotent) before serving; healthcheck-gated.
- Upgrades: `docker compose pull && up -d`; N-1 compatibility; `VELOCITY_BACKUP_BEFORE_MIGRATE=1` dumps pg first.
- Zero telemetry; optional version-check ping (off by default).

## 5.10 Configuration

Environment (`.env.example` canonical; no secrets in DB, except the encrypted in-app GitHub App credentials of §6.5.4):

- `DATABASE_URL`, `APP_URL`, `APP_SECRET` (≥ 32 chars), `CADDY_DOMAIN`
- `UPLOAD_DIR` (default `/data/uploads`), `MAX_UPLOAD_MB`
- `GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_APP_SECRET / GITHUB_WEBHOOK_SECRET` (optional — GitHub off when unset and no in-app App exists; an App created in-app (§6.5.4) is stored encrypted in the DB and takes precedence)
- `MCP_HTTP_ENABLED` (default on), `MCP_HTTP_TOKEN` (optional extra bearer for the HTTP transport)
- `DISABLE_SIGNUP` (default true after first user; invite-link flow for members)
- `LOG_LEVEL`, `SENTRY_DSN` (optional)

## 5.11 Data Model

Drizzle schema (PostgreSQL 16). PKs `uuid` v7 (time-ordered). Timestamps `timestamptz`. **No `workspace_id` columns** — single-workspace deployment is the tenancy model (§5.1, ADR 4). ~19 tables:

### Identity
```
users            id, username (unique), email (citext, unique, nullable), password_hash,
                 name, avatar_path, timezone, locale, is_owner, created_at, updated_at,
                 suspended_at
sessions         id, user_id, token_hash, expires_at, ip, user_agent, revoked_at
api_keys         id, user_id, name, key_hash, scope ('read'|'write'), last_used_at,
                 expires_at, revoked_at
```

### Teams & workflows
```
teams            id, key (unique, 1-10 upper), name, icon, color, description,
                 cycle_enabled, cycle_length_weeks, cycle_start_day, cycle_timezone,
                 carry_over ('next_cycle'|'backlog'), sort_order, archived_at, deleted_at
team_members     id, team_id, user_id        (membership optional; default all-see-all §3.4.1)
workflows        id, team_id, version
statuses         id, workflow_id, name, category, color, "order", description, archived_at
labels           id, name (unique), color, description, parent_label_id, group
```

### Issues
```
issues           id, team_id, number (unique per team), title, description_md,
                 status_id, assignee_id, priority (0-4), estimate, sort_order,
                 parent_id, project_id, cycle_id,
                 created_by, created_at, updated_at, completed_at, canceled_at,
                 archived_at, trashed_at, moved_to_issue_id
issue_labels     issue_id, label_id
issue_relations  id, source_issue_id, target_issue_id, type ('blocks'|'related'|'duplicate')
                 (invariant: stored once; blocked_by derived; CHECK source≠target;
                  UNIQUE(source,target,type) + mirrored-inversion constraint)
comments         id, issue_id, author_id, body_md, edited_at, deleted_at, created_at
reactions        comment_id, user_id, emoji (unique triple)
attachments      id, issue_id?, comment_id?, uploader_id, storage_path, filename,
                 mime, size, created_at, trashed_at
```

### Cycles, projects, views
```
cycles           id, team_id, number, name, starts_at, ends_at, closed_at,
                 stats jsonb (immutable snapshot at close)
cycle_history    id, cycle_id, issue_id, added_at, removed_at
projects         id, name, description_md, icon, color, status, lead_id, target_date,
                 health ('on_track'|'at_risk'|'off_track'), progress_done, progress_total,
                 progress_points_done, progress_points_total, auto_archive,
                 archived_at, trashed_at, created_by, created_at, updated_at
milestones       id, project_id, name, target_date, status, sort_order
views            id, team_id?, name, icon, filter jsonb, display jsonb, owner_id,
                 is_favorite_for[], slug, created_at, updated_at
```

### Notifications, integrations, platform
```
notifications    id, user_id, issue_id?, type, payload jsonb, read_at, created_at
subscriptions    issue_id, user_id (unique)
webhooks         id, url, secret, event_types[], enabled, created_at
webhook_deliveries id, webhook_id, event_type, payload, status_code, attempt,
                 next_retry_at, delivered_at (30d retention)
github_installs  id, installation_id, settings jsonb (org, repos[], repo_team_map,
                 auto_close_on_merge, issue_sync)
github_links     id, issue_id, repo, pr_number, pr_state, pr_url, author, head_branch,
                 commit_sha, merged_at, closed_at
github_events    id, installation_id, event_id (GH id, unique — dedupe), type,
                 payload jsonb, processed_at, status
event_outbox     id (bigserial), topic, payload jsonb, created_at, published_at
                 (BRIN on created_at; purge 7d; NOTIFY trigger)
audit_log        id (bigserial), actor_user_id?, actor_api_key_id?, actor_mcp_session_id?,
                 action, object_type, object_id, changes jsonb, ip, created_at
                 (retention 1y default)
import_runs      id, source ('linear'|'github'|'jira'), status, config jsonb,
                 report jsonb, progress, created_by, created_at
```

### Key constraints & indexes

- `issues`: UNIQUE `(team_id, number)`; gapless numbering via `team_counters(team_id, next_number)` row updated in the same tx (`FOR UPDATE`).
- `issues` indexes: `(team_id, status_id)`, `(assignee_id)`, `(cycle_id)`, `(project_id)`, `(parent_id)`, `sort_order DESC`; GIN `search_vector`; trigram on `title`.
- Sub-issue depth ≤ 5: service-enforced (recursive CTE check) — documented app-level constraint.
- `cycles`: UNIQUE `(team_id, number)`; rotation job takes advisory lock — idempotent under double-fire.
- All FKs `ON DELETE RESTRICT` except owned children (comments, reactions, cycle_history, notifications); trash purge deletes via service in dependency order.

## 5.12 Event & Audit Log

- **Domain events** (outbox → LISTEN/NOTIFY → WS + pg-boss jobs): `issue.created/updated/moved/archived/trashed`, `comment.created`, `cycle.started/closed`, `project.updated`, `notification.created`, `import.progress`. Payloads: entity deltas + actor.
- **Audit log** (persistent, owner-viewable): security-relevant actions only — login, invite/member changes, integration/webhook/API-key config, import/export, cycle manual close, issue/team/workspace delete, MCP session start. Actors: user, API key, MCP session. Never contains issue body content (titles only).

---

# 6. API & Integrations

## 6.1 GraphQL API

**Endpoint:** `POST /graphql` — app and public API share it. **Parity rule:** if the web app can do it, it's in the public schema (CI walks app queries against public schema).

### 6.1.1 Conventions

- Cursor pagination (`first/after`, Relay connections, opaque cursors).
- Filtering: Linear-style string filter DSL (§6.1.4) parsed server-side to SQL.
- Ordering: `orderBy: [IssueOrderBy!]` enums.
- Errors typed via extensions: `NOT_FOUND`, `FORBIDDEN`, `VALIDATION`, `CONFLICT`, `RATE_LIMITED`.
- UUIDs everywhere; `identifier` (`ENG-123`) derived convenience field, resolvable as input (`issueByIdentifier`).
- Core mutations (~50): issue CRUD/move/archive/duplicate, bulk ops, comment CRUD, relation/sub-issue/label, team/cycle/project/milestone/view CRUD, subscription toggle, webhook/api-key management, import run.
- Subscriptions (WS): `issueUpdated(issueId?)`, `issueCreated(teamId?)`, `notificationCreated(userId)`, `importProgress(runId)`.
- Introspection enabled; additive-only versioning; `@deprecated` + 6-month notice.

### 6.1.4 Filter DSL

Grammar (subset of Linear's, deliberately compatible where semantics overlap):

```
and | or | comparison
comparison := field op value
op := eq | neq | gt | gte | lt | lte | in | nin | contains | startsWith | endsWith
fields (v1.1): team, status, statusCategory, assignee, creator, priority,
               label, project, cycle, estimate, createdAt, updatedAt, completedAt,
               title (contains), description (contains), identifier,
               parent (null | id), relations (blocks|blockedBy|related|duplicate | empty)
```

Example: `assignee:me and statusCategory:in_progress and priority lt:2 and not label:bug order:priority asc`

- `me` resolves to the authenticated actor; `identifier:ENG-123` fast-path; `priority in:0,1,2`; `not` negation; `order:` prefix clause; `empty` support (`assignee:empty`).
- Parser is a pure function in `packages/graphql` (exhaustively tested); invalid → typed `VALIDATION` error with caret. UI filter chips compile to/from this DSL — chips canonical, DSL interchange.

## 6.2 Authentication (API Keys)

- Personal API keys: `vel_`-prefixed, shown once, argon2id-hashed, scopes `read`/`write`, optional expiry, last-used tracking, revocation. Header: `Authorization: vel_…` or `X-Api-Key`.
- Keys act as their owning user with §3.2.3 permissions — one actor model for humans, scripts, and agents.
- MCP sessions authenticate via the same keys (§6.6).

## 6.3 Rate Limiting

- 1,000 req/min per key default (admin-adjustable), burst 50/s; `X-RateLimit-*` headers; typed `RATE_LIMITED` with retryAfter. Auth endpoints strict per-IP (10/min). No silent throttling — usage visible in settings.

## 6.4 Webhooks

- Owner-registered (§3.2.3); events: `Issue created/updated`, `Issue status changed`, `Comment created`, `Issue assigned`, `Cycle started/closed`, `Project updated`, `Import completed`.
- Delivery: HTTPS POST JSON; `X-Velocity-Signature` (HMAC-SHA256), `X-Velocity-Event`, `X-Velocity-Delivery-Id`; 10s timeout; 1h exp backoff × 5; dead-letter + redeliver UI.
- Payloads ≤ 256KB; security: constant-time compare, SSRF private-CIDR blocklist unless `ALLOW_PRIVATE_WEBHOOK_TARGETS=1`.

## 6.5 GitHub Integration

GitHub App (org or personal-account installs); settings map repos ↔ teams (auto-match team key ↔ repo name, or explicit map). All inbound processing via `github` queue; deduped by GH `event_id`.

### 6.5.1 Linking

- Issue detail GitHub panel lists linked PRs; link by URL or branch.
- Auto-link: commits/PRs containing `ENG-123` (or `Fixes/Closes/Resolves ENG-123` in PR body) via webhook → link + activity + notification. Syntax details §6.8.
- Install backfill: last 90 days of PRs scanned for identifiers (progress-bared, cancellable).

### 6.5.2 Automations (behavior matrix)

| GitHub event | Velocity action |
|---|---|
| PR opened referencing `ENG-123` | Link row; activity entry; notify assignee |
| PR review requested / changes requested | Activity entry + notification |
| PR merged | Mark linked issues Done **if** `auto_close_on_merge` (default ON per mapping; per-issue override) |
| PR closed unmerged | Activity entry only |
| Push w/ `Fixes ENG-123` | Link commit in activity |
| GitHub issue opened (with `velocity` label, if issue-sync on) | Create Velocity issue in target team, default status, back-link comment with `ENG-123` |

### 6.5.3 Security

Signature verification mandatory; installation tokens encrypted at rest (§7.1.3); minimal scopes (issues w, PRs r, metadata r); all GitHub processing via queue; audit-logged config changes.

### 6.5.4 In-app GitHub App setup

An owner can create the GitHub App from the UI instead of setting `GITHUB_*` env vars (Settings → GitHub, `workspace.integrations`, owner-only; `beginGithubAppSetup` requires a session actor).

- **Flow:** the owner picks personal account or an organization name (validated against GitHub's login charset). The server returns the manifest and a target URL (`https://github.com/settings/apps/new` or `https://github.com/organizations/<org>/settings/apps/new`, with `state`); the SPA submits it as a top-level form POST. After the owner approves on GitHub, GitHub redirects to `<APP_URL>/settings/github?code=…&state=…` and the SPA calls `confirmGithubAppSetup`, which verifies `state` and exchanges the one-hour code at `POST https://api.github.com/app-manifests/<code>/conversions`. Nothing is written to the server filesystem.
- **CSRF state:** `<nonce>.<issuedAt>.<hmac>` signed with `APP_SECRET`, 1 h TTL, stateless; an invalid or expired state is rejected and setup must be restarted.
- **Manifest:** name `Velocity` (App names are globally unique on GitHub; the owner may rename it on GitHub's form), private App; webhook `<APP_URL>/api/github/webhook`; callback/redirect `<APP_URL>/settings/github`; setup URL `<APP_URL>/api/github/setup`. Permissions: issues write, pull_requests read, metadata read (§6.5.3). Events: `pull_request`, `pull_request_review`, `push`, `issues`.
- **Storage:** singleton `github_app` row (`id = 1`): app id, slug, name, client id plus `client_secret`, `private_key`, `webhook_secret` encrypted with the AES-256-GCM key derived from `APP_SECRET` (§7.1.3).
- **Precedence:** if a `github_app` row exists it wins over `GITHUB_*` env vars entirely; otherwise env vars are used. `removeGithubApp` deletes the row (existing installs are untouched) and falls back to env, or to "not configured" if env is unset. Resolved credentials are cached in-process and invalidated on save/remove.
- **Audit:** `github.app_configured` and `github.app_removed` (app id and slug only, never secrets).
- **Network requirements:** `APP_URL` must be reachable by github.com for webhook delivery (a localhost `APP_URL` completes setup but receives no events). The SPA CSP allows `form-action 'self' https://github.com` solely so the manifest form can be submitted.
- **APP_SECRET rotation:** stored credentials become undecryptable. `resolvedConfig` catches the decrypt failure, logs a warning (app id only), and falls back to the `GITHUB_*` env config (or "not configured" if unset) instead of failing; `setupStatus` reports `storedAppUnreadable: true`. `removeGithubApp` works on an unreadable row (it deletes without decrypting), so the owner can clear it and re-run setup. Restoring the original `APP_SECRET` also recovers. `storedAppUnreadable` is not yet surfaced through GraphQL/UI.

## 6.6 MCP Server

The distinctive agent surface: MCP server (`apps/mcp`) exposing 12 tools via `@modelcontextprotocol/sdk` — **stdio** (client tarball served by the app, for Claude Desktop) always; **streamable HTTP** (`/mcp`, API-key auth) on by default, `MCP_HTTP_ENABLED=0` opts out.

### 6.6.1 Tool list (v1.1)

| Tool | Input (key params) | Behavior |
|---|---|---|
| `create_issue` | team_key, title, description?, priority?, labels? | Creates in default status |
| `update_issue` | issue_id or identifier, patch fields | Full property patch; typed errors |
| `get_issue` | identifier or id | Detail incl. comments, relations, linked PRs |
| `search_issues` | query, filter_dsl?, limit? | Same engine as UI search (§5.7) |
| `list_issues` | team_key, filter_dsl?, status?, assignee? | Paged 50; DSL support |
| `add_comment` | identifier, body_md | Markdown comment as key's user |
| `manage_labels` | action(add/remove), identifier, label(s) | |
| `set_status` | identifier, status_name | Workflow-aware validation |
| `assign_issue` | identifier, username or `me` | |
| `list_teams` | — | Teams + keys + workflows + statuses (agents need this to create) |
| `list_cycles` | team_key | Active + recent with stats |
| `get_project` / `list_projects` | id? / filter | Project + milestones + progress |

All tools: authenticate via API key → user actor; mutations audit-log `mcp_session_id`; `filter_dsl` shares the §6.1.4 parser exactly; responses include canonical identifiers so agents can reference them in commits/PRs for §6.5 auto-linking.

### 6.6.2 Agent guidance

`docs/agents.md` ships tool semantics, identifier syntax, and etiquette guidance; referenced from MCP `prompts/list`.

## 6.7 Importers

In-app + CLI (`packages/importers`), shared pipelines:

| Source | Input | Mapping |
|---|---|---|
| **Linear** | CSV export, or API-assisted via user's Linear API key (read-only, in-memory, never stored) | Teams→teams, statuses→workflow (category inference), labels, cycles, projects, comments, relations, sub-issues; attachments noted for manual re-upload |
| **GitHub Issues** | GitHub App install or PAT | Repo→team mapping; state→status; labels; comments; assignees by email/username match; milestones→milestones |
| **Jira** | CSV (Cloud/DC wizard) | Project→team; types→labels; statuses→workflow with category map; priority map; sprint→cycle; story points→estimate; comments |

Pipeline: parse (streamed) → mapping preview (unmapped values highlighted + suggested defaults) → dry-run report → commit in 500-row chunks → resumable (`import_runs`) → progress via subscription + webhooks.

## 6.8 Issue Reference Syntax

Canonical everywhere (UI, comments, commits, PR bodies, MCP, webhooks):

```
ENG-123                                  plain reference
[Fixes|Closes|Resolves] ENG-123          close-intent keywords (GitHub flow §6.5.2)
https://{host}/issue/{uuid}              URL (auto-links in comments)
```

Parsing: case-insensitive team-key match against existing keys; `#`-token in editors opens issue-ID autocomplete; ambiguous key matches (multi-workspace GitHub installs can't happen in single-workspace v1.1 — documented simplification) link all matches, close only when unambiguous.

---

# 7. Non-Functional Requirements

## 7.1 Security

### 7.1.1 Threat model summary

A self-hosted, often internet-exposed personal tool: OWASP Top 10, plus the agent surface (long-lived API keys, prompt-injectable agents), plus malicious attachments. Assumes hostile inbound webhooks, leaked keys, hostile uploads.

### 7.1.2 Auth & session security

- Sessions: 128-bit tokens, hashed, httpOnly/SameSite=Lax/Secure cookies; rotation on privilege change; CSRF double-submit on cookie-authed mutations; revoke-all UI.
- Passwords argon2id; login rate-limit per IP+account (progressive delay).
- API keys: argon2id-hashed; prefix display form; scope checks before resolvers run; last-used tracking.

### 7.1.3 Data protection

- Column-level AES-256-GCM (app key) for: GitHub installation tokens, webhook secrets (needed for HMAC verify — encrypted not hashed).
- TLS at Caddy (auto-HTTP-01), HSTS. Secrets env-only; never in DB plaintext, never in logs (scrubber middleware).
- Attachments: mime allowlist, size cap, EXIF strip on image processing, optional ClamAV container (profile) — documented limitation when disabled.

### 7.1.4 Input handling & permissions

- Every resolver gets an authenticated actor; `services` enforce §3.2.3 at method entry — GraphQL field checks are defense-in-depth.
- No workspace scoping needed (single workspace, §5.1 ADR 4) — permission surface is just owner-vs-member, enforced centrally. Scoping-test lint pattern still mandatory on list methods (defense in depth for future multi-workspace).
- Rich text: server-side sanitize (CommonMark allowlist; HTML stripped; no `javascript:` URLs); DOMPurify on render; strict CSP: `default-src 'self'`, nonce'd editor styles, no inline scripts.
- Webhooks: SSRF private-CIDR blocklist (§6.4).
- GraphQL: depth limit 10, complexity budget, persisted documents for app queries, introspection on (public API promise).
- Rate limiting §6.3; audit log §5.12.

### 7.1.5 Supply chain

- pnpm lockfile pinned; Renovate weekly; `pnpm audit` blocks CI on high.
- Images: multi-stage, non-root (uid 10001), read-only rootfs, dropped caps; SBOM (syft) + cosign signatures per release.

### 7.1.6 Agent-facing hardening

- All MCP/API mutations audit-logged with actor attribution — abuse traces to a credential.
- Per-key mutations-per-hour histogram in settings (from audit log) for runaway-agent detection.
- MCP HTTP transport requires explicit enablement + dedicated token; stdio-only by default.
- Tool inputs zod-validated before services; DSL parser → AST → parameterized Drizzle conditions (no string interpolation into SQL, ever).

## 7.2 Privacy & Data Ownership

- Zero telemetry default; no third-party JS/fonts (Atlassian Sans + icons self-hosted).
- Full export: versioned JSON (issues, comments, teams, workflows, cycles, projects, labels, members; attachment manifest) — owner-triggered, background-generated, audit-logged.
- Per-user export + account deletion (issues re-attributed to "Former member" stub).
- Logs PII-scrubbed; retention: audit 1y (configurable), webhooks 30d, outbox 7d.

## 7.3 Testing Strategy

| Layer | Tool | Coverage | CI gate |
|---|---|---|---|
| Unit (pure) | vitest | Filter DSL parser (exhaustive), permission truth table (§3.2.3), cycle math (rotation, DST), fractional ordering, identifier parsing | 100% pass; coverage ≥ 90% on schema/services/graphql |
| Service (DB) | vitest + testcontainers (Postgres) | Every service method: happy + permission-denied + concurrency (numbering under parallel create; rotation double-fire) | 100% pass |
| GraphQL | vitest | Schema parity walk (app queries ⊆ public schema), pagination/filter/orderBy combos, rate limits | 100% pass |
| Webhooks/GitHub | vitest + recorded fixtures | Signature verify, dedupe, full §6.5.2 matrix | 100% pass |
| MCP | vitest | All 12 tools end-to-end (happy + denied + malformed DSL) | 100% pass |
| E2E | Playwright (Chromium+WebKit) | First-run wizard; create team → issue → keyboard loop; bulk ops; cycle rotate; GitHub link via mock; import 1k CSV; theme switch; layout conformance (§4.10.4) | Green; axe zero critical |
| Perf | k6 (compose env) | Issues query p95 < 150ms @ 10k issues; 25 concurrent users; mutation storm | §4.16 budgets |
| Visual | Playwright screenshots | Every §4.9 component + shell geometry (§4.10.4) in both themes, 3 viewports | No unapproved diff |
| A11y | axe + quarterly manual NVDA/VoiceOver | §4.15 | Zero critical |

Determinism: per-test schema or transactional rollback; seeded fixtures; E2E compose-based, no external net.

## 7.4 Observability

- Logs: structured JSON (pino), request-id propagation, scrubber. stdout → operator's collector; sample Loki config provided.
- Metrics: Prometheus `/metrics` on app: HTTP histogram, resolver durations (top-20), queue depth/failures, WS connections, outbox lag. Grafana dashboard JSON shipped.
- Tracing: OpenTelemetry optional (off by default — zero-phone-home).
- Health: `/healthz`, `/readyz` (DB + storage checks); compose healthchecks gate.
- SLO guidance: 99.5% availability; outbox lag < 5s p99; webhook delivery < 60s p95.

## 7.5 Internationalization

- Typed message catalog (`en` default; community-sourced `fr/es/de/ja`); no hard-coded strings (lint); `Intl` date/number; per-user locale.
- Timestamps UTC, display per-user tz; cycle rotation per-team tz with DST fixtures; relative time localized.
- RTL out of scope v1.1 (structural readiness via logical CSS properties only).

## 7.6 Compatibility & Support Matrix

| Target | Version |
|---|---|
| Browsers | Chrome/Edge ≥ 120, Firefox ≥ 120, Safari ≥ 17 (ES2022, WS) |
| Node | 22 LTS (images pinned) |
| PostgreSQL | 16 (FTS + pg_trgm required) |
| Docker Engine / Compose | ≥ 25 / v2.24 |
| MCP clients | Claude Desktop, Cursor, any MCP-compliant client (protocol 2025-06 rev) |
| GitHub | GitHub.com Apps (GHES adapter post-MVP; seams in `github_events`) |

---

# 8. Delivery Plan

## 8.1 Milestones

Five milestones (~50% of the v1.0 effort estimate). Solo-first scope shows up as smaller M1/M4.

### M1 — Foundation (3–4 weeks)
Monorepo scaffold, CI (lint/type/test/docker), `packages/schema` (§5.11), auth (install-time owner wizard, sessions, invite-link members, API keys), §3.2.3 permission service, ADS tokens package + theme switcher + sign-in + first-run wizard screens (dark default), compose 3-container deployment, LISTEN/NOTIFY outbox skeleton.
**Exit:** fresh clone → `docker compose up` → wizard → create workspace → invite link works for second user.

### M2 — Issues core (4–5 weeks)
Teams (keys, sidebar), workflows + default statuses, issue CRUD (numbering, rich description, attachments local-disk), labels, Linear-parity shell (§4.10 geometry + conformance tests), list/board team views, issue detail panel, sub-issues, relations, bulk ops, move/archive/trash, My Issues + presets, FTS search, keyboard engine + palette v1, optimistic updates + WS realtime.
**Exit:** keyboard-only Linear-parity core loop (create → navigate → edit → close) in demo; 10k-issue seed passes perf budgets; §4.10.4 layout tests green.

### M3 — Planning layer (3–4 weeks)
Cycles (settings, rotation job, cycle views, velocity snapshot, scope tracking), Projects (CRUD, milestones, progress, health, tabs), Views (filter chips + DSL compiler shared with API, saved views, display options, URL state), home insights cards (created-vs-completed, velocity).
**Exit:** cycles rotate with carryover; views deep-linkable; charts accurate vs seed fixtures.

### M4 — Integrations (4–5 weeks)
Public GraphQL parity walk + rate limits + API key scopes, webhooks (HMAC + retries + UI), GitHub App (install flow, linking, §6.5.2 matrix, backfill, issue-sync), MCP server (12 tools stdio + optional HTTP, docs/agents.md), `@velocity/sdk`.
**Exit:** Claude Desktop creates/comments/closes via MCP; `Fixes ENG-123` PR merge closes issue; webhook consumer receives signed events.

### M5 — Import & polish → v1.0 (2–3 weeks)
Importers (Linear CSV + API-assisted, GitHub Issues, Jira) with preview/resume, i18n extraction (`en`), a11y sweep (axe zero critical + manual), visual regression both themes + layout conformance, k6 perf pass, docs (self-hosting, API, agents, import, contributing w/ ADS rules), security review, release pipeline (signed images, SBOM).
**Exit:** §8.2 definition of done → tag v1.0.0.

## 8.2 Definition of Done — v1.0

- [ ] All v1.1 scope (§2.1) shipped with §7.3 gates green
- [ ] `docker compose up` on clean Ubuntu 24.04 works first boot (3 containers); upgrade path tested (N-1)
- [ ] First-run wizard → first issue in < 2 minutes, solo, no email required
- [ ] Public GraphQL schema serves 100% of web app queries (parity walk)
- [ ] MCP: 12 tools work from Claude Desktop and Cursor against compose deployment
- [ ] GitHub App installable; §6.5.2 matrix verified with recorded fixtures
- [ ] Keyboard-only completion of: create issue, bulk relabel, cycle rotate check, view create/share (recorded demo)
- [ ] Layout conformance (§4.10.4): shell geometry tests + visual snapshots approved, both themes
- [ ] Perf budgets (§4.16) green @ 10k issues / 25 simulated users
- [ ] ADS compliance: zero hard-coded hex outside `packages/tokens` (lint)
- [ ] Security: dep audit clean, review findings resolved, secrets scan clean
- [ ] Import 1k-issue Linear CSV resumable with accurate dry-run report
- [ ] Legal: license headers, NOTICE file, no Linear-derived code/assets confirmed
- [ ] Docs complete (self-hosting, API, agents, import, contributing)

## 8.3 Post-MVP Roadmap Detail

| Wave | Contents |
|---|---|
| **v1.2 Integrations** | SMTP email notifications + digests, Slack, Sentry, GitLab, Figma links |
| **v1.3 Growth** | Multi-workspace tenancy, guest accounts, role separation, triage inbox, SAML/OIDC, S3 storage driver GA |
| **v1.4 Planning** | Initiatives, roadmap, documents (CRDT spike), releases |
| **Research** | Local-first offline client (revisit optimistic model with usage data), GHES adapter, Kubernetes/Helm, mobile PWA |

## 8.4 Risks & Mitigations

| Risk | L | Impact | Mitigation |
|---|---|---|---|
| "Velocity" name collision | M | Rebrand cost | §1.6 rename-safe; decide name before v1.0 marketing |
| ADS dark-token drift from published values | M | Visual inconsistency | Tokens generated from atlassian.design at implementation; `tokens` package is generated, not hand-typed |
| LISTEN/NOTIFY realtime gaps (missed notifies on reconnect) | M | Stale UI | Client refetches active queries on WS reconnect (§5.5) — worst case is stale-until-reconnect, never corrupt |
| Linear layout imitation drifts toward asset copying under contributor pressure | M | Legal exposure | §1.5 rule 4 + review checklist; written geometry spec is the only sanctioned reference; no Linear screenshots in repo |
| GitHub App listing delays launch | H | M4 slips | Submit listing at M3 end; dev-App testing meanwhile |
| Filter DSL divergence from Linear semantics | L | Script friction | Exhaustive parser tests vs documented examples; identifier fast-path |
| Cycle rotation DST/timezone bugs | M | Wrong stats | DST fixture matrix; idempotency locks; immutable close snapshots |
| Gapless numbering contention | L | Failed creates | `FOR UPDATE` counter; benchmark 200-parallel-create in CI |
| Solo-first scope creep back toward "small Jira" | H | Never ships | §2.1 locked; every PR references spec section; v1.3 wave is the pressure valve |
| MCP spec churn | M | Agent breakage | SDK pinned + compat matrix per release; tools are thin GraphQL wrappers |
| Maintainer burnout / bus factor | M | Project death | Contributor infra early (M1); AGPL enables community forks as continuity |

---

**End of specification.** Implementation begins at §5.3 (scaffold) and §4.2 (tokens from published ADS values). This document is the source of truth; changes require a spec-version bump and changelog entry.

