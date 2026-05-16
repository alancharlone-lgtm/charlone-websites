/**
 * /api/report-error — Recibe y loguea errores del admin panel
 * SECURITY: CORS restringido a dominios propios.
 */

const ALLOWED_ORIGINS = [
  'https://www.viejataberna.com',
  'https://viejataberna.com',
  'https://viejatabernaok.pages.dev',
];

function getCorsOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

export async function onRequestPost(context) {
  const corsOrigin = getCorsOrigin(context.request);
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  try {
    const body = await context.request.json();
    console.log('[ERROR REPORT]', JSON.stringify(body));
    return new Response(JSON.stringify({ received: true }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

export async function onRequestOptions(context) {
  const corsOrigin = getCorsOrigin(context.request);
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
