/**
 * /api/store-config — Persiste y devuelve la configuración de cada tienda
 * 
 * GET  ?store=viejatabernaok  → Devuelve { SHEET_ID: "...", ... }
 * POST { store, SHEET_ID }    → Guarda el SHEET_ID en Cloudflare KV
 * 
 * Requiere KV binding: STORE_CONFIG_KV
 */

export async function onRequest(context) {
  const { request, env } = context;

  // CORS headers
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-cache',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  // Verificar que KV está disponible
  if (!env.STORE_CONFIG_KV) {
    return new Response(
      JSON.stringify({ error: 'KV no configurado. Crear namespace STORE_CONFIG_KV en Cloudflare.' }),
      { status: 500, headers }
    );
  }

  try {
    // ── GET: Leer configuración de una tienda ──
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

    // ── POST: Guardar configuración de una tienda ──
    if (request.method === 'POST') {
      const body = await request.json();
      const { store, SHEET_ID } = body;

      if (!store || !SHEET_ID) {
        return new Response(
          JSON.stringify({ error: 'Faltan campos: store, SHEET_ID' }),
          { status: 400, headers }
        );
      }

      // Leer config existente y mergear
      const existing = await env.STORE_CONFIG_KV.get(`store:${store}`);
      let config = existing ? JSON.parse(existing) : {};
      config.SHEET_ID = SHEET_ID;
      config.updatedAt = new Date().toISOString();

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
