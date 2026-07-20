require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { randomUUID } = require('crypto');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const FRAME_COUNT = 14; // antal bildrutor jämnt utspridda över hela matchen

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('VARNING: ANTHROPIC_API_KEY är inte satt. Kopiera .env.example till .env och fyll i din nyckel.');
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(UPLOAD_DIR));

// --- Uppladdning ---------------------------------------------------------

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const id = randomUUID();
      req.matchId = id;
      const dir = path.join(UPLOAD_DIR, id);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, 'source' + (path.extname(file.originalname || '') || '.mp4'))
  }),
  // Justera efter din hostingplattforms gränser. 2 GB funkar lokalt/på en VPS,
  // men många serverless-plattformar (t.ex. Vercel) tillåter mycket mindre —
  // se README för rekommenderad hosting.
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }
});

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.slice(-2000) || err.message));
      else resolve(stdout);
    });
  });
}

function getDuration(filePath) {
  return new Promise((resolve, reject) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      (err, stdout) => {
        if (err) reject(err);
        else resolve(parseFloat(stdout.trim()));
      }
    );
  });
}

app.post('/api/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Ingen videofil skickades med.' });

    const matchId = req.matchId;
    const dir = path.join(UPLOAD_DIR, matchId);
    const source = path.join(dir, req.file.filename);

    const duration = await getDuration(source);
    if (!duration || duration <= 0) throw new Error('Kunde inte läsa videons längd. Är filen en giltig video?');

    // Extrahera bildrutor jämnt över hela matchen
    const framesDir = path.join(dir, 'frames');
    fs.mkdirSync(framesDir, { recursive: true });
    for (let i = 0; i < FRAME_COUNT; i++) {
      const t = (duration * (i + 1)) / (FRAME_COUNT + 1);
      const out = path.join(framesDir, `frame_${String(i).padStart(2, '0')}.jpg`);
      await runFfmpeg(['-y', '-ss', String(t), '-i', source, '-frames:v', '1', '-vf', 'scale=480:-1', out]);
    }

    // Referensbildruta (tidigt i matchen) som spelaren klickar på för att peka ut sig själv
    const refT = Math.min(duration * 0.1, duration - 1);
    const refPath = path.join(dir, 'reference.jpg');
    await runFfmpeg(['-y', '-ss', String(Math.max(0, refT)), '-i', source, '-frames:v', '1', '-vf', 'scale=900:-1', refPath]);

    // Vi behöver inte den råa videofilen längre efter att bildrutor är extraherade
    fs.unlink(source, () => {});

    res.json({
      matchId,
      duration,
      frameCount: FRAME_COUNT,
      referenceUrl: `/media/${matchId}/reference.jpg`
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Analys ---------------------------------------------------------------

app.post('/api/analyze', async (req, res) => {
  try {
    const { matchId, jerseyDescription, position, clickX, clickY } = req.body;
    if (!matchId) return res.status(400).json({ error: 'matchId saknas.' });

    const dir = path.join(UPLOAD_DIR, matchId);
    const framesDir = path.join(dir, 'frames');
    const refPath = path.join(dir, 'reference.jpg');
    if (!fs.existsSync(framesDir) || !fs.existsSync(refPath)) {
      return res.status(404).json({ error: 'Matchen hittades inte. Ladda upp den igen.' });
    }

    // Rita en röd markering på referensbilden där spelaren klickade
    let annotatedBase64;
    if (typeof clickX === 'number' && typeof clickY === 'number') {
      const img = sharp(refPath);
      const meta = await img.metadata();
      const cx = Math.round(clickX * meta.width);
      const cy = Math.round(clickY * meta.height);
      const r = Math.round(Math.max(meta.width, meta.height) * 0.035);
      const markerSvg = Buffer.from(`
        <svg width="${meta.width}" height="${meta.height}">
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#FF3B30" stroke-width="5"/>
          <circle cx="${cx}" cy="${cy}" r="4" fill="#FF3B30"/>
        </svg>`);
      const buf = await img.composite([{ input: markerSvg }]).jpeg({ quality: 85 }).toBuffer();
      annotatedBase64 = buf.toString('base64');
    } else {
      annotatedBase64 = fs.readFileSync(refPath).toString('base64');
    }

    const frameFiles = fs.readdirSync(framesDir).filter(f => f.endsWith('.jpg')).sort();
    const frameImages = frameFiles.map(f => fs.readFileSync(path.join(framesDir, f)).toString('base64'));

    const content = [
      {
        type: 'text',
        text: `Här är en markerad bildruta tidigt i matchen. Spelaren som ska analyseras är inringad i rött.`
      },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: annotatedBase64 } },
      {
        type: 'text',
        text: `Spelarbeskrivning: ${jerseyDescription || 'ej angiven'}. Position: ${position || 'ej angiven'}.

Nedan följer ${frameImages.length} bildrutor jämnt utspridda över hela matchen, i kronologisk ordning. Hitta samma spelare i varje bildruta (baserat på tröjfärg/nummer, lagets färg och ungefärlig position) och analysera ENBART den spelarens prestationer — inte hela matchen eller andra spelare.`
      },
      ...frameImages.map(b64 => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } }))
    ];

    const systemPrompt = `Du är en erfaren fotbollstränare och matchanalytiker. Du får en serie bildrutor utspridda över en hel match och ska analysera EN specifik spelare (utpekad med en röd markering på första bilden och en textbeskrivning). Bildrutorna ger dig bara stickprov ur matchen, inte en fullständig spårning — var ärlig i tonen om att detta är en översiktlig bedömning, inte millimeterexakt statistik.

Ge konstruktiv, konkret feedback: vad spelaren gör bra, vad som kan förbättras, och 2-4 konkreta träningsövningar kopplade till svagheterna.

Svara ENDAST med ett JSON-objekt, utan inledning, utan markdown-formatering, exakt i detta format:
{
  "strengths": ["kort konkret styrka", "..."],
  "weaknesses": ["kort konkret svaghet", "..."],
  "exercises": [
    {"title": "kort namn på övningen", "focus": "vilken svaghet den tränar", "description": "1-2 meningar om hur övningen går till"}
  ]
}
Ge 2-4 punkter per lista. Skriv allt på svenska.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API-fel (${response.status}): ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    res.json(parsed);
  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Matchanalys-servern kör på http://localhost:${PORT}`);
});
