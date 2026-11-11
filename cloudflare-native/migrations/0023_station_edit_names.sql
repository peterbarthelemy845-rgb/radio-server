-- A proposed name is reviewed with the other proposed fields. Existing
-- proposals keep their approved name until their owner changes it.
ALTER TABLE station_edits ADD COLUMN name TEXT NOT NULL DEFAULT '';
UPDATE station_edits SET name=(SELECT name FROM stations WHERE code=station_edits.station_code);
