// Editorial taxonomy, not a claim that any genre is currently trending.
export const GENRES = Object.freeze({
  "Country & Americana":["Traditional Country","Contemporary Country","Country Pop","Country Rock","Outlaw Country","Americana","Bluegrass","Honky Tonk","Alt-Country","Western Swing","Country Folk","Red Dirt","Nashville Sound"],
  "Pop":["Mainstream Pop","Indie Pop","Alternative Pop","Synthpop","Dream Pop","Electropop","Bedroom Pop","Teen Pop","Dance Pop","Art Pop","Power Pop","Euro Pop","Latin Pop"],
  "Electronic & Dance":["House","Melodic House","Deep House","Tech House","Progressive House","Techno","Trance","EDM","Future Bass","Drum and Bass","UK Garage","Downtempo","Synthwave","Electro Swing"],
  "Rock & Alternative":["Classic Rock","Indie Rock","Alternative Rock","Soft Rock","Hard Rock","Post Rock","Psychedelic Rock","Garage Rock","Shoegaze","Britpop","Pop Punk","Progressive Rock"],
  "Hip-Hop & Urban":["Hip-Hop","Trap","Boom Bap","Alternative Hip-Hop","UK Drill","Grime","Cloud Rap","Lo-Fi Hip-Hop","R&B","Contemporary R&B","Neo Soul"],
  "Latin & Iberian":["Reggaeton","Latin Pop","Bachata","Salsa","Merengue","Cumbia","Regional Mexican","Corridos Tumbados","Mariachi","Flamenco","Spanish Guitar","Bossa Nova","Samba"],
  "Ambient & Wellness":["Ambient","Sleep Ambient","Focus Music","Meditation","Drone","Soundscape","Nature Ambient","Lo-Fi Chill","Chillout","New Age"],
  "Classical & Instrumental":["Neo-Classical","Solo Piano","Orchestral","Chamber Music","Cinematic Score","Film Soundtrack","Minimalism","Guitar Instrumental","Post-Classical"],
  "Jazz, Blues & Soul":["Jazz","Smooth Jazz","Bebop","Jazz Fusion","Blues","Electric Blues","Soul","Motown","Funk","Gospel"],
  "Folk & Acoustic":["Contemporary Folk","Indie Folk","Celtic","Singer-Songwriter","Acoustic Pop","Bluegrass Folk","Nordic Folk","World Folk"],
  "Global & Regional":["Afrobeats","Amapiano","Highlife","Afro-Fusion","K-Pop","J-Pop","Bollywood","Indian Classical","Arabic Pop","Raï","Turkish Pop","French Chanson","Dutch Pop","Schlager"],
  "Heavy & Experimental":["Heavy Metal","Metalcore","Doom Metal","Industrial","Post-Punk","Darkwave","Experimental","Noise","Trip-Hop"],
  "Children & Seasonal":["Children's Music","Lullaby","Holiday","Christmas","Educational Music","Family Pop"]
});
export const ALL_GENRES=Object.freeze(Object.values(GENRES).flat());
export function findGenre(query) {
  const normalized=String(query??"").trim().toLowerCase();
  return ALL_GENRES.find(g=>g.toLowerCase()===normalized)||null;
}
