import { Store } from "../src/storage.mjs";
const db = new Store(process.env.BLOSSOM_DB || ".data/blossom.db");
const artists = [
["Mira Solenne","Alternative pop","en",["GB","US"],"female","Intimate melodic alternative pop, understated drums, organic synths, articulate vocal, emotionally direct lyrics."],
["Casa Niebla","Latin pop fusion","es",["ES","US"],"mixed","Warm nylon guitar, lively percussion, Spanish language, melodic hooks and modern production."],
["Norrlight","Melodic house","en",["DK","SE","DE"],"mixed","Evolving melodic house, luminous synth leads, dynamic bass, restrained vocals, clean energetic mix."],
["Velora Fields","Neo-classical piano","instrumental",["CH","DE","NL"],"instrumental","Felt piano, patient harmonic progression, minimal ambience, no drums, natural room tone."],
["Sable Meridian","Indie soft rock","en",["GB","US"],"male","Expressive guitar layers, reflective songwriting, vintage-inspired live-band dynamics."],
["Maré Cielo","Acoustic Latin","es",["ES","NL"],"female","Spanish guitar, intimate vocal, Latin acoustic rhythm, organic warmth, gentle production."],
["Nocturne Vale","Sleep ambient","instrumental",["CH","NO","DK"],"instrumental","Soft drones, sparse felt piano, subtle texture, no percussive pulses, gentle transitions."],
["Orion Sundown","Country pop","en",["US","AU"],"male","Contemporary country-pop, crisp acoustic guitar, characterful male vocal, catchy restrained choruses."]
];
let added=0;
for(const [name,genre,language,countries,voice,dna] of artists){
  if(db.artists().some(a=>a.name===name))continue;
  db.addArtist({name,genre,language,countries,voice,dna});added++;
}
console.log(`Added ${added} proposed artist identities. Names and marks require availability checks.`);
db.close();
