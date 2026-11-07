-- Azeroth Pinpoint: players, sessions, Discord servers, daily puzzles and scored rounds.

-- A player is either a guest (discord_id IS NULL) or a Discord account.
CREATE TABLE players (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id    TEXT UNIQUE,
  name          TEXT NOT NULL,
  avatar_url    TEXT,
  -- Show on the global board. Discord-server boards always include members.
  is_public     BOOLEAN NOT NULL DEFAULT TRUE,
  banned        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX players_guest_last_seen ON players (last_seen_at) WHERE discord_id IS NULL;

-- Opaque session tokens live only in an httpOnly cookie; we store their SHA-256.
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  player_id   UUID NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_player ON sessions (player_id);
CREATE INDEX sessions_expiry ON sessions (expires_at);

-- Discord servers ("guilds") a signed-in player belongs to, refreshed at each login.
CREATE TABLE discord_servers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  icon        TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE player_servers (
  player_id  UUID NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  server_id  TEXT NOT NULL REFERENCES discord_servers (id) ON DELETE CASCADE,
  PRIMARY KEY (player_id, server_id)
);
CREATE INDEX player_servers_server ON player_servers (server_id);

-- The five places of each daily puzzle, frozen the first time the day is requested.
CREATE TABLE puzzles (
  day         INTEGER PRIMARY KEY,
  place_ids   TEXT[] NOT NULL CHECK (cardinality(place_ids) = 5),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One attempt per player per day.
CREATE TABLE games (
  player_id     UUID NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  day           INTEGER NOT NULL REFERENCES puzzles (day),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  total_points  INTEGER NOT NULL DEFAULT 0,
  total_ms      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, day)
);
CREATE INDEX games_board ON games (day, total_points DESC, total_ms ASC) WHERE finished_at IS NOT NULL;

-- Each clue is dealt (shown_at) before it can be guessed; the server scores the guess.
CREATE TABLE rounds (
  player_id   UUID NOT NULL,
  day         INTEGER NOT NULL,
  idx         SMALLINT NOT NULL CHECK (idx BETWEEN 0 AND 4),
  shown_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  hint_at     TIMESTAMPTZ,
  guessed_at  TIMESTAMPTZ,
  guess_lat   DOUBLE PRECISION,
  guess_lng   DOUBLE PRECISION,
  yards       INTEGER,
  score       SMALLINT CHECK (score BETWEEN 0 AND 100),
  points      SMALLINT CHECK (points BETWEEN 0 AND 300),
  ms          INTEGER,
  PRIMARY KEY (player_id, day, idx),
  FOREIGN KEY (player_id, day) REFERENCES games (player_id, day) ON DELETE CASCADE ON UPDATE CASCADE
);
