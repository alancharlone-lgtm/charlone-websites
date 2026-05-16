/**
 * /api/store-config — Persiste y devuelve la configuración de cada tienda
 * 
 * GET  ?store=viejatabernaok  → Devuelve { SHEET_ID: "...", ... } (público)
 * POST { store, SHEET_ID, accessToken }  → Guarda (requiere OAuth válido)
 * 
 * Requiere KV binding: STORE_CONFIG_KV
 * 
 * SECURITY: POST requiere token OAuth válido y email en ALLOWED_ADMINS.
 */

const ALLOWED_ADMINS = {
  'viejatabernaok': ['alancharlone@gmail.com', 'luci.charlone@gmail.com', 'luci.charlone@gmial.com'],
};

async function verifyGoogleToken(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) return null;
  const info = await res.json();
  return (info.email || '').toLowerCase().trim();
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  
  // CORS: solo dominios propios
  const ALLOWED_ORIGINS = [
    'https://www.viejataberna.com',
    'https://viejataberna.com',
    'https://viejatabernaok.pages.dev',
  ];
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-cache',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (!env.STORE_CONFIG_KV) {
    return new Response(
      JSON.stringify({ error: 'KV no configurado.' }),
      { status: 500, headers }
    );
  }

  try {
    // ── GET: Leer configuración (público, solo lectura) ──
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const storeId = url.searchParams.get('store');
      if (!storeId) {
        return new Response(
          JSON.stringify({ error: 'Falta parámetro ?store=ID' }),
          { status: 400, headers }
        );
      }
      const raw = await env.STORE_CONFIG_KV.get(`store:${storeId}`);
      if (!raw) {
        return new Response(
          JSON.stringify({ SHEET_ID: null }),
          { status: 200, headers }
        );
      }
      return new Response(raw, { status: 200, headers });
    }

    // ── POST: Guardar configuración (REQUIERE AUTH) ──
    if (request.method === 'POST') {
      const body = await request.json();
      const { store, SHEET_ID, accessToken } = body;

      if (!store || !SHEET_ID) {
        return new Response(
          JSON.stringify({ error: 'Faltan campos: store, SHEET_ID' }),
          { status: 400, headers }
        );
      }

      // ── AUTENTICACIÓN: verificar token OAuth ──
      if (!accessToken) {
        return new Response(
          JSON.stringify({ error: 'Se requiere accessToken para modificar la configuración' }),
          { status: 401, headers }
        );
      }

      const email = await verifyGoogleToken(accessToken);
      if (!email) {
        return new Response(
          JSON.stringify({ error: 'Token de Google inválido o expirado' }),
          { status: 401, headers }
        );
      }

      // ── AUTORIZACIÓN: verificar email contra lista de admins ──
      const allowedEmails = ALLOWED_ADMINS[store] || [];
      if (!allowedEmails.includes(email)) {
        return new Response(
          JSON.stringify({ error: 'No autorizado para esta tienda' }),
          { status: 403, headers }
        );
      }

      // ── ESCRITURA: solo si pasó auth + authz ──
      const existing = await env.STORE_CONFIG_KV.get(`store:${store}`);
      let config = existing ? JSON.parse(existing) : {};
      config.SHEET_ID = SHEET_ID;
      config.updatedAt = new Date().toISOString();
      config.updatedBy = email;

      await env.STORE_CONFIG_KV.put(`store:${store}`, JSON.stringify(config));

      return new Response(
        JSON.stringify({ ok: true, store, SHEET_ID }),
        { status: 200, headers }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Método no soportado' }),
      { status: 405, headers }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers }
    );
  }
}
