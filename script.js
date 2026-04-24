const params = new URLSearchParams(window.location.search);
const sessionId = params.get('id');

if (!sessionId) {
  document.getElementById('main-content').innerHTML = '<div class="no-session"><div style="font-size:3rem">⚠️</div><h2>Aucune session spécifiée</h2><button class="btn-ghost" onclick="window.location.href=\'/\'">Retour</button></div>';
}

async function api(path, method = 'GET', body = null) {
  const o = {method, headers:{'Content-Type':'application/json'}};
  if (body) o.body = JSON.stringify(body);
  const r = await fetch(path, o);
  return r.json();
}

function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'show ' + type;
  setTimeout(() => el.className = '', 3000);
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function loadSession() {
  try {
    const data = await api('/api/sessions');
    const sessions = data.sessions || [];
    const s = sessions.find(x => x.id === sessionId);
    if (!s) {
      document.getElementById('main-content').innerHTML = '<div class="no-session"><div style="font-size:3rem">❌</div><h2>Session introuvable</h2><button class="btn-ghost" onclick="window.location.href=\'/\'">Retour</button></div>';
      return;
    }
    renderMain(s);
  } catch(e) {
  }
}

function statusLabel(c) {
  return c==='open'?'✅ Connecté':c==='connecting'?'⏳ Connexion...':'❌ Déconnecté';
}

function renderMain(s) {
  const badge = document.getElementById('hdr-status');
  badge.textContent = statusLabel(s.connection || s.status);
  badge.className = 'badge ' + (s.connection === 'open' ? 'online' : s.connection === 'connecting' ? 'connecting' : 'offline');
  
  const mc = document.getElementById('main-content');
  
  let qrHTML = '';
  let pairHTML = '';
  
  if (s.connection === 'open' || s.status === 'open') {
    qrHTML = `<div style="text-align:center; padding: 40px 0;"><div style="font-size:4rem; margin-bottom: 20px;">✅</div><div style="font-family:var(--mono);color:var(--green);font-size:1.2rem;font-weight:bold;">Session active</div><div style="font-family:var(--mono);color:var(--muted);font-size:1rem;margin-top:10px">${esc(s.phoneNumber||s.connectedNumber||'')}</div></div>`;
  } else {
    // QR Code
    if (s.qrCode) {
      const u = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data='+encodeURIComponent(s.qrCode)+'&bgcolor=050508&color=25d366&qzone=2';
      qrHTML = `<img src="${u}" alt="QR"><div class="qr-hint">Scannez avec WhatsApp</div>`;
    } else {
      qrHTML = `<div class="qr-placeholder" onclick="requestQR()">Générer QR Code</div>`;
    }
    
    // Pairing code
    if (s.pairingCode) {
      pairHTML = `<div style="text-align:center"><div class="pairing">${esc(s.pairingCode)}</div><div class="qr-hint" style="margin-top:15px">WhatsApp → Appareils → Lier avec numéro</div></div>`;
    } else {
      pairHTML = `<div style="max-width: 300px; margin: 0 auto; text-align:center"><input type="tel" id="pair-phone" placeholder="Numéro (ex: 23761...)"><button class="btn-green" style="width: 100%; justify-content: center; padding: 12px; font-size: 1rem;" onclick="requestPairing()">Obtenir Code</button></div>`;
    }
  }

  mc.innerHTML = `
    <div class="sec-title">${esc(s.phoneNumber || s.connectedNumber || s.id)}</div>
    
    ${(s.connection !== 'open' && s.status !== 'open') ? `
    <div class="split-view">
      <div class="panel">
        <div class="sec-title" style="color:var(--bright)">Scanner QR Code</div>
        <div class="qr-zone">${qrHTML}</div>
        <button class="btn-ghost" style="width:100%; justify-content:center" onclick="requestQR()">↻ Actualiser QR</button>
      </div>
      <div class="panel">
        <div class="sec-title" style="color:var(--bright)">Associer par Numéro</div>
        <div class="qr-zone" style="border: 1px dashed rgba(227,179,65,0.3); border-radius: 8px; background: rgba(227,179,65,0.05);">
          ${pairHTML}
        </div>
      </div>
    </div>
    ` : `
    <div class="panel" style="max-width: 500px; margin: 0 auto; width: 100%;">
      ${qrHTML}
    </div>
    `}
    
    <div class="panel" style="max-width: 500px; margin: 0 auto; width: 100%; margin-top: 20px;">
      <div class="irow"><span class="ikey">ID Session</span><span class="ival">${esc(s.id)}</span></div>
      <div class="irow"><span class="ikey">Statut</span><span class="ival">${statusLabel(s.connection||s.status)}</span></div>
      ${(s.connection === 'open' || s.status === 'open') ? `
        <div class="irow" style="padding-top: 20px;">
          <button class="btn-red" style="width:100%; justify-content:center; padding: 12px; font-size: 1rem;" onclick="disconnectSession()">⏏ Déconnecter la session</button>
        </div>
      ` : ''}
    </div>
  `;
}

async function requestQR() {
  toast('Génération du QR...', 'ok');
  const res = await api(`/api/client/session/${sessionId}/connect`, 'POST');
  if(res.ok) { loadSession(); } else { toast(res.error || 'Erreur', 'err'); }
}

async function requestPairing() {
  const phone = document.getElementById('pair-phone');
  if(!phone || !phone.value) { toast('Entrez un numéro', 'err'); return; }
  toast('Génération du code...', 'ok');
  // Les requêtes client pair vers sessions/:id/pair
  const res = await api(`/api/sessions/${sessionId}/pair`, 'POST', { phone: phone.value });
  if(res.ok) { loadSession(); } else { toast(res.error || 'Erreur', 'err'); }
}

async function disconnectSession() {
  if(!confirm('Déconnecter cette session ?')) return;
  const res = await api(`/api/client/session/${sessionId}/disconnect`, 'POST');
  if(res.ok) { toast('Déconnecté', 'ok'); loadSession(); } else { toast(res.error || 'Erreur', 'err'); }
}

if (sessionId) {
  loadSession();
  setInterval(loadSession, 3000);
}
