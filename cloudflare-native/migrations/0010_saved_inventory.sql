-- A missing row means older firmware has never reported its saved directory
-- stations. An empty JSON array is an authoritative, reported empty list.
CREATE TABLE IF NOT EXISTS radio_station_inventory (
  radio_id TEXT PRIMARY KEY REFERENCES radios(id),
  station_codes_json TEXT NOT NULL
    CHECK(length(station_codes_json) <= 1000 AND json_valid(station_codes_json)
      AND json_type(station_codes_json) = 'array' AND json_array_length(station_codes_json) <= 100),
  reported_at INTEGER NOT NULL CHECK(reported_at >= 0)
);
