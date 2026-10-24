export const PROPOSED_ARTISTS = Object.freeze([
  {
    name:"Mira Solenne", genre:"Alternative pop", language:"en", countries:["GB","US"], voice:"female",
    previousDna:"Intimate melodic alternative pop, understated drums, organic synths, articulate vocal, emotionally direct lyrics.",
    dna:"Intimate alternative pop, close female lead, 86 BPM, 4/4, approximately 3:20. A soft drum machine and muted electric guitar sit under a conversational vocal. Add warm bass, a narrow synth pad, and one high piano note as an answer. Choruses open with a wider harmony and a gentle lift, never a shout. Keep the bridge nearly dry, then return with the same pulse. Short gaps between sections, clear diction, light vocal double, no trap hats, no festival drop."
  },
  {
    name:"Casa Niebla", genre:"Latin pop fusion", language:"es", countries:["ES","US"], voice:"mixed",
    previousDna:"Warm nylon guitar, lively percussion, Spanish language, melodic hooks and modern production.",
    dna:"Latin pop fusion, shared female and male leads in Spanish, 102 BPM, 4/4, approximately 3:10. Nylon guitar and a light guiro open the verse. Add congas, a rounded electric bass, and a restrained synth hook. Choruses stack both voices with a brighter shaker, still leaving space for the lyric. The bridge drops to guitar and one voice, then the final chorus returns the percussion. Warm room, no reggaeton dembow, no copied folk melody."
  },
  {
    name:"Norrlight", genre:"Melodic house", language:"en", countries:["DK","SE","DE"], voice:"mixed",
    previousDna:"Evolving melodic house, luminous synth leads, dynamic bass, restrained vocals, clean energetic mix.",
    dna:"Melodic house, blended mixed vocals used sparingly, 122 BPM, 4/4, approximately 5:40. A filtered chord and soft kick establish the pulse. The bass arrives after the first minute, side-chained but not slamming. A luminous lead answers the vocal phrase instead of replacing it. The breakdown clears the drums for eight bars, then the kick returns without a hard drop. Clean stereo, no aggressive distortion, no spoken-word sample."
  },
  {
    name:"Velora Fields", genre:"Neo-classical piano", language:"instrumental", countries:["CH","DE","NL"], voice:"instrumental",
    previousDna:"Felt piano, patient harmonic progression, minimal ambience, no drums, natural room tone.",
    dna:"Neo-classical solo piano, no vocal, 72 BPM, 4/4, approximately 4:05. Felt piano in a natural room, patient left-hand figures and simple right-hand lines. No drums, no percussion, and no synth pad over the piano. Dynamics rise only in the middle third, then settle. The pedal stays clean. No cinematic trailer hits and no orchestra swell."
  },
  {
    name:"Sable Meridian", genre:"Indie soft rock", language:"en", countries:["GB","US"], voice:"male",
    previousDna:"Expressive guitar layers, reflective songwriting, vintage-inspired live-band dynamics.",
    dna:"Indie soft rock, reflective male lead, 96 BPM, 4/4, approximately 3:45. Two electric guitars, one clean and one lightly driven, with a live bass and a dry kit. Verses stay close and unhurried. Choruses add a third guitar and a low harmony, not a gang vocal. The bridge is half-time for eight bars, then the last chorus returns to the original tempo. Vintage room, no autotune shine, no synth lead."
  },
  {
    name:"Maré Cielo", genre:"Acoustic Latin", language:"es", countries:["ES","NL"], voice:"female",
    previousDna:"Spanish guitar, intimate vocal, Latin acoustic rhythm, organic warmth, gentle production.",
    dna:"Acoustic Latin song in Spanish, intimate female lead, 90 BPM, 4/4, approximately 3:25. Spanish guitar carries the verse with a soft cajon and a quiet bass. A second guitar enters at the chorus, plus a light shaker. Keep the vocal close and mostly single. The bridge is guitar alone, then the last chorus adds a low harmony. Organic and dry, no dance kick, no brass fanfare."
  },
  {
    name:"Nocturne Vale", genre:"Sleep ambient", language:"instrumental", countries:["CH","NO","DK"], voice:"instrumental",
    previousDna:"Soft drones, sparse felt piano, subtle texture, no percussive pulses, gentle transitions.",
    dna:"Sleep ambient, no vocal and no beat, slow and free, approximately 6:00. Soft drones, sparse felt-piano notes several seconds apart, and a faint air texture. No kick, no shaker, and no rhythmic pulse. Changes are slow fades. Keep the level even and low, with long silence between piano notes. No melody that asks for attention."
  },
  {
    name:"Orion Sundown", genre:"Country pop", language:"en", countries:["US","AU"], voice:"male",
    previousDna:"Contemporary country-pop, crisp acoustic guitar, characterful male vocal, catchy restrained choruses.",
    dna:"Country pop, characterful male lead, 108 BPM, 4/4, approximately 3:05. Crisp acoustic guitar and a simple electric bass open the song. A tight snare and a short telecaster answer arrive at the chorus, with a bright but small harmony. The verse stays on two instruments. The bridge cuts the drums and leaves the vocal with guitar, then the final chorus restores the band. Radio-sized, no pedal-steel solo, no chant, and not a slow baritone ballad."
  }
]);

export function enrichProposedArtists(store) {
  let added = 0, enriched = 0;
  for (const artist of PROPOSED_ARTISTS) {
    const { previousDna, ...profile } = artist;
    const existing = store.artists().find(item => item.name === artist.name);
    if (!existing) {
      store.addArtist(profile);
      added++;
      continue;
    }
    if (previousDna && existing.dna === previousDna) {
      store.updateArtist(existing.id, { ...profile, countries:existing.countries, identityVerified:existing.identityVerified });
      enriched++;
    }
  }
  return { added, enriched };
}
