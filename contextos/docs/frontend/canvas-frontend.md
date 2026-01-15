# Canvas Frontend Stack & Product Shape

## Recommended stack (aligned with the monorepo)

- **Framework**: Next.js (React + TypeScript) for routing, API proxying, and deployment ergonomics.
- **Graph/Canvas**: React Flow for node/edge interactions (drag, zoom, grouping, minimap).
- **State**: Zustand for lightweight canvas/UI state.
- **Data fetching**: TanStack Query for caching bundle/artifact reads.
- **UI**: Tailwind CSS + shadcn/ui for rapid, cohesive layout and controls.
- **Contract validation**: Zod to validate `CanvasBundle` payloads and schema versions on the client.

## What the product looks like in PR7B

The UI behaves like a **Cognitive Canvas workspace** that is read-only but operational:

- **Canvas area**: renders `CanvasBundle` nodes (View, Plan, Diff, Drift) and edges (influence/compare/derive).
- **Right inspector panel**: shows structured fields for the selected node (plan token buckets, drift signals, diff changes).
- **Left experiment sidebar**: lists experiments and filters (time, view combinations, planner variants).
- **Top command bar**: triggers experiment actions (run, export bundle, open artifacts) without writeback.

This gives a product-like experience immediately while preserving experiment isolation boundaries.
