-- One daily results post per Discord webhook per puzzle day (makes the scheduled job idempotent).
CREATE TABLE discord_posts (
  webhook_id  TEXT NOT NULL,
  day         INTEGER NOT NULL,
  server_id   TEXT NOT NULL,
  posted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (webhook_id, day)
);
