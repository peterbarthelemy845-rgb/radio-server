-- Existing stations remain unclassified until their owner chooses metadata.
ALTER TABLE stations ADD COLUMN language TEXT NOT NULL DEFAULT '' CHECK(language IN ('','en','ht','fr','es','pt','other'));
ALTER TABLE stations ADD COLUMN category TEXT NOT NULL DEFAULT '' CHECK(category IN ('','christian','news_talk','music','culture','other'));
ALTER TABLE station_edits ADD COLUMN language TEXT NOT NULL DEFAULT '' CHECK(language IN ('','en','ht','fr','es','pt','other'));
ALTER TABLE station_edits ADD COLUMN category TEXT NOT NULL DEFAULT '' CHECK(category IN ('','christian','news_talk','music','culture','other'));
CREATE INDEX stations_language_directory ON stations(status,language,code);
CREATE INDEX stations_category_directory ON stations(status,category,code);
CREATE INDEX stations_metadata_directory ON stations(status,language,category,code);
