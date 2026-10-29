// meta.js — Meta Cloud API configuration and request helpers.
// Values come from environment only and are NEVER returned, logged or
// persisted by this module; callers receive booleans and public launch
// parameters only. Mock base URL exists for tests, never production.
const crypto = require('crypto');
function metaConfig() {
  const mock = process.env.META_MOCK_BASE_URL || '';
  const version = process.env.WHATSAPP_API_VERSION || 'v26.0';
  const token = process.env.WHATSAPP_ACCESS_TOKEN || '';
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '';
  const appId = process.env.WHATSAPP_APP_ID || '';
  const configId = process.env.WHATSAPP_CONFIG_ID || '';
  const appSecret = process.env.WHATSAPP_APP_SECRET || '';
  return {
    base: (mock || 'https://graph.facebook.com').replace(/\/+$/, ''),
    version, token, phoneId, wabaId, mock: !!mock,
    configured: !!(token && phoneId && wabaId),
    appId, configId,
    embeddedConfigured: !!(appId && configId && appSecret),
    embedded: {
      app_id_configured: !!appId, config_id_configured: !!configId,
      app_secret_configured: !!appSecret,
    },
  };
}
function embeddedLaunchParams(cfg) {
  return {
    dialog_base: 'https://www.facebook.com',
    dialog_path: '/' + cfg.version + '/dialog/oauth',
    client_id: cfg.appId, config_id: cfg.configId,
    response_type: 'code', override_default_response_type: true,
    scope: 'whatsapp_business_management,whatsapp_business_messaging',
  };
}
function metaErrorInfo(parsed) {
  const err = parsed && parsed.error;
  if (err && typeof err === 'object') {
    return { meta_error_code: err.code !== undefined ? err.code : null, error: String(err.message || 'meta request failed').slice(0, 500) };
  }
  return { error: 'meta request failed' };
}
function safeEqualStr(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
function metaRequest(method, path, bodyObj, tokenOverride) {
  const cfg = metaConfig();
  const token = tokenOverride !== undefined ? tokenOverride : cfg.token;
  return new Promise((resolve) => {
    let url;
    try { url = new URL(`${cfg.base}/${cfg.version}${path}`); }
    catch { return resolve({ ok: false, ...metaErrorInfo(null) }); }
    const lib = url.protocol === 'http:' ? require('http') : require('https');
    const payload = bodyObj ? JSON.stringify(bodyObj) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const req = lib.request(url, { method, headers, timeout: 10000 }, (resp) => {
      let data = '';
      resp.on('data', (c) => { data += c; });
      resp.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch {}
        if (resp.statusCode >= 200 && resp.statusCode < 300) resolve({ ok: true, status: resp.statusCode, data: parsed });
        else resolve({ ok: false, status: resp.statusCode, ...metaErrorInfo(parsed) });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'meta request timed out' }); });
    req.on('error', () => resolve({ ok: false, error: 'meta request failed' }));
    if (payload) req.write(payload);
    req.end();
  });
}
module.exports = { metaConfig, embeddedLaunchParams, metaErrorInfo, safeEqualStr, metaRequest };
