let currentMatch = null; // { matchId, referenceUrl }
let click = null; // { x, y } normaliserat 0-1

const stepUpload = document.getElementById('step-upload');
const stepPlayer = document.getElementById('step-player');
const stepResult = document.getElementById('step-result');
const statusTag = document.getElementById('statusTag');

function goToStep(step) {
  [stepUpload, stepPlayer, stepResult].forEach(s => s.classList.remove('active'));
  step.classList.add('active');
  const labels = { [stepUpload.id]: '1', [stepPlayer.id]: '2', [stepResult.id]: '3' };
  statusTag.textContent = `steg ${labels[step.id]} av 3`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- Steg 1: uppladdning --------------------------------------------------

const dropzone = document.getElementById('dropzone');
const videoInput = document.getElementById('videoInput');
const uploadStatus = document.getElementById('uploadStatus');
const uploadProgress = document.getElementById('uploadProgress');
const uploadProgressBar = document.getElementById('uploadProgressBar');

videoInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) uploadVideo(file);
});

function uploadVideo(file) {
  uploadStatus.textContent = `Laddar upp ${file.name}…`;
  uploadStatus.style.color = 'var(--chalk-dim)';
  uploadProgress.classList.add('active');
  uploadProgressBar.style.width = '0%';

  const formData = new FormData();
  formData.append('video', file);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload');

  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) {
      const pct = Math.round((e.loaded / e.total) * 100);
      uploadProgressBar.style.width = pct + '%';
      uploadStatus.textContent = pct < 100 ? `Laddar upp… ${pct}%` : 'Bearbetar video (extraherar bildrutor)…';
    }
  });

  xhr.onload = () => {
    uploadProgress.classList.remove('active');
    if (xhr.status >= 200 && xhr.status < 300) {
      const data = JSON.parse(xhr.responseText);
      currentMatch = { matchId: data.matchId, referenceUrl: data.referenceUrl };
      uploadStatus.textContent = '';
      showPlayerStep();
    } else {
      let msg = 'Kunde inte ladda upp videon.';
      try { msg = JSON.parse(xhr.responseText).error || msg; } catch (e) {}
      uploadStatus.textContent = msg;
      uploadStatus.style.color = 'var(--red)';
    }
  };

  xhr.onerror = () => {
    uploadProgress.classList.remove('active');
    uploadStatus.textContent = 'Nätverksfel vid uppladdning.';
    uploadStatus.style.color = 'var(--red)';
  };

  xhr.send(formData);
}

// --- Steg 2: peka ut spelaren --------------------------------------------

const refWrap = document.getElementById('refWrap');
const refImg = document.getElementById('refImg');
const marker = document.getElementById('marker');
const jerseyDesc = document.getElementById('jerseyDesc');
const positionSelect = document.getElementById('position');
const analyzeBtn = document.getElementById('analyzeBtn');
const analyzeStatus = document.getElementById('analyzeStatus');

function showPlayerStep() {
  refImg.src = currentMatch.referenceUrl;
  click = null;
  marker.style.display = 'none';
  checkReady();
  goToStep(stepPlayer);
}

refWrap.addEventListener('click', (e) => {
  const rect = refImg.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  click = { x, y };
  marker.style.left = (x * 100) + '%';
  marker.style.top = (y * 100) + '%';
  marker.style.display = 'block';
  checkReady();
});

jerseyDesc.addEventListener('input', checkReady);

function checkReady() {
  analyzeBtn.disabled = !(click && jerseyDesc.value.trim().length > 0);
}

analyzeBtn.addEventListener('click', async () => {
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Analyserar…';
  analyzeStatus.textContent = 'Det här kan ta en stund — AI:n går igenom hela matchen.';
  analyzeStatus.style.color = 'var(--chalk-dim)';

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId: currentMatch.matchId,
        jerseyDescription: jerseyDesc.value.trim(),
        position: positionSelect.value,
        clickX: click.x,
        clickY: click.y
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Serverfel (${res.status})`);
    }
    const data = await res.json();
    showResults(data);
  } catch (err) {
    console.error(err);
    analyzeStatus.textContent = err.message || 'Något gick fel. Försök igen.';
    analyzeStatus.style.color = 'var(--red)';
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analysera matchen';
  }
});

// --- Steg 3: resultat ------------------------------------------------------

function showResults(data) {
  const strengthsList = document.getElementById('strengthsList');
  const weaknessesList = document.getElementById('weaknessesList');
  const exercisesList = document.getElementById('exercisesList');

  strengthsList.innerHTML = (data.strengths || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');
  weaknessesList.innerHTML = (data.weaknesses || []).map(w => `<li>${escapeHtml(w)}</li>`).join('');
  exercisesList.innerHTML = (data.exercises || []).map(ex => `
    <div class="exercise-card">
      <div class="ex-title">${escapeHtml(ex.title || '')}</div>
      <div class="ex-focus">${escapeHtml(ex.focus || '')}</div>
      <p class="ex-desc">${escapeHtml(ex.description || '')}</p>
    </div>
  `).join('');

  analyzeStatus.textContent = '';
  goToStep(stepResult);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

document.getElementById('restartBtn').addEventListener('click', () => {
  currentMatch = null;
  click = null;
  videoInput.value = '';
  jerseyDesc.value = '';
  goToStep(stepUpload);
});
