import { Store } from "../src/storage.mjs";
import { enrichProposedArtists } from "../src/proposed-artists.mjs";

const db = new Store(process.env.BLOSSOM_DB || ".data/blossom.db");
const result = enrichProposedArtists(db);
console.log(`Added ${result.added} proposed artist identities and filled ${result.enriched} short notes. Names and marks require availability checks.`);
db.close();
