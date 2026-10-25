# 3TWNTY — Blossom YouTube Audio Bridge

Deze macOS-tool koppelt **YouTube-zoekresultaten**, **lokale audiometingen** en de **bestaande Blossom Music DNA MCP-tools**. Het manifest bevat **de dertien reeds geregistreerde The KLF, The JAMs en The Timelords referentie-ID's**.

## Installeren

1. Pak dit ZIP-bestand uit op je Mac.
2. Open Terminal in de uitgepakte map.
3. Voer eenmalig uit:

```bash
./install.command
```

Vereist: Homebrew, macOS, internettoegang voor zoeken, een werkende Blossom-installatie, en rechten voor de audio die je zelf downloadt/verwerkt. De installer gebruikt Homebrew voor `yt-dlp`, `ffmpeg` en Python 3.13, en maakt een eigen `.venv`.

## Eerst Blossom MCP testen

```bash
./blossom.command mcp-test
```

Standaardverbinding: `http://127.0.0.1:8787/mcp`. Dit endpoint is daadwerkelijk geïmplementeerd in Blossom, maar verlangt **altijd** een Bearer-token. De eerste bridge probeerde de MCP SDK zonder token, waardoor `initialize` met een onleesbare `ExceptionGroup` faalde.

**Reparatie:** de bridge gebruikt nu de stateless JSON-RPC POST-interface die de Blossom-server daadwerkelijk implementeert (dus geen generieke SDK-discovery). Bij plaatsing onder `~/io/blossom/analyzer/` leest hij **alleen lokaal** automatisch `~/io/blossom/.env` en haalt daar `BLOSSOM_MCP_WRITE_TOKEN` uit. Dat gebeurt alleen als `.env` een gewoon bestand is waarvan jij de eigenaar bent en de rechten `0600` zijn. Tokens worden nooit afgedrukt, gelogd of in de ZIP opgenomen.

Je kunt ook expliciet een bestaande token via de omgeving aanbieden als je de bridge op een andere plek installeert:

```bash
export BLOSSOM_MCP_TOKEN='YOUR_AUTHORIZED_TOKEN'
./blossom.command mcp-test
```

Gebruik geen echte token in gedeelde chats, screenshots of shellgeschiedenis. Als je de bridge binnen de Blossom-projectmap gebruikt, hoef je dit exportcommando niet uit te voeren. Voor de externe OAuth-gateway moet je zelf een geldig toegangstoken configureren; het script **stuurt de lokale .env-token nooit automatisch naar internet**.

Bij 401/403/404/502 toont `mcp-test` voortaan een gerichte diagnose. Controleer ook vanuit de projectmap (geen geheimen worden afgedrukt):

```bash
cd ~/io/blossom
npm run mcp:diagnose
```


## Alle nummers automatisch op YouTube zoeken

```bash
./blossom.command list
./blossom.command search-all --number 5
```

Dit zoekt de beste vijf metadata-kandidaten voor elk van de dertien referenties en schrijft bestanden onder `results/*_candidates.json`. **Geen downloads.** Controleer de titel, jaartal, mixnaam, uploader en duur; een officiële clip, upload uit 2021 en een originele 7-inch edit kunnen een andere master bevatten.

Één specifieke opname zoeken:

```bash
./blossom.command search 04_3am_eternal_live_2021
```

## Gecontroleerd downloaden en meten

Bij materiaal dat je **mag downloaden** kun je een gekozen resultaat verwerken. Expliciete bevestiging is verplicht:

```bash
./blossom.command guided 04_3am_eternal_live_2021 --authorized-download
```

Je kiest vervolgens uit de gevonden YouTube-resultaten het video-nummer. De tool bewaart de originele mediastream lokaal, zet die met FFmpeg om naar analyseerbare WAV, berekent audiometingen en schrijft een provenance-bestand met de bron-URL. Zonder `--authorized-download` wordt de download geweigerd.

Als je een eigen legaal audiobestand hebt, gebruik liever direct de bronkwaliteit:

