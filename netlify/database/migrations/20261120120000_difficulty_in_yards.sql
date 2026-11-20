-- Difficulty tuning now works on the median distance of players' pins (yards) rather than on
-- scores, so it doesn't depend on how points are awarded. Medians are recomputed in full by the
-- next weekly run; tiers already moved (tier <> default_tier) are kept until then.
DELETE FROM place_difficulty WHERE tier = default_tier;
ALTER TABLE place_difficulty DROP CONSTRAINT IF EXISTS place_difficulty_median_score_check;
ALTER TABLE place_difficulty RENAME COLUMN median_score TO median_yards;
ALTER TABLE place_difficulty ADD CONSTRAINT place_difficulty_median_yards_check CHECK (median_yards >= 0);
