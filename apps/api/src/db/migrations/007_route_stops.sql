ALTER TABLE routes ADD COLUMN stops jsonb NOT NULL DEFAULT '{"pickup":[],"dropoff":[]}'::jsonb;
