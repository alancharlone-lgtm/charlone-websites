/**
 * Cloudflare Pages Function: /api/verify-admin
 * 
 * Valida el token de Google OAuth en el SERVIDOR.
 * El atacante NO puede modificar este código — corre en Cloudflare, no en el navegador.
 * 
 * Flow:
 *   1. Cliente envía el access_token de Google
 *   2. Este Worker llama a Google para verificar el email
 *   3. Compara contra la lista de emails permitidos (hardcoded ACÁ, no en el cliente)
 *   4. Retorna allowed: true/false
 */

// ============================================================
// EMAILS PERMITIDOS — Solo se pueden cambiar con git push
// ============================================================
const ALLOWED_ADMINS = {
  'viejatabernaok': ['alancharlone@gmail.com'],
  // Agregar más tiendas acá:
  // 'otratienda': ['otro@gmail.com'],
};

export async function onRequestPost(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
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
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
