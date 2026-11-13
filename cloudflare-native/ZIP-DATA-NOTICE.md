# ZIP-location data

US postal-code locations are derived from [GeoNames](https://www.geonames.org/),
licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
The source is the [GeoNames US postal dataset](https://download.geonames.org/export/zip/US.zip),
retrieved November 13, 2026. Source details and checksum are in `zip-data-source.json`.

The bundled data retains five-digit ZIP codes and approximate latitude/longitude,
rounded to four decimal places. Duplicate ZIP rows retain the highest reported
coordinate accuracy. These locations are estimates and do not establish a
station's coverage, address, or exact distance. Nearby search uses a 25-mile
straight-line radius between these approximate points. Unrecognized ZIP codes
fall back to exact ZIP matches, with a visible notice.

ZIP lookups run inside the website's Cloudflare backend. Visitor ZIP searches
are not sent to GeoNames or another geocoding service.
