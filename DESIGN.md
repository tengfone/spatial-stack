---
name: Spatial Stack
description: Automated 2D-to-3D spatial visualization for government planners and facilities managers
colors:
  steel-blue: "oklch(0.45 0.08 250)"
  steel-blue-deep: "oklch(0.38 0.08 250)"
  slate-ink: "oklch(0.22 0.012 250)"
  slate-dark: "oklch(0.28 0.012 250)"
  cool-wash: "oklch(0.965 0.006 250)"
  parchment: "oklch(0.985 0.004 250)"
  ash-light: "oklch(0.93 0.008 250)"
  ash-mist: "oklch(0.94 0.006 250)"
  fieldstone: "oklch(0.55 0.015 250)"
  wire: "oklch(0.88 0.008 250)"
  alert-red: "oklch(0.50 0.16 25)"
  alert-red-deep: "oklch(0.44 0.16 25)"
  status-green: "oklch(0.62 0.14 145)"
  status-amber: "oklch(0.70 0.12 55)"
typography:
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.011em"
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.011em"
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.08em"
  mono:
    fontFamily: "SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.2
rounded:
  sm: "2px"
  md: "4px"
  lg: "6px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.steel-blue}"
    textColor: "{colors.parchment}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.steel-blue-deep}"
  button-secondary:
    backgroundColor: "{colors.ash-light}"
    textColor: "{colors.slate-dark}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
  button-outline:
    backgroundColor: "{colors.parchment}"
    textColor: "{colors.slate-ink}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.slate-ink}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
  badge-default:
    backgroundColor: "{colors.steel-blue}"
    textColor: "{colors.parchment}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
  badge-secondary:
    backgroundColor: "{colors.ash-light}"
    textColor: "{colors.slate-dark}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
  progress-track:
    backgroundColor: "{colors.ash-mist}"
    rounded: "{rounded.sm}"
    height: "8px"
  progress-fill:
    backgroundColor: "{colors.steel-blue}"
    rounded: "{rounded.sm}"
    height: "8px"
---

# Design System: Spatial Stack

## 1. Overview

**Creative North Star: "The Survey Instrument"**

Spatial Stack is a precision measurement tool for spatial decision-making. Every element exists because it serves the reading. The interface is calibrated, not decorated; trustworthy, not impressive. A city planner reviewing development proposals at 9am under fluorescent lighting should feel the same quiet confidence they feel picking up a well-made theodolite: the tool disappears into the task.

The system rejects consumer-grade home design aesthetics (too playful, too decorative), dark-mode developer tool conventions (wrong audience, wrong ambient light), generic SaaS dashboard patterns (card-heavy layouts, casual tone), and overly decorated government portals (bureaucratic friction). It draws instead from the precision of surveying instruments, the clarity of cartographic standards, and the density of professional CAD review environments.

Color is restrained: cool slate-tinted neutrals with a single steel-blue accent used only for primary actions and state indicators. The 3D viewer dominates the viewport. Supporting UI compresses to toolbars, side panels, and inline controls. Typography is tight, monospaced where data demands it, and never decorative.

**Key Characteristics:**
- Viewer-first layout: the 3D spatial model owns the viewport
- Restrained color: one accent at less than 10% surface coverage
- Dense, scannable data panels for professionals processing many plans
- Light theme tuned for office environments and extended use
- Flat by default; shadows appear only as state feedback
- WCAG 2.1 AA minimum throughout

## 2. Colors: The Steel Palette

A restrained, cool-tinted neutral system anchored by a single steel-blue accent. Every neutral carries a subtle hue 250 tint so nothing reads as dead gray. Chroma is reduced as lightness approaches extremes.

### Primary
- **Steel Blue** (oklch(0.45 0.08 250)): Primary actions, active nav states, focus rings, accent indicators. The only saturated color on most screens.
- **Steel Blue Deep** (oklch(0.38 0.08 250)): Hover state for primary buttons. Darkened without shifting hue.

### Neutral
- **Slate Ink** (oklch(0.22 0.012 250)): Primary text, headings. Near-black with a cool tint.
- **Slate Dark** (oklch(0.28 0.012 250)): Secondary text in high-density contexts.
- **Fieldstone** (oklch(0.55 0.015 250)): Muted foreground: labels, secondary text, placeholder content.
- **Wire** (oklch(0.88 0.008 250)): Borders, dividers, input outlines.
- **Ash Mist** (oklch(0.94 0.006 250)): Muted backgrounds, progress track fills.
- **Ash Light** (oklch(0.93 0.008 250)): Secondary button fills, hover backgrounds, nav active state.
- **Cool Wash** (oklch(0.965 0.006 250)): Page background. The base surface everything sits on.
- **Parchment** (oklch(0.985 0.004 250)): Surface/card background. Panels, toolbars, elevated content.

