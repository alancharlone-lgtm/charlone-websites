/**
 * Cloudflare Pages Function: /api/report-error
 * 
 * Recibe errores del admin-panel.js de TODAS las tiendas y los guarda
 * en Cloudflare KV para que podamos consultarlos remotamente.
 * 
 * Uso desde el cliente:
 *   fetch('/api/report-error', { method: 'POST', body: JSON.stringify({ ... }) })
 * 
 * Para ver errores:
 *   GET /api/report-error?key=ADMIN_SECRET_KEY
 *   GET /api/report-error?key=ADMIN_SECRET_KEY&store=viejatabernaok
 */

const ADMIN_KEY = 'ads-labs-2835';  // Clave para ver errores remotamente
const MAX_ERRORS_PER_STORE = 50;    // Máximo de errores guardados por tienda

export async function onRequestPost(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const body = await context.request.json();
    const { storeId, error, context: errContext, userAgent, timestamp } = body;

    if (!storeId || !error) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing params' }), 
        { status: 400, headers: corsHeaders });
    }

    // Construir entrada de error
    const entry = {
      ts: timestamp || new Date().toISOString(),
      store: storeId,
      error: String(error).substring(0, 500),  // Limitar tamaño
      context: String(errContext || '').substring(0, 200),
      ua: String(userAgent || '').substring(0, 150),
      ip: context.request.headers.get('CF-Connecting-IP') || 'unknown',
    };

    // Guardar en KV (si está disponible) o en un log simple
    const kv = context.env.ERROR_LOG;
    if (kv) {
      // Leer errores existentes
      const key = `errors:${storeId}`;
      let existing = [];
      try {
        const raw = await kv.get(key);
        if (raw) existing = JSON.parse(raw);
      } catch (e) { /* empty */ }

      // Agregar nuevo y limitar cantidad
      existing.unshift(entry);
      if (existing.length > MAX_ERRORS_PER_STORE) {
        existing = existing.slice(0, MAX_ERRORS_PER_STORE);
      }

      await kv.put(key, JSON.stringify(existing), { expirationTtl: 60 * 60 * 24 * 30 }); // 30 días

      // También guardar un índice global de tiendas con errores
      let storeIndex = [];
      try {
        const raw = await kv.get('errors:_index');
        if (raw) storeIndex = JSON.parse(raw);
      } catch (e) { /* empty */ }
      if (!storeIndex.includes(storeId)) {
        storeIndex.push(storeId);
        await kv.put('errors:_index', JSON.stringify(storeIndex));
      }
    }

    // Log a console de Cloudflare (siempre visible en el dashboard)
    console.log(`[ERROR] ${storeId}: ${entry.error} | ${entry.context}`);

    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });

  } catch (err) {
    console.error('report-error handler failed:', err);
    return new Response(JSON.stringify({ ok: false }), { status: 500, headers: corsHeaders });
  }
}

// GET: Ver errores (protegido con clave)
export async function onRequestGet(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  const url = new URL(context.request.url);
  const key = url.searchParams.get('key');
  const storeFilter = url.searchParams.get('store');

  if (key !== ADMIN_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), 
      { status: 401, headers: corsHeaders });
  }

  const kv = context.env.ERROR_LOG;
  if (!kv) {
    return new Response(JSON.stringify({ 
      error: 'KV not configured. Add ERROR_LOG binding in Cloudflare Pages settings.',
      hint: 'Settings → Functions → KV namespace bindings → Variable name: ERROR_LOG'
    }), { status: 503, headers: corsHeaders });
  }

  try {
    if (storeFilter) {
      // Errores de una tienda específica
      const raw = await kv.get(`errors:${storeFilter}`);
      const errors = raw ? JSON.parse(raw) : [];
      return new Response(JSON.stringify({ store: storeFilter, count: errors.length, errors }), 
        { headers: corsHeaders });
    } else {
      // Resumen de todas las tiendas
      const indexRaw = await kv.get('errors:_index');
      const storeIndex = indexRaw ? JSON.parse(indexRaw) : [];
      
      const summary = {};
      for (const sid of storeIndex) {
        const raw = await kv.get(`errors:${sid}`);
        const errors = raw ? JSON.parse(raw) : [];
        summary[sid] = {
          count: errors.length,
          lastError: errors[0] || null,
        };
      }

      return new Response(JSON.stringify({ stores: storeIndex.length, summary }), 
        { headers: corsHeaders });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), 
      { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
