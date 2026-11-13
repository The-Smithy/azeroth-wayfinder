-- How hard each place turns out to be for real players, recomputed weekly from ranked,
-- hint-free guesses (server/difficulty.ts), and the tier it is dealt in from then on.
-- Puzzles already frozen in `puzzles` never change; only days not yet generated use this.
CREATE TABLE place_difficulty (
  place_id      TEXT PRIMARY KEY,
  plays         INTEGER NOT NULL CHECK (plays >= 0),
  median_score  REAL NOT NULL CHECK (median_score BETWEEN 0 AND 100),
  -- The tier the place's kind puts it in, and the tier it is actually dealt in.
  default_tier  TEXT NOT NULL CHECK (default_tier IN ('realm', 'hub', 'outpost', 'legend')),
  tier          TEXT NOT NULL CHECK (tier IN ('realm', 'hub', 'outpost', 'legend')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