### Semantic
- **Alert Red** (oklch(0.50 0.16 25)): Destructive actions, error states.
- **Alert Red Deep** (oklch(0.44 0.16 25)): Hover on destructive buttons.
- **Status Green** (oklch(0.62 0.14 145)): Connected/healthy indicators.
- **Status Amber** (oklch(0.70 0.12 55)): Warning/pending indicators.

### Named Rules
**The One Accent Rule.** Steel Blue is the only chromatic accent on standard product surfaces. Its presence marks actionable or active elements. If Steel Blue appears on more than 10% of a screen, something is over-decorated. Semantic colors (red, green, amber) are state-only and do not count toward accent coverage.

## 3. Typography

**Body Font:** Inter (with -apple-system, BlinkMacSystemFont, Segoe UI, system-ui fallbacks)
**Mono Font:** SFMono-Regular (with Menlo, Consolas fallbacks)

**Character:** A single technical sans-serif family tuned for density and readability at small sizes. Inter's tabular figures and tight metrics make it right for data-heavy panels. No display font; hierarchy comes from weight and size contrast alone.

### Hierarchy
- **Title** (600, 0.875rem/14px, line-height 1.4): Section headings, panel titles, analysis names. The largest text in standard product views.
- **Body** (400, 0.75rem/12px, line-height 1.5): Descriptions, notes, supporting copy. Tight but legible at office viewing distance.
- **Label** (600, 0.6875rem/11px, letter-spacing 0.08em, uppercase): Section labels, metric headers, status indicators. Uppercase tracking creates clear visual separation from body text.
- **Mono** (600, 0.6875rem/11px, line-height 1.2): Numeric values, percentages, tabular data. SFMono for precise alignment in data columns.

### Named Rules
**The Tight Scale Rule.** The ratio between adjacent type steps is 1.17 (14/12). Product UI with many label types requires a compressed scale; wider ratios create visual noise. Never exceed 1.25 between adjacent steps.

**The Negative Tracking Rule.** Body text carries -0.011em letter-spacing globally. Inter at small sizes benefits from slight tightening. Labels are the exception: they use positive tracking (0.08em) because uppercase text at 11px needs air.

## 4. Elevation

Flat by default. Surfaces are distinguished by tonal shifts (Cool Wash for page, Parchment for panels) and 1px borders in Wire, not by shadows. Depth is structural, not decorative.

### Shadow Vocabulary
- **Panel** (`0 1px 3px oklch(0.22 0.01 250 / 0.06), 0 1px 2px oklch(0.22 0.01 250 / 0.04)`): The only shadow in the system. Used on floating toolbar controls inside the viewer surface. Barely perceptible; its purpose is to separate interactive overlays from the spatial model beneath them.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. The panel shadow is reserved for floating overlays inside the viewer. If you are reaching for a shadow on a page-level element, use a border or tonal shift instead. Shadows on cards, sections, or metric panels are prohibited.

## 5. Components

Components are calibrated and restrained. Tight tolerances, no decoration beyond function. Every interactive element has default, hover, focus, and disabled states.

### Buttons
- **Shape:** Gently rounded (4px radius)
- **Primary:** Steel Blue background, Parchment text, 40px height, 12px horizontal padding, 14px semibold text. The only button with chromatic fill.
- **Hover:** Steel Blue Deep background. No motion, no scale change.
- **Focus:** 2px ring in Steel Blue, offset from the element.
- **Secondary:** Ash Light fill, Slate Dark text. For toggled-on states (e.g., furniture toggle in viewer).
- **Outline:** Parchment fill, 1px Wire border, Slate Ink text. For neutral secondary actions.
- **Ghost:** Transparent fill, Slate Ink text, Ash Light fill on hover. For toolbar controls.
- **Disabled:** 55% opacity, no pointer events.
- **Small variant:** 36px height, 12px padding. Used in toolbar contexts where buttons must not dominate.

### Badges
- **Shape:** Rounded (4px radius), monospace font, 10.88px semibold uppercase with 0.12em tracking.
- **Default:** Steel Blue fill, Parchment text. For status labels (e.g., "OpenRouter").
- **Secondary:** Wire border, Ash Light fill, Slate Dark text. For classification tags.
- **Warning:** Amber-tinted border and fill. For degraded-state indicators.

