# Privacy and terms

- **Local first.** The profile, the research and the bundle live on the person's machine. The hosted viewer is a
  static page: it only reads a bundle the person opens or one that was deployed with it.
- **Consent per source** for the context sweep. Name the source, say what you'll read, wait for a yes.
- **Public deploys are opt-in.** Before deploying a bundle publicly, remove the person's name, exact home address
  (use a neighborhood point), personal notes, and anyone else's details. Use `exclude_terms` for anything sensitive.
- **Terms of service.** Use official APIs and connectors, normal reading of public pages, or exports the person
  downloads themselves. No scraping of listing or review sites, no automation behind a login, no bulk downloads.
- **OpenStreetMap.** Overpass and Nominatim are shared community services: fetch once at build time, cache,
  1 request per second for Nominatim, send a descriptive User-Agent, keep "© OpenStreetMap contributors (ODbL)".
- **Estimates stay labeled.** Rents, commute minutes and hours are estimates until the person checks them.
