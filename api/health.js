module.exports = function health(req, res){
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true,
    supabaseUrlSet: !!process.env.SUPABASE_URL,
    supabaseKeySet: !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY),
    sheetsWebhookSet: !!process.env.GOOGLE_SHEETS_WEBHOOK_URL
  }));
};
