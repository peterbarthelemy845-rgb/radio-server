-- Owner-supplied five-digit ZIPs remain text, including any leading zeros.
-- Existing records are left blank; no location or language inference occurs.
ALTER TABLE stations ADD COLUMN zip_code TEXT NOT NULL DEFAULT '' CHECK(zip_code='' OR (length(zip_code)=5 AND length(CAST(zip_code AS BLOB))=5 AND zip_code NOT GLOB '*[^0-9]*'));
ALTER TABLE station_edits ADD COLUMN zip_code TEXT NOT NULL DEFAULT '' CHECK(zip_code='' OR (length(zip_code)=5 AND length(CAST(zip_code AS BLOB))=5 AND zip_code NOT GLOB '*[^0-9]*'));
CREATE INDEX stations_zip_directory ON stations(status,zip_code,code);
CREATE INDEX stations_zip_category_directory ON stations(status,zip_code,category,code);
