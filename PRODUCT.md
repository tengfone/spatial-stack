# Product

## Register

product

## Users

Government professionals and institutional decision-makers who evaluate buildings and spaces at scale:

- **City Planners** reviewing development proposals against zoning and spatial requirements. Working in municipal offices on desktop monitors, often comparing 3D output against original PDF submissions.
- **Facilities Managers** planning large-scale renovations across building portfolios. Need to verify furniture fit, flow, and spatial efficiency before committing budgets.
- **Housing Authorities** showing residents apartment layouts before construction begins. Need clear, trustworthy visualizations that non-technical audiences can also understand.

All users work on desktop monitors in office environments. They process many floor plans per day and need the tool to be fast, reliable, and unambiguous.

## Product Purpose

Automate 2D-to-3D spatial visualization so organizations managing thousands of buildings can generate interactive 3D models without specialized CAD software or trained operators. Success: a planner uploads a floor plan, sees clear analysis progress while the backend works, and gets a reusable 3D model without a specialist handoff.

## Reliability Contract

Spatial Stack is model-assisted review, not autonomous approval. The backend posts directly to OpenRouter with strict JSON Schema structured output, runs Gemini 3 Flash Preview by default, validates the response with Pydantic, makes linked space polygons authoritative for matching room bounds, and applies spatial sanity checks for missing rooms, missing dimensions, severe overlap when room rectangles are the only geometry, out-of-room furniture, low confidence, and incomplete extracted geometry.

The product should describe this as a single configured model path, not fake demo continuity. If the model attempt fails, the user should see a clear failure state. If analysis takes longer than a normal request window, the user should see a pending or processing plan state while the frontend polls the saved plan record. Locally that shared state is in memory; in AWS it is DynamoDB-backed.

## Brand Personality

Authoritative, precise, efficient. The tool should feel like a professional instrument you trust with real decisions. Not playful, not startup-casual, not a tech demo.

## Anti-references

- The current frontend (generic SaaS dashboard aesthetic, card-heavy layout, casual tone)
- Consumer-grade home design apps (too playful, too decorative)
- Dark-mode developer tools (wrong audience, wrong environment)
- Overly decorated government portals (bureaucratic friction, outdated patterns)

## Design Principles

- **Viewer first.** The 3D visualization is the product's core value. Everything else supports it.
- **Institutional confidence.** Every element should reinforce that this is a reliable professional tool, not a prototype.
- **Density without clutter.** These users process many plans. Show relevant data efficiently without wasting space or hiding information.
- **Immediate legibility.** Labels, metrics, and spatial data must be scannable at a glance under office lighting conditions.

## Accessibility & Inclusion

WCAG 2.1 AA minimum. High contrast for extended use under fluorescent lighting. Keyboard-navigable. No motion-dependent interactions.
