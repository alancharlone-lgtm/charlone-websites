/**
 * Cloudflare Pages Function: /api/verify-admin
 * 
 * Valida el token de Google OAuth en el SERVIDOR.
 * El atacante NO puede modificar este código — corre en Cloudflare, no en el navegador.
 * 
 * SECURITY: CORS restringido a dominios propios.
 */

const ALLOWED_ADMINS = {
  'viejatabernaok': ['alancharlone@gmail.com', 'luci.charlone@gmail.com'],
};

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
  const corsHeaders = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const body = await context.request.json();
    const { accessToken, storeId } = body;

    if (!accessToken || !storeId) {
      return new Response(JSON.stringify({ 
        allowed: false, 
        error: 'Missing accessToken or storeId' 
      }), { status: 400, headers: corsHeaders });
    }

    // Verificar token con Google (server-side, imposible de falsificar)
    const googleRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!googleRes.ok) {
      return new Response(JSON.stringify({ 
        allowed: false, 
        error: 'Invalid Google token' 
      }), { status: 401, headers: corsHeaders });
    }

    const userInfo = await googleRes.json();
    const email = (userInfo.email || '').toLowerCase().trim();

    // Verificar contra la lista de admins permitidos
    const allowedEmails = ALLOWED_ADMINS[storeId] || [];
    const isAllowed = allowedEmails.includes(email);

    return new Response(JSON.stringify({
      allowed: isAllowed,
      email: isAllowed ? email : undefined,
      name: isAllowed ? userInfo.name : undefined,
    }), { 
      status: isAllowed ? 200 : 403, 
      headers: corsHeaders 
    });

  } catch (err) {
    return new Response(JSON.stringify({ 
      allowed: false, 
      error: 'Server error' 
    }), { status: 500, headers: corsHeaders });
  }
}

// Handle CORS preflight
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
