# Citi Field venue command demo

Run `npm ci`, then `npm run dev`, and open `http://localhost:4173/stadium.html`. The production build includes this page at `/stadium.html`.

For the GitHub Pages preview, run `node stadium/build-pages.mjs` and publish the contents of `dist` from the `gh-pages` branch. The Pages URL is `https://antonioevans.github.io/gods-eye-view/stadium.html`.

The demo centers the existing Cesium globe on Citi Field. It includes editable sample zones and sample operational issues, map focus, acknowledge and resolve actions, archive and restore, a JSON export, 20 persistent themes, and a street or satellite imagery switch. Issue and zone changes are kept in the current browser's local storage. Reset demo restores the initial sample records.

Current weather is fetched from Open-Meteo's forecast API for the venue center. The timestamp shown is the weather model's time, not a venue sensor timestamp. Open-Meteo describes its free endpoint as suitable for evaluation and prototyping; a commercial service needs the appropriate licence and endpoint. If weather fails, the panel shows an error and offers a retry.

The Citi Field map center and address were checked against OpenStreetMap's Nominatim result on 2026-09-22. All zone locations and operational issues are illustrative. The demo has no connection to Mets or Noble systems, cameras, access control, ticketing, security devices, staff dispatch, or private venue data.

To turn this into a live operations product, connect the feeds Noble is authorized to use, then replace browser storage with an authenticated server store. A venue-specific floor plan, camera registry, sensor mapping, alert thresholds, role permissions, audit trail, and incident routing can then use the same zone and issue model. Do not treat public camera locations or sample points as coverage of Citi Field.

Sources: [God's Eye View](https://github.com/antonioevans/gods-eye-view), [Open-Meteo API documentation](https://open-meteo.com/en/docs), [Open-Meteo pricing and licensing](https://open-meteo.com/en/pricing), [OpenStreetMap attribution](https://www.openstreetmap.org/copyright), [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/).
