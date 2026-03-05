const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8765;
const HOME = process.env.HOME;

const PATHS = {
  entropyHistory: path.join(HOME, '.openclaw/extensions/openclaw-plugin-stability/data/entropy-history.json'),
  growthVectorFeedback: path.join(HOME, '.openclaw/extensions/openclaw-plugin-stability/data/growth-vector-feedback.json'),
  growthVectors: path.join(HOME, 'clawd/memory/growth-vectors.json'),
  metabolismCandidates: path.join(HOME, '.openclaw/extensions/openclaw-plugin-metabolism/data/candidates'),
  metabolismProcessed: path.join(HOME, '.openclaw/extensions/openclaw-plugin-metabolism/data/processed'),
};

function readJSON(filepath) {
  try { return JSON.parse(fs.readFileSync(filepath, 'utf-8')); } catch { return null; }
}

function countDir(dir) {
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.json')).length; } catch { return 0; }
}

function getStability() {
  const history = readJSON(PATHS.entropyHistory) || [];
  const latest = history.length > 0 ? history[history.length - 1] : {};
  
  return {
    state: {
      entropy: latest.entropy ?? 0.4,
      alignment: 'stable',
      principles: ['integrity', 'directness', 'reliability', 'privacy', 'curiosity'],
    },
    principles: {
      principles: ['integrity', 'directness', 'reliability', 'privacy', 'curiosity'],
    },
    history: history.slice(-20),
  };
}

function getMetabolism() {
  const pending = countDir(PATHS.metabolismCandidates);
  const processed = countDir(PATHS.metabolismProcessed);

  // Get 10 most recent processed
  let recentProcessed = [];
  try {
    const files = fs.readdirSync(PATHS.metabolismProcessed)
      .filter(f => f.endsWith('.json'))
      .sort().reverse().slice(0, 10);
    recentProcessed = files.map(f => readJSON(path.join(PATHS.metabolismProcessed, f))).filter(Boolean);
  } catch {}

  return { pending, processed, recentProcessed };
}

function getVectors() {
  const data = readJSON(PATHS.growthVectors);
  if (!data) return { vectors: [], candidates: [] };
  return {
    vectors: (data.vectors || []).map(v => ({
      area: v.area || 'unknown',
      direction: v.direction || v.description || '',
      priority: v.priority || 'medium',
      source: v.source || '',
      timestamp: v.timestamp || '',
    })),
    candidates: data.candidates || [],
  };
}

function buildState() {
  return {
    stability: getStability(),
    metabolism: getMetabolism(),
    vectors: getVectors(),
    timestamp: new Date().toISOString(),
  };
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(buildState()));
    return;
  }

  // Serve static files
  let filePath = req.url === '/' ? '/oma-dashboard.html' : req.url;
  filePath = path.join(__dirname, filePath);
  const ext = path.extname(filePath);
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };

  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
    res.end(content);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`OMA Dashboard live at http://0.0.0.0:${PORT}`);
});
