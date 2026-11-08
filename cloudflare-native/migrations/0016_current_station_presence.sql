-- A legacy radio may report its software version without the newer station field.
-- Distinguish that omission from an explicit report that no station is selected.
ALTER TABLE radio_telemetry ADD COLUMN current_station_reported INTEGER NOT NULL DEFAULT 0 CHECK(current_station_reported IN (0,1));