```bash
./blossom.command measure 04_3am_eternal_live_2021 --file '/Users/me/Music/KLF/3AM Eternal.flac'
```

Of voor een enkele toegestane video:

```bash
./blossom.command process 04_3am_eternal_live_2021 \
  --url 'https://www.youtube.com/watch?v=HDsCeC6f0zc' \
  --authorized-download
```

De `process`-opdracht **meet alleen**; hij publiceert standaard niet.

## Measured DNA naar Blossom publiceren

Bekijk eerst of de audiobron echt de juiste **opname/edit/master** is en controleer `results/04_3am_eternal_live_2021_measurements.json`. De registratie van 3AM Eternal in Blossom verwijst naar de **2021 3:52-digitale release**. De YouTube-clip hoeft daar niet precies mee overeen te komen. Publiceer NIET onder die ID als het niet die editie betreft; registreer dan eerst een eigen juiste versie.

Na verificatie:

```bash
./blossom.command publish 04_3am_eternal_live_2021 --confirmed-edition
```

Het script leest het bestaande catalogus-DNA met `music_dna_get`, bewaart de instrument- en creditsgegevens, voegt de meetgegevens inclusief SHA-256-hash en herkomst toe, en schrijft via `music_dna_save_analysis` een **nieuwe versie**. Volledige ruwe meetgegevens blijven in `results/`.

**Waarom soms geen automatische publicatie?** Blossom verlangt nu een numerieke BPM. Wanneer er geen betrouwbare puls is (zoals op delen van *Chill Out*), slaat deze tool de publicatie over. Er wordt geen BPM verzonnen.

## Door ChatGPT/een AI-agent aan te roepen

`bridge_mcp_server.py` is een optionele **lokale STDIO MCP-server** die deze vier tools aanbiedt:

- `blossom_youtube_find_candidates(recording_id, limit)`
- `blossom_youtube_acquire_authorized(recording_id, video_url, rights_confirmed)`
- `blossom_audio_measure_local(recording_id)`
- `blossom_audio_publish_measurement(recording_id, edition_confirmed)`

Start lokaal met `./start-bridge-mcp.command`. Je kunt hem als STDIO-MCP-server registreren in een lokale agentclient zoals Cursor of Cline.

**Belangrijke integratiestap:** ChatGPT kan deze lokale tool nu niet op je Mac uitvoeren. Om mij dit in een chat rechtstreeks te laten starten, moet het bestaande, geauthenticeerde Blossom MCP-backend de vier nieuwe toolacties registreren of veilig doorsturen. Daarvoor is een wijziging aan Blossom zelf nodig, met authenticatie, autorisatie, vastgelegde downloadrechten en een lokale werkqueue. Dit pakket bevat de lokale werkende scripts en het aansluitpunt, maar wijzigt Blossom's server niet.

## Wat er wel en niet automatisch gemeten wordt

- Wel: SHA-256, duur, gedecodeerde audiokenmerken, stereo-overeenkomst, sample peak, R128 loudness en LRA, voorlopige BPM-schatting, toonsoortkandidaat en grove energieovergangen.
- Niet: betrouwbare instrument-separatie, zangidentificatie, tekstherkenning, een perfecte songstructuur, daadwerkelijk vastgestelde maatsoort of master-identiteit. Die volgen niet betrouwbaar uit deze instrumenten.

YouTube-audio is vaak al verlieslatend gecomprimeerd en kan een heel andere edit zijn dan de originele opname. Bewaar daarom bron-URL en versie-ID, en geef een meting nooit meer zekerheid dan de bron toelaat.

## Bestanden

- `blossom_bridge.py`: zoeken, downloaden, meten en MCP publiceren
- `audio_metrics.py`: audio-meetalgoritmes
- `recordings.json`: exacte dertien Blossom-referenties
- `bridge_mcp_server.py`: optioneel lokaal MCP-hulpmiddel voor agents
- `install.command` en `blossom.command`: macOS-installatie en gebruik
- `results/`: output van zoek- en audiometingen (bij aanvang leeg)
- `downloads/`, `audio/`: lokale mediabestanden (bij aanvang leeg)
