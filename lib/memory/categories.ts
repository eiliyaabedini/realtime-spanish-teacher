// Dependency-free so both the DB schema (server) and realtime tool specs
// (client bundle) can import it without dragging drizzle into the browser.
export const MEMORY_CATEGORIES = ["grammar", "vocab", "pronunciation", "pace", "style"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
