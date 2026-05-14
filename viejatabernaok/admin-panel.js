/**
 * ============================================================
 * ADMIN PANEL — ADS Labs Marketplace
 * Motor compartido para todos los comerciantes.
 * Se carga desde la raíz de Cloudflare: /admin-panel.js
 *
 * DOS FUENTES DE CONFIGURACIÓN:
 *   1. STORE_CONFIG (global, definida inline en admin.html)
 *      → SHEET_ID, storeName, storeId, categories, ownerEmail
 *   2. storeConfig (local, cargada via fetch de config.json)
 *      → plan, features (maxProducts, carousel, video, aiAutoFill)
 * ============================================================
 */
(function () {
  'use strict';

  const CLIENT_ID = '3959192869-dp0lcvlmhfmkglgdvf94u3vl5hi9hscj.apps.googleusercontent.com';
  const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';

  let tokenClient;
  let accessToken = null;
  let userInfo = null;
  let storeConfig = null; // from config.json
  let products = [];
  let currentTab = 'dashboard';
  let demoMode = false;

  // ============================================================
  // ERROR REPORTING — Envía errores al servidor para monitoreo
  // ============================================================
  function reportError(error, context) {
    const storeId = (typeof STORE_CONFIG !== 'undefined' && STORE_CONFIG.storeId) || 'unknown';
    try {
      fetch('/api/report-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId,
          error: String(error),
          context: context || '',
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(),
        })
      }).catch(() => {}); // Silencioso, nunca bloquear por esto
    } catch (e) { /* ignore */ }
  }

  // ============================================================
  // INIT
  // ============================================================
  window.AdminPanel = {
    init,
    showTab,
    addProduct,
    editProduct,
    deleteProduct,
    showAddModal,
    closeModal,
    logout,
    demoLogin,
  };

  async function init() {
    // Load config
    try {
      const res = await fetch('config.json');
      storeConfig = await res.json();
    } catch (e) {
      storeConfig = { plan: 'free', features: { maxProducts: 20, carousel: false, video: false, aiAutoFill: false } };
    }

    // Check if demo mode via URL param
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('demo') === '1') {
      await demoLogin();
      return;
    }

    // Show demo button if no SHEET_ID configured
    const hasSheet = typeof STORE_CONFIG !== 'undefined' && STORE_CONFIG.SHEET_ID && STORE_CONFIG.SHEET_ID.length > 5;
    if (!hasSheet) {
      const loginCard = document.querySelector('.login-card');
      if (loginCard) {
        const demoBtn = document.createElement('button');
        demoBtn.className = 'btn-demo';
        demoBtn.textContent = '👁️ Probar sin cuenta (modo demo)';
        demoBtn.onclick = () => AdminPanel.demoLogin();
        demoBtn.style.cssText = 'display:block;width:100%;margin-top:12px;padding:12px 24px;background:transparent;color:#5f6368;border:1px dashed #d1d5db;border-radius:8px;font-size:13px;cursor:pointer;transition:all 0.2s;font-family:inherit;';
        demoBtn.onmouseenter = () => { demoBtn.style.borderColor = '#111'; demoBtn.style.color = '#111'; };
        demoBtn.onmouseleave = () => { demoBtn.style.borderColor = '#d1d5db'; demoBtn.style.color = '#5f6368'; };
        loginCard.querySelector('.login-footer').before(demoBtn);

        // Update footer text
        const footer = loginCard.querySelector('.login-footer');
        if (footer) footer.textContent = 'Google Sheet no configurado — podés probar el panel en modo demo';
      }
    }

    // Load Google APIs
    try {
      await loadScript('https://apis.google.com/js/api.js');
      await loadScript('https://accounts.google.com/gsi/client');
      await new Promise(resolve => gapi.load('client', resolve));
      await gapi.client.init({});
      await gapi.client.load('sheets', 'v4');
      await gapi.client.load('drive', 'v3');

      // Init token client
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: onTokenResponse,
      });

      // Check if already logged in (session storage)
      const savedToken = sessionStorage.getItem('admin_token');
      if (savedToken) {
        accessToken = savedToken;
        gapi.client.setToken({ access_token: accessToken });
        await onLoginSuccess();
      }
    } catch (e) {
      console.warn('Google APIs no disponibles:', e.message);
      // If Google APIs fail to load, ensure demo button is visible
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // ============================================================
  // AUTH
  // ============================================================
  window.adminLogin = function () {
    tokenClient.requestAccessToken();
  };

  function onTokenResponse(resp) {
    if (resp.error) {
      toast('Error de autenticación: ' + (resp.error_description || resp.error), 'error');
      reportError(`OAuth error: ${resp.error} - ${resp.error_description}`, 'onTokenResponse');
      return;
    }
    accessToken = resp.access_token;
    // ═══ CRÍTICO: Asociar el token al cliente gapi ═══
    // Sin esto, gapi.client.sheets NO puede hacer llamadas autenticadas.
    gapi.client.setToken({ access_token: accessToken });
    sessionStorage.setItem('admin_token', accessToken);
    onLoginSuccess();
  }

  async function onLoginSuccess() {
    // Get user info
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      userInfo = await res.json();
    } catch (e) {
      userInfo = { name: 'Admin', picture: '' };
    }

    // ═══ VALIDACIÓN SERVER-SIDE (imposible de bypassear) ═══
    try {
      const verifyRes = await fetch('/api/verify-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken, storeId: STORE_CONFIG.storeId })
      });
      const verifyData = await verifyRes.json();
      console.log('🔐 verify-admin response:', JSON.stringify(verifyData), 'status:', verifyRes.status);
      if (!verifyData.allowed) {
        console.error('❌ Acceso denegado. Email de Google:', userInfo.email, 'Store:', STORE_CONFIG.storeId);
        alert('DEBUG: Acceso denegado.\nEmail con el que entraste: ' + (userInfo.email || 'desconocido') + '\nStore ID: ' + STORE_CONFIG.storeId + '\nRespuesta del servidor: ' + JSON.stringify(verifyData));
        toast('⛔ No tenés permiso para acceder a este panel.', 'error');
        accessToken = null;
        sessionStorage.removeItem('admin_token');
        return;
      }
      if (verifyData.name) userInfo.name = verifyData.name;
      if (verifyData.email) userInfo.email = verifyData.email;
    } catch (serverErr) {
      // Fallback: hash local si el Worker no está disponible
      console.warn('⚠️ Server verification unavailable, using local hash fallback:', serverErr);
      if (STORE_CONFIG._ownerHash && userInfo.email) {
        const isOwner = typeof STORE_CONFIG.checkOwner === 'function'
          ? await STORE_CONFIG.checkOwner(userInfo.email) : false;
        if (!isOwner) {
          toast('⛔ No tenés permiso para acceder a este panel.', 'error');
          accessToken = null;
          sessionStorage.removeItem('admin_token');
          return;
        }
      }
    }
    // ═══ AUTO-PROVISIONING (seguro: solo llega acá después del Worker) ═══
    if (!STORE_CONFIG.SHEET_ID || STORE_CONFIG.SHEET_ID.length < 5) {
      document.getElementById('login-screen').style.display = 'none';
      await autoProvisionSheet();
    }

    // ═══ SIEMPRE persistir SHEET_ID en servidor (por si no se guardó antes) ═══
    if (STORE_CONFIG.SHEET_ID && STORE_CONFIG.SHEET_ID.length > 5) {
      try {
        await fetch('/api/store-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ store: STORE_CONFIG.storeId, SHEET_ID: STORE_CONFIG.SHEET_ID })
        });
        console.log('✅ SHEET_ID sincronizado con servidor');
      } catch (e) {
        console.warn('⚠️ No se pudo sincronizar SHEET_ID:', e);
      }
    }

    // Show admin layout
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('admin-layout').style.display = 'block';

    // Update header
    document.getElementById('admin-store-name').textContent = STORE_CONFIG.storeName || 'Mi Tienda';
    document.getElementById('admin-user-name').textContent = userInfo.name || '';
    if (userInfo.picture) {
      document.getElementById('admin-user-avatar').src = userInfo.picture;
    }

    // Load products
    await loadProducts();
    showTab('dashboard');
  }

  // ============================================================
  // AUTO-PROVISIONING — Crea el Google Sheet automáticamente
  // SEGURO: solo se ejecuta después de validación server-side
  // ============================================================
  async function autoProvisionSheet() {
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'login-screen';
    loadingDiv.style.cssText = 'flex-direction:column;align-items:center;justify-content:center;z-index:9999;';
    loadingDiv.innerHTML = `
      <div style="font-size:48px;animation:spin 2s linear infinite;">⏳</div>
      <h2 style="margin-top:20px;font-weight:600;">Configurando tu tienda...</h2>
      <p style="color:#666;margin-top:8px;">Creando Google Sheet y conectando catálogo</p>
      <p id="provision-status" style="color:#999;margin-top:4px;font-size:12px;">Verificando APIs...</p>
      <div id="provision-error" style="display:none;margin-top:16px;padding:16px;background:#fee2e2;color:#991b1b;border-radius:8px;font-size:13px;max-width:500px;text-align:left;"></div>
      <style>@keyframes spin { 100% { transform: rotate(360deg); } }</style>
    `;
    document.body.appendChild(loadingDiv);

    const updateStatus = (msg) => {
      const el = document.getElementById('provision-status');
      if (el) el.textContent = msg;
    };

    const showProvisionError = (title, details, steps) => {
      const el = document.getElementById('provision-error');
      if (el) {
        el.style.display = 'block';
        el.innerHTML = `
          <strong style="display:block;margin-bottom:8px;font-size:14px;">${title}</strong>
          <p style="margin-bottom:8px;">${details}</p>
          ${steps ? `<div style="margin-top:8px;padding:8px;background:#fef3c7;color:#92400e;border-radius:4px;font-size:12px;">${steps}</div>` : ''}
          <button onclick="location.reload()" style="margin-top:12px;padding:8px 16px;background:#991b1b;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px;">Reintentar</button>
        `;
      }
      // Stop spinner
      const spinner = loadingDiv.querySelector('div[style*="animation"]');
      if (spinner) spinner.style.animation = 'none';
      if (spinner) spinner.textContent = '❌';
    };

    // PRE-CHECK: Verificar que gapi.client.sheets está disponible
    if (!gapi || !gapi.client || !gapi.client.sheets || !gapi.client.sheets.spreadsheets) {
      const errMsg = 'La API de Google Sheets no se cargó correctamente. Puede que no esté habilitada en Google Cloud Console.';
      reportError(errMsg, 'gapi.client.sheets missing');
      showProvisionError(
        '❌ API de Google Sheets no disponible',
        'La API no se cargó. Esto pasa cuando la API no está habilitada en tu proyecto de Google Cloud.',
        '👉 Pedile al administrador que habilite "Google Sheets API" y "Google Drive API" en <a href="https://console.cloud.google.com/apis/library" target="_blank" style="color:#1d4ed8;text-decoration:underline;">Google Cloud Console</a>'
      );
      return;
    }

    try {
      // 1. Crear Google Sheet
      updateStatus('Paso 1/5: Creando planilla de Google...');
      let createRes;
      try {
        createRes = await gapi.client.sheets.spreadsheets.create({
          properties: { title: `Productos - ${STORE_CONFIG.storeName}` }
        });
      } catch (sheetsErr) {
        let detail = 'Error desconocido';
        try { detail = sheetsErr?.result?.error?.message || sheetsErr?.message || JSON.stringify(sheetsErr); } catch(e) { detail = String(sheetsErr); }
        reportError(`autoProvision STEP1: ${detail}`, 'sheets.create');

        if (detail.includes('not enabled') || detail.includes('has not been used') || detail.includes('disabled')) {
          showProvisionError(
            '❌ Google Sheets API no está habilitada',
            'Necesitás habilitar la API en Google Cloud Console antes de poder crear la planilla.',
            '👉 Abrí este link y hacé clic en "Habilitar": <a href="https://console.cloud.google.com/apis/library/sheets.googleapis.com" target="_blank" style="color:#1d4ed8;text-decoration:underline;">Habilitar Google Sheets API</a>'
          );
        } else if (detail.includes('insufficient') || detail.includes('PERMISSION_DENIED')) {
          showProvisionError(
            '❌ Permisos insuficientes',
            'No se otorgaron los permisos de Google Sheets. Cerrá sesión, recargá la página y volvé a intentar. Asegurate de tildar TODAS las casillas.',
            'Si el problema persiste, borrar cookies del navegador y volver a entrar.'
          );
        } else {
          showProvisionError(
            '❌ Error creando la planilla',
            `Detalle técnico: ${detail}`,
            'Intentá recargar la página. Si sigue fallando, contactá al administrador.'
          );
        }
        return;
      }
      const sheetId = createRes.result.spreadsheetId;

      // 2. Renombrar pestaña inicial a "Productos" (Soluciona el bug de "Hoja 1" vs "Sheet1" en cuentas en español)
      updateStatus('Paso 2/5: Configurando pestaña...');
      let targetSheetName = 'Productos';
      try {
        const sheet = createRes.result.sheets[0];
        await gapi.client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: sheetId,
          resource: { requests: [{ updateSheetProperties: { properties: { sheetId: sheet.properties.sheetId, title: 'Productos' }, fields: 'title' } }] }
        });
      } catch (e) { 
        console.warn('No se pudo renombrar pestaña:', e);
        targetSheetName = createRes.result.sheets[0].properties.title; // Fallback al nombre original (ej: "Hoja 1")
      }

      // 3. Agregar headers
      updateStatus('Paso 3/5: Configurando columnas...');
      await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: sheetId, range: `${targetSheetName}!A1:I1`, valueInputOption: 'RAW',
        resource: { values: [['ID', 'Nombre', 'Descripción', 'Categoría', 'Precio', 'Talles', 'Foto URL', 'Video URL', 'Activo']] }
      });

      // 4. Copiar productos locales al Sheet
      updateStatus('Paso 4/5: Copiando los 49 productos al Sheet...');
      let localProducts = [];
      try {
        const res = await fetch('productos.json');
        const data = await res.json();
        if (data && data.products) localProducts = data.products;
      } catch (e) { console.warn('No se encontró productos.json'); }

      if (localProducts.length > 0) {
        const rows = localProducts.map(p => [
          p.id, p.name, p.description, p.category, p.price,
          (p.sizes || []).join(', '), (p.images || [p.image]).filter(Boolean).join(', '),
          p.video || '', p.active ? 'TRUE' : 'FALSE'
        ]);
        await gapi.client.sheets.spreadsheets.values.append({
          spreadsheetId: sheetId, range: 'A2',
          valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
          resource: { values: rows }
        });
      }

      // 5. Hacer público (solo lectura)
      updateStatus('Paso 5/5: Publicando planilla...');
      try {
        await fetch(`https://www.googleapis.com/drive/v3/files/${sheetId}/permissions`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'reader', type: 'anyone' })
        });
      } catch (driveErr) {
        reportError(`autoProvision STEP5: ${driveErr.message}`, 'drive.permissions');
        // No fatal
      }

      STORE_CONFIG.SHEET_ID = sheetId;

      // ═══ PERSISTIR SHEET_ID en servidor (para que la web pública lo lea) ═══
      try {
        await fetch('/api/store-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ store: STORE_CONFIG.storeId, SHEET_ID: sheetId })
        });
        console.log('✅ SHEET_ID guardado en servidor para web pública');
      } catch (kvErr) {
        console.warn('⚠️ No se pudo persistir SHEET_ID en servidor:', kvErr);
        reportError(`autoProvision KV save: ${kvErr.message}`, 'store-config');
      }

      loadingDiv.remove();
      toast('✅ ¡Tienda configurada! Ya podés cargar productos.', 'success');
      alert(
        '✅ ¡Tu tienda está lista!\n\n' +
        'Se creó tu Google Sheet con los ' + localProducts.length + ' productos.\n\n' +
        'Link del Sheet:\nhttps://docs.google.com/spreadsheets/d/' + sheetId
      );
    } catch (err) {
      let detail = 'Error desconocido';
      try { detail = err?.result?.error?.message || err?.message || JSON.stringify(err); } catch(e) { detail = String(err); }
      console.error('Error en auto-provisioning:', err);
      reportError(`autoProvision GENERAL: ${detail}`, 'autoProvisionSheet');
      showProvisionError(
        '❌ Error configurando la tienda',
        `Detalle: ${detail}`,
        'Intentá recargar la página (Ctrl+F5). Si sigue fallando, contactá al administrador.'
      );
    }
  }

  function logout() {
    // Revoke BEFORE nullifying the token
    if (accessToken && !demoMode) {
      try { google.accounts.oauth2.revoke(accessToken); } catch (e) { /* ignore */ }
    }
    accessToken = null;
    demoMode = false;
    sessionStorage.removeItem('admin_token');
    // Remove demo banner
    const banner = document.querySelector('.demo-banner');
    if (banner) banner.remove();
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('admin-layout').style.display = 'none';
    // Clean URL
    if (window.location.search.includes('demo')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }

  // ============================================================
  // DEMO MODE — Funciona sin Google OAuth ni Sheets
  // ============================================================
  async function demoLogin() {
    demoMode = true;
    userInfo = { name: 'Demo Admin', email: 'demo@preview', picture: '' };

    // Show admin layout
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('admin-layout').style.display = 'block';

    // Update header
    document.getElementById('admin-store-name').textContent =
      (typeof STORE_CONFIG !== 'undefined' ? STORE_CONFIG.storeName : 'Mi Tienda') + ' (Demo)';
    document.getElementById('admin-user-name').textContent = '👁️ Modo Preview';

    // Add demo banner
    renderDemoBanner();

    // Load products from local JSON
    await loadProducts();
    showTab('dashboard');
  }

  function renderDemoBanner() {
    const existing = document.querySelector('.demo-banner');
    if (existing) return;

    const banner = document.createElement('div');
    banner.className = 'demo-banner';
    banner.style.cssText = `
      background: linear-gradient(90deg, #fef3c7, #fde68a);
      color: #92400e;
      padding: 10px 24px;
      font-size: 13px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    `;
    banner.innerHTML = `
      <span>⚠️ <strong>Modo Demo</strong> — Los cambios se guardan en memoria, no en Google Sheets. Para conectar tu Sheet corré: <code style="background:#fbbf2440;padding:2px 6px;border-radius:4px;">python setup_store.py --store ${typeof STORE_CONFIG !== 'undefined' ? STORE_CONFIG.storeId : 'ID'} --sheet-id TU_SHEET_ID</code></span>
      <button onclick="AdminPanel.logout()" style="background:#92400e;color:white;border:none;padding:6px 14px;border-radius:6px;font-size:12px;cursor:pointer;white-space:nowrap;">Salir del demo</button>
    `;

    const header = document.querySelector('.admin-header');
    if (header) header.after(banner);
  }

  // ============================================================
  // LOAD PRODUCTS FROM SHEET
  // ============================================================
  async function loadProducts() {
    // DEMO MODE: load from local JSON
    if (demoMode) {
      try {
        const res = await fetch('productos.json');
        const data = await res.json();
        products = (data.products || []).map((p, i) => ({
          rowIndex: i + 2, // simulate Sheet rows (header=1)
          id: p.id || i + 1,
          name: p.name || '',
          description: p.description || '',
          category: p.category || '',
          price: p.price || 0,
          sizes: Array.isArray(p.sizes) ? p.sizes.join(', ') : (p.sizes || 'Único'),
          images: Array.isArray(p.images) ? p.images : (p.image ? [p.image] : []),
          image: Array.isArray(p.images) ? p.images[0] : (p.image || ''),
          video: p.video || '',
          active: p.active !== false,
        }));
      } catch (e) {
        toast('Error cargando productos.json: ' + e.message, 'error');
        products = [];
      }
      return;
    }

    // LIVE MODE: load from Google Sheets
    try {
      const response = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: STORE_CONFIG.SHEET_ID,
        range: 'A1:I100',
      });

      const rows = response.result.values || [];
      if (rows.length < 2) {
        products = [];
        return;
      }

      const headers = rows[0].map(h => h.toLowerCase().trim());
      products = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row[1]) continue; // Skip empty name

        const fotoRaw = row[headers.indexOf('foto url')] || '';
        const images = fotoRaw.split(',').map(u => u.trim()).filter(Boolean);

        products.push({
          rowIndex: i + 1,
          id: row[0] || i,
          name: row[1] || '',
          description: row[2] || '',
          category: row[3] || '',
          price: parseFloat(row[4]) || 0,
          sizes: row[5] || '',
          images: images,
          image: images[0] || '',
          video: row[7] || '',
          active: row[8] !== 'FALSE' && row[8] !== false,
        });
      }
    } catch (e) {
      toast('Error cargando productos: ' + e.message, 'error');
    }
  }

  // ============================================================
  // TAB NAVIGATION
  // ============================================================
  function showTab(tab) {
    currentTab = tab;

    // Update nav
    document.querySelectorAll('.nav-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });

    // Hide all sections
    document.querySelectorAll('.tab-content').forEach(s => s.style.display = 'none');

    // Show selected
    const section = document.getElementById(`tab-${tab}`);
    if (section) section.style.display = 'block';

    // Render content
    if (tab === 'dashboard') renderDashboard();
    else if (tab === 'products') renderProductList();
    else if (tab === 'photos') renderPhotoUpload();
  }

  // ============================================================
  // DASHBOARD
  // ============================================================
  function renderDashboard() {
    const active = products.filter(p => p.active).length;
    const noPhoto = products.filter(p => p.images.length === 0).length;
    const categories = [...new Set(products.map(p => p.category))].filter(Boolean);
    const plan = storeConfig.plan || 'free';

    document.getElementById('tab-dashboard').innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon">📦</div>
          <div class="stat-label">Total Productos</div>
          <div class="stat-value">${products.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">✅</div>
          <div class="stat-label">Activos</div>
          <div class="stat-value">${active}</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">📷</div>
          <div class="stat-label">Sin Foto</div>
          <div class="stat-value" style="color:${noPhoto > 0 ? 'var(--danger)' : 'var(--success)'}">${noPhoto}</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">📂</div>
          <div class="stat-label">Categorías</div>
          <div class="stat-value">${categories.length}</div>
        </div>
      </div>

      <div style="background:var(--surface);border-radius:var(--radius);padding:20px;box-shadow:var(--shadow);margin-bottom:16px;">
        <h3 style="font-size:16px;font-weight:600;margin-bottom:12px;">Tu Plan: <span style="color:var(--brand-accent);text-transform:uppercase;">${plan}</span></h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;font-size:13px;">
          ${featureItem('Productos', storeConfig.features?.maxProducts || 20, true)}
          ${featureItem('Carrusel de fotos', storeConfig.features?.carousel, storeConfig.features?.carousel)}
          ${featureItem('Video', storeConfig.features?.video, storeConfig.features?.video)}
          ${featureItem('IA auto-fill', storeConfig.features?.aiAutoFill, storeConfig.features?.aiAutoFill)}
        </div>
      </div>
    `;
  }

  function featureItem(name, value, enabled) {
    if (typeof value === 'number') {
      return `<div>✅ ${name}: hasta ${value}</div>`;
    }
    return enabled
      ? `<div>✅ ${name}</div>`
      : `<div>🔒 ${name} — <span style="color:var(--brand-accent);font-size:11px;">Contactanos</span></div>`;
  }

  // ============================================================
  // PRODUCT LIST
  // ============================================================
  function renderProductList() {
    const maxProducts = storeConfig.features?.maxProducts || 20;
    const canAdd = products.length < maxProducts;

    let html = `
      <div class="section-header">
        <h2>Productos (${products.length}/${maxProducts})</h2>
        ${canAdd ? `<button class="btn-primary" onclick="AdminPanel.showAddModal()">+ Agregar</button>` : `<span style="font-size:12px;color:var(--warning);">Límite alcanzado</span>`}
      </div>
      <div class="product-table">
        <div class="product-row header">
          <div>Foto</div>
          <div>Producto</div>
          <div>Categoría</div>
          <div>Precio</div>
          <div>Estado</div>
          <div>Acciones</div>
        </div>
    `;

    products.forEach(p => {
      const imgSrc = p.image || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect fill="%23eee" width="48" height="48"/></svg>';
      const photoCount = p.images.length;

      html += `
        <div class="product-row">
          <div style="position:relative;">
            <img class="product-thumb" src="${imgSrc}" alt="${p.name}">
            ${photoCount > 1 ? `<span style="position:absolute;bottom:2px;right:2px;background:var(--brand);color:white;font-size:9px;padding:1px 4px;border-radius:3px;">${photoCount}📷</span>` : ''}
          </div>
          <div class="product-name">
            ${p.name}
            <div class="product-desc">${p.description.substring(0, 50)}${p.description.length > 50 ? '...' : ''}</div>
          </div>
          <div class="product-category">${p.category}</div>
          <div class="product-price">${p.price > 0 ? '$' + p.price.toLocaleString('es-AR') : '<span style="color:var(--warning)">$0</span>'}</div>
          <div><span class="${p.active ? 'badge-active' : 'badge-inactive'}">${p.active ? 'Activo' : 'Inactivo'}</span></div>
          <div>
            <button class="btn-sm" onclick="AdminPanel.editProduct(${p.rowIndex})">✏️</button>
            <button class="btn-danger" onclick="AdminPanel.deleteProduct(${p.rowIndex})" style="margin-left:4px;">🗑️</button>
          </div>
        </div>
      `;
    });

    html += '</div>';
    document.getElementById('tab-products').innerHTML = html;
  }

  // ============================================================
  // ADD / EDIT PRODUCT
  // ============================================================
  function showAddModal(rowIndex) {
    const isEdit = !!rowIndex;
    const product = isEdit ? products.find(p => p.rowIndex === rowIndex) : {};

    // Categories from STORE_CONFIG (inline in admin.html)
    const categories = (typeof STORE_CONFIG !== 'undefined' && STORE_CONFIG.categories)
      ? STORE_CONFIG.categories
      : ['General'];
    const catOptions = categories.map(c =>
      `<option value="${c}" ${product.category === c ? 'selected' : ''}>${c}</option>`
    ).join('');

    document.getElementById('modal-overlay').innerHTML = `
      <div class="modal-card">
        <h3>${isEdit ? 'Editar' : 'Agregar'} Producto</h3>
        <div class="form-group">
          <label>Nombre</label>
          <input type="text" id="form-name" value="${product.name || ''}" placeholder="Ej: Taladro Bosch 13mm">
        </div>
        <div class="form-group">
          <label>Descripción</label>
          <textarea id="form-desc" placeholder="Descripción breve del producto">${product.description || ''}</textarea>
        </div>
        <div class="form-group">
          <label>Categoría</label>
          <select id="form-category">${catOptions}</select>
        </div>
        <div class="form-group">
          <label>Precio ($)</label>
          <input type="number" id="form-price" value="${product.price || 0}" min="0">
        </div>
        <div class="form-group">
          <label>Talles (separados por coma, o "Único")</label>
          <input type="text" id="form-sizes" value="${product.sizes || 'Único'}" placeholder="S, M, L, XL">
        </div>
        <div class="form-actions">
          <button class="btn-sm" onclick="AdminPanel.closeModal()">Cancelar</button>
          <button class="btn-primary" onclick="AdminPanel.${isEdit ? 'editProduct' : 'addProduct'}(${rowIndex || 0})">${isEdit ? 'Guardar' : 'Agregar'}</button>
        </div>
      </div>
    `;
    document.getElementById('modal-overlay').classList.add('show');
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.remove('show');
  }

  async function addProduct() {
    const name = document.getElementById('form-name').value.trim();
    if (!name) { toast('El nombre es obligatorio', 'error'); return; }

    // DEMO MODE: add to in-memory array
    if (demoMode) {
      const maxId = products.reduce((m, p) => Math.max(m, parseInt(p.id) || 0), 0);
      products.push({
        rowIndex: products.length + 2,
        id: maxId + 1,
        name: name,
        description: document.getElementById('form-desc').value,
        category: document.getElementById('form-category').value,
        price: parseFloat(document.getElementById('form-price').value) || 0,
        sizes: document.getElementById('form-sizes').value,
        images: [],
        image: '',
        video: '',
        active: true,
      });
      toast('✅ Producto agregado (demo — no se guarda en Sheets)');
      closeModal();
      renderProductList();
      return;
    }

    const newRow = [
      products.length + 1,
      name,
      document.getElementById('form-desc').value,
      document.getElementById('form-category').value,
      document.getElementById('form-price').value,
      document.getElementById('form-sizes').value,
      '', // Foto URL
      '', // Video URL
      'TRUE',
    ];

    try {
      await gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId: STORE_CONFIG.SHEET_ID,
        range: 'A:I',
        valueInputOption: 'USER_ENTERED',
        resource: { values: [newRow] },
      });

      toast('✅ Producto agregado');
      closeModal();
      await loadProducts();
      renderProductList();
    } catch (e) {
      let detail = 'Error desconocido';
      try { detail = e?.result?.error?.message || e?.message || JSON.stringify(e); } catch(err) { detail = String(e); }
      reportError(`addProduct error: ${detail}`, 'addProduct');
      toast('Error agregando producto: ' + detail, 'error');
    }
  }

  async function editProduct(rowIndex) {
    if (!document.getElementById('form-name')) {
      showAddModal(rowIndex);
      return;
    }

    const name = document.getElementById('form-name').value.trim();
    if (!name) { toast('El nombre es obligatorio', 'error'); return; }

    const product = products.find(p => p.rowIndex === rowIndex);

    // DEMO MODE: update in-memory
    if (demoMode) {
      product.name = name;
      product.description = document.getElementById('form-desc').value;
      product.category = document.getElementById('form-category').value;
      product.price = parseFloat(document.getElementById('form-price').value) || 0;
      product.sizes = document.getElementById('form-sizes').value;
      toast('✅ Producto actualizado (demo)');
      closeModal();
      renderProductList();
      return;
    }

    const updatedRow = [
      product.id,
      name,
      document.getElementById('form-desc').value,
      document.getElementById('form-category').value,
      document.getElementById('form-price').value,
      document.getElementById('form-sizes').value,
      product.images.join(', '),
      product.video,
      product.active ? 'TRUE' : 'FALSE',
    ];

    try {
      await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: STORE_CONFIG.SHEET_ID,
        range: `A${rowIndex}:I${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [updatedRow] },
      });

      toast('✅ Producto actualizado');
      closeModal();
      await loadProducts();
      renderProductList();
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    }
  }

  async function deleteProduct(rowIndex) {
    if (!confirm('¿Seguro querés eliminar este producto?')) return;

    // DEMO MODE: remove from in-memory array
    if (demoMode) {
      products = products.filter(p => p.rowIndex !== rowIndex);
      toast('🗑️ Producto eliminado (demo)');
      renderProductList();
      return;
    }

    try {
      // Get spreadsheet ID to find sheet GID
      const ssInfo = await gapi.client.sheets.spreadsheets.get({
        spreadsheetId: STORE_CONFIG.SHEET_ID,
      });
      const sheetId = ssInfo.result.sheets[0].properties.sheetId;

      await gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: STORE_CONFIG.SHEET_ID,
        resource: {
          requests: [{
            deleteDimension: {
              range: { sheetId, dimension: 'ROWS', startIndex: rowIndex - 1, endIndex: rowIndex }
            }
          }]
        }
      });

      toast('🗑️ Producto eliminado');
      await loadProducts();
      renderProductList();
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    }
  }

  // ============================================================
  // PHOTO UPLOAD
  // ============================================================
  function renderPhotoUpload() {
    const carouselEnabled = storeConfig.features?.carousel !== false;
    const maxPhotos = storeConfig.features?.maxPhotos || 1;

    let html = `
      <div class="section-header">
        <h2>Subir Fotos</h2>
      </div>

      <div class="form-group">
        <label>Seleccioná el producto</label>
        <select id="photo-target">
          ${products.map(p => `<option value="${p.rowIndex}">${p.id}. ${p.name} (${p.images.length} fotos)</option>`).join('')}
        </select>
      </div>

      <div class="upload-zone" id="photo-drop" onclick="document.getElementById('photo-input').click()">
        <div class="icon">📸</div>
        <p>Arrastrá fotos acá o hacé clic</p>
        <p class="hint">${carouselEnabled ? 'Podés subir varias para armar el carrusel' : '1 foto por producto (Plan Free)'}</p>
      </div>
      <input type="file" id="photo-input" accept="image/*" ${carouselEnabled ? 'multiple' : ''} style="display:none" onchange="handlePhotoSelect(this.files)">

      <div class="photo-grid" id="photo-previews"></div>
      <div class="progress-bar" id="upload-progress" style="display:none"><div class="fill" id="upload-fill"></div></div>
      <div id="upload-result"></div>
    `;

    document.getElementById('tab-photos').innerHTML = html;

    // Drag & drop
    const dropZone = document.getElementById('photo-drop');
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      handlePhotoSelect(e.dataTransfer.files);
    });
  }

  window.handlePhotoSelect = async function (fileList) {
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;

    const carouselEnabled = storeConfig.features?.carousel !== false;
    if (!carouselEnabled && files.length > 1) {
      toast('Tu plan solo permite 1 foto por producto. Contactanos para el carrusel.', 'error');
      return;
    }

    const previews = document.getElementById('photo-previews');
    previews.innerHTML = '';
    files.forEach((f, i) => {
      const reader = new FileReader();
      reader.onload = e => {
        previews.innerHTML += `
          <div class="photo-item">
            <img src="${e.target.result}">
            <span class="num">${i + 1}</span>
          </div>
        `;
      };
      reader.readAsDataURL(f);
    });

    // Upload
    const progressBar = document.getElementById('upload-progress');
    const fill = document.getElementById('upload-fill');
    progressBar.style.display = 'block';

    const targetRow = parseInt(document.getElementById('photo-target').value);
    const urls = [];

    for (let i = 0; i < files.length; i++) {
      fill.style.width = `${((i) / files.length) * 100}%`;
      const url = await uploadFileToDrive(files[i]);
      if (url) urls.push(url);
    }

    fill.style.width = '100%';

    if (urls.length > 0 && targetRow > 0) {
      // Append to existing photos
      const product = products.find(p => p.rowIndex === targetRow);
      const allImages = [...(product?.images || []), ...urls];
      const imageStr = allImages.join(', ');

      await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: STORE_CONFIG.SHEET_ID,
        range: `G${targetRow}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[imageStr]] },
      });

      toast(`✅ ${urls.length} foto(s) subidas al producto`);
      await loadProducts();
    }

    document.getElementById('upload-result').innerHTML =
      `<div style="margin-top:12px;font-size:13px;color:var(--success);">✅ ${urls.length} foto(s) subidas</div>`;
  };

  async function uploadFileToDrive(file) {
    try {
      const metadata = {
        name: file.name,
        mimeType: file.type,
      };

      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', file);

      const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });

      const data = await res.json();

      // Make public
      await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}/permissions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      });

      return `https://lh3.googleusercontent.com/d/${data.id}`;
    } catch (e) {
      console.error('Upload error:', e);
      return null;
    }
  }

  // ============================================================
  // TOAST NOTIFICATIONS
  // ============================================================
  function toast(msg, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    container.appendChild(el);

    // Errores se muestran más tiempo para que el usuario pueda leerlos
    const duration = type === 'error' ? 8000 : 3000;
    setTimeout(() => el.remove(), duration);
  }

})();
