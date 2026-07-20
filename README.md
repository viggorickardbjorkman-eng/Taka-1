# Matchanalys — full-stack starter

En riktig server (inte en artefakt) som gör det som demot i chatten inte kunde: ladda upp en **hel match**, peka ut dig själv som spelare, och få en analys av styrkor/svagheter plus förslag på träningsövningar.

Video-uppladdningen fungerar här eftersom bearbetningen sker på servern (med `ffmpeg`), inte i webbläsaren — ingen CSP-spärr att bråka med.

## Hur det funkar

1. **Ladda upp** — du laddar upp en videofil. Servern kör `ffprobe`/`ffmpeg` och extraherar 14 bildrutor jämnt utspridda över hela matchens längd, plus en tidig "referensbild".
2. **Peka ut dig själv** — du klickar på dig själv i referensbilden och skriver tröjfärg/nummer. Servern ritar en röd markering på just den punkten.
3. **Analys** — den markerade bilden + de 14 bildrutorna + din beskrivning skickas till Claude, som försöker hitta samma spelare genom hela matchen och ger styrkor, svagheter och 2–4 konkreta träningsövningar.

## Kom igång lokalt

**Krav:** Node.js 18+, och `ffmpeg` + `ffprobe` installerat på systemet (`brew install ffmpeg` på Mac, `apt install ffmpeg` på Ubuntu/Debian).

```bash
npm install
cp .env.example .env
# öppna .env och klistra in din ANTHROPIC_API_KEY (från https://console.anthropic.com/settings/keys)
npm start
```

Öppna sedan `http://localhost:3000`.

## Viktiga begränsningar att känna till

- **Detta är ett stickprov, inte spårning.** 14 bildrutor ur en 90-minutersmatch är ~1 bildruta var 6:e minut. Det räcker för en översiktlig kvalitativ bedömning, men är långt ifrån den typen av bild-för-bild-spårning som t.ex. Veo eller Wyscout gör. Vill du ha tätare analys, höj `FRAME_COUNT` i `server.js` — men varje bildruta kostar både pengar (API-anrop) och tid.
- **Spelaridentifiering är text- och bildbaserad, inte riktig objektspårning.** Claude letar efter "spelaren med gul-blå tröja, nummer 18" i varje bildruta utifrån vad den ser — det fungerar bra i de flesta fall, men kan bli fel i tajta närkamper eller om flera spelare bär liknande tröjor (t.ex. båda lagens målvakter).
- **Filstorlek/tidsgräns beror på var du hostar.** `multer` är satt till 2 GB som gräns, men vissa hostingplattformar (särskilt serverless, se nedan) har egna, betydligt lägre gränser.

## Att driftsätta

Den här appen kör en långlivad Node-process som anropar `ffmpeg` och tillfälligt lagrar filer på disk — det gör att **serverless-plattformar som Vercel/Netlify Functions passar dåligt** (de har korta tidsgränser och inget beständigt filsystem). Rekommenderat istället:

- **Render** (render.com) — enkelt, stöder `ffmpeg` via buildpack, beständig disk går att lägga till
- **Railway** (railway.app) — liknande, mycket enkelt för Node + ffmpeg
- **Fly.io** — mer kontroll, kräver lite mer konfiguration (Dockerfile)
- **En egen VPS** (Hetzner, DigitalOcean) — mest kontroll, du hanterar allt själv

Oavsett plattform: sätt miljövariabeln `ANTHROPIC_API_KEY`, se till att `ffmpeg` finns installerat i miljön (de flesta av ovanstående har det, eller så installerar du det via buildpack/Dockerfile), och peka en beständig volym mot `uploads/`-mappen om du vill spara matcher mellan omstarter.

## Naturliga nästa steg

- **Spara matcher per användare** — lägg till inloggning (t.ex. Supabase Auth) och en databas som kopplar matcher till konton, så analyser inte försvinner
- **Progressbar under analys** — analysen kan ta 10–30 sekunder; lägg gärna till en tydligare laddningsindikator
- **Fler bildrutor kring nyckelmoment** — låt användaren markera 2–3 extra tidsstämplar (t.ex. "här gjorde jag ett misstag") för tätare analys av just de ögonblicken, utöver de jämnt utspridda bildrutorna
- **Historik** — visa tidigare analyser över tid, så spelaren kan se om svagheter förbättras match för match