### Analysis Status Language
- **Pending / Processing:** Use Status Amber and direct labels while analysis is queued or polling. Avoid spinner-only states; users need to know the backend worker is still running.
- **OpenRouter / Validated:** Use the standard Steel Blue badge for successful backend-owned model processing. Pair it with precise detail copy such as "Pydantic + sanity checks passed" when space allows.
- **Provider retry:** If the backend retries the same configured model with a provider-compatible response format, keep the state as processing unless the final contract fails. Do not present this as a second model or a degraded visual mode.
- **Failed:** Use Alert Red and clear error copy. Never imply that the interface produced a substitute layout when the configured OpenRouter model could not produce a trustworthy contract.
- **Recent Plans:** Treat the saved-plan queue as operational status, not marketing content. Ready records use direct "OPEN" actions; pending or processing records use direct wait/status language.

### Progress Bars
- **Track:** Ash Mist fill, 8px tall, slightly rounded (2px).
- **Fill:** Steel Blue, same radius. Width is percentage-driven with CSS transition.
- **Context:** Used in analysis summary for furniture fit and sightline scores, and in loading overlays for backend analysis progress. Always paired with a label and a mono percentage value when space allows.

### Navigation
- **Top bar:** 48px height, Parchment background, 1px Wire bottom border. Logo + nav items left-aligned.
- **Nav items:** 12px medium text, Fieldstone color at rest, Ash Light fill + Slate Ink text when active. 4px radius, 10px horizontal / 6px vertical padding.
- **Hover:** Ash Light fill, text shifts to Slate Ink. 150ms color transition.
- **Active indicator:** Background fill only. No underlines, no accent color on nav.

### Viewer Surface
- **Background:** oklch(0.96 0.005 250), a barely-tinted canvas. No grid pattern, no texture.
- **Interaction:** Grab cursor at rest, grabbing on drag. Pointer capture for rotation.
- **Floating controls:** Bottom-left overlay with Panel shadow. Contains toggle buttons (ghost/secondary variants) and a rotation readout in 11px mono.
- **Source overlay:** Lives in Top view as an inspection layer, not decoration. The submitted plan image appears under extracted geometry at controlled opacity so reviewers can compare source evidence against spaces, walls, and labels.

### Analysis Panel
- **Width:** 340px fixed, right-aligned. Parchment background, 1px Wire left border.
- **Sections:** Separated by 1px Wire horizontal borders, not by cards or shadows.
- **Metric grid:** 2x2 grid using 1px gap-trick (Wire background, Parchment cells). Label in 11px Fieldstone, value in 14px semibold tabular-nums.
- **Room list:** Dense rows separated by 1px borders. Room name (12px medium) + type label (11px Fieldstone) left, area + confidence (11px mono) right.

## 6. Do's and Don'ts

### Do:
- **Do** use Steel Blue exclusively for interactive or active elements. If it's not clickable or currently selected, it should not be Steel Blue.
- **Do** separate data sections with 1px Wire borders. Borders are the primary spatial divider.
- **Do** use tabular-nums (font-variant-numeric: tabular-nums) on all numeric data so columns align.
- **Do** compress UI chrome to toolbars and side panels. The viewer is the product.
- **Do** test every text/background combination against WCAG 2.1 AA (4.5:1 for body, 3:1 for large text).
- **Do** use uppercase + tracking (0.08em) for section labels to visually separate them from content.

### Don't:
- **Don't** use shadows on page-level elements. Shadows are reserved for floating overlays inside the viewer. Use borders and tonal shifts everywhere else.
- **Don't** wrap sections in cards. The old design's card-heavy layout is an explicit anti-reference. Use border-separated sections within panels.
- **Don't** use a sidebar navigation. Two nav items do not justify 264px of permanent sidebar. The top bar is the only navigation pattern.
- **Don't** use grid-pattern or textured backgrounds. The viewer surface is a flat tinted canvas. Decorative backgrounds compete with the 3D model.
- **Don't** use dark mode. These users work in fluorescent-lit offices on desktop monitors. A dark theme would reduce legibility in their actual environment.
- **Don't** use consumer-grade home design aesthetics: bright accent palettes, playful illustrations, rounded-everything, decorative gradients.
- **Don't** use overly decorated government portal patterns: busy headers, seal imagery, dropdown-heavy navigation trees, outdated form layouts.
- **Don't** use hero-metric cards (big number, small label, icon, card wrapper). Display metrics inline in dense grids or labeled rows.
- **Don't** use border-left or border-right greater than 1px as a colored accent stripe on any element.
- **Don't** use gradient text, glassmorphism, or bounce/elastic easing.
