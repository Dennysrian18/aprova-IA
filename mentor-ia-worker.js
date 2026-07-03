/* ════════════════════════════════════════════════════════════════════
   MENTOR IA — Proxy (Cloudflare Worker) + RATE LIMIT
   --------------------------------------------------------------------
   Função: esconder a SUA chave do Gemini. O app do aluno chama este
   Worker; o Worker (e só ele) conhece a chave e fala com o Google.
   Assim NENHUM aluno precisa de chave, e a chave nunca aparece no site.

   NOVIDADE: RATE LIMIT (limite de requisições por IP). Protege a sua cota
   do Gemini contra abuso / robôs. Três modos, do melhor para o mais simples
   — o Worker detecta sozinho qual você configurou:

     (A) Binding nativo de Rate Limiting  → env.RATE_LIMITER   (recomendado)
     (B) KV Namespace  chamado            → env.RL             (fácil no painel)
     (C) Nenhum dos dois                  → limite "em memória" (básico,
                                            reinicia sozinho; serve de quebra-galho)

   ── COMO PUBLICAR (grátis) ──────────────────────────────────────────
   1. Crie conta em https://dash.cloudflare.com → Workers & Pages.
   2. "Create" → "Create Worker" → dê um nome (ex.: mentor-ia) → Deploy.
   3. "Edit code", apague tudo, cole ESTE arquivo inteiro e "Deploy".
   4. Settings → Variables and Secrets → "Add":
        • Secret    GEMINI_KEY          = sua chave do Google AI Studio
        • Variable  GEMINI_MODEL        = gemini-2.0-flash        (opcional)
        • Variable  ALLOWED_ORIGIN      = https://SEU-USUARIO.github.io  (recomendado)
        • Variable  RATE_LIMIT_PER_MIN  = 20    (nº máx. de mensagens por minuto/IP)
        • Variable  RATE_LIMIT_PER_DAY  = 300   (nº máx. de mensagens por dia/IP)
      Salve e dê "Deploy" de novo.

   ── LIGAR O RATE LIMIT (escolha UM) ─────────────────────────────────
   Opção B (KV — mais fácil pelo painel, recomendada p/ começar):
     • Workers & Pages → KV → "Create a namespace" → nome: mentor_rl.
     • Volte no Worker → Settings → Bindings → "Add" → KV namespace:
         Variable name: RL     |  KV namespace: mentor_rl     → Deploy.
   Opção A (binding nativo de Rate Limiting — precisa de wrangler.toml):
     [[ratelimits]]
       name = "RATE_LIMITER"
       namespace_id = "1001"
       simple = { limit = 20, period = 60 }   # period só aceita 10 ou 60
     (deploy via `wrangler deploy`).
   Se não configurar nenhum, o modo (C) em memória já limita o básico.

   5. Copie a URL do Worker (ex.: https://mentor-ia.SEU-USER.workers.dev)
      e cole em IA_PROXY_URL lá no topo do index.html.
   ════════════════════════════════════════════════════════════════════ */

export default {
  async fetch(request, env, ctx) {
    const ALLOW  = env.ALLOWED_ORIGIN || '*';
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOW,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };

    // Preflight CORS
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    // Bloqueia origens não autorizadas (se você configurou ALLOWED_ORIGIN)
    if (ALLOW !== '*' && origin && origin !== ALLOW) {
      return json({ error: 'Origem não autorizada.' }, 403, cors);
    }
    if (request.method !== 'POST') {
      return json({ error: 'Use POST.' }, 405, cors);
    }
    if (!env.GEMINI_KEY) {
      return json({ error: 'Servidor sem GEMINI_KEY configurada.' }, 500, cors);
    }

    // ── RATE LIMIT (por IP) ──────────────────────────────────────────
    const rl = await checkRate(request, env, ctx);
    if (!rl.ok) {
      const headers = { ...cors, 'Retry-After': String(rl.retry || 60) };
      const msg = rl.scope === 'day'
        ? 'Você atingiu o limite diário de mensagens da IA. Tente novamente amanhã. 🙂'
        : 'Muitas mensagens em pouco tempo. Espere alguns segundos e tente de novo. ⏳';
      // Retorna 429 com o texto amigável já em "text" para o app exibir direto.
      return json({ error: msg, text: msg, rateLimited: true, retryAfter: rl.retry || 60 }, 429, headers);
    }

    try {
      const payload = await request.json().catch(() => ({}));
      const { system, contents } = payload;
      if (!Array.isArray(contents) || !contents.length) {
        return json({ error: 'Campo "contents" vazio.' }, 400, cors);
      }
      // Limite de tamanho do payload — evita abuso e estouro de cota por mensagens gigantes.
      const approxLen = JSON.stringify(contents).length + (system ? String(system).length : 0);
      if (approxLen > 60000) {
        return json({ error: 'Mensagem muito longa. Reduza o texto e tente de novo.' }, 413, cors);
      }

      const MODEL = env.GEMINI_MODEL || 'gemini-2.0-flash';
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
                  MODEL + ':generateContent?key=' + env.GEMINI_KEY;

      const body = {
        contents,
        generationConfig: { temperature: 0.7, topP: 0.95, maxOutputTokens: 2048 },
      };
      if (system) body.system_instruction = { parts: [{ text: String(system) }] };

      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();

      if (!r.ok) {
        const msg = (data && data.error && data.error.message) || ('Erro ' + r.status);
        return json({ error: msg }, r.status, cors);
      }

      const cand = data.candidates && data.candidates[0];
      let text = (cand && cand.content && cand.content.parts)
        ? cand.content.parts.map((p) => p.text || '').join('')
        : '';
      if (!text && data.promptFeedback && data.promptFeedback.blockReason) {
        text = '⚠️ Sua mensagem foi bloqueada pelo filtro de segurança. Tente reformular a pergunta.';
      }
      return json({ text: text || 'Não consegui gerar uma resposta agora. Tente reformular.' }, 200, cors);
    } catch (e) {
      return json({ error: (e && e.message) || 'Erro interno do servidor.' }, 500, cors);
    }
  },
};

/* ─────────────────────── RATE LIMIT ───────────────────────
   Retorna { ok:true } ou { ok:false, retry:<segundos>, scope:'min'|'day' }.
   Ordem de preferência: binding nativo → KV → memória. */
async function checkRate(request, env, ctx) {
  const ip = request.headers.get('CF-Connecting-IP')
          || request.headers.get('X-Forwarded-For')
          || 'anon';
  const perMin = clampInt(env.RATE_LIMIT_PER_MIN, 20, 1, 1000);
  const perDay = clampInt(env.RATE_LIMIT_PER_DAY, 300, 1, 100000);

  // (A) Binding nativo de Rate Limiting da Cloudflare (o mais robusto/atômico)
  if (env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === 'function') {
    try {
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      return success ? { ok: true } : { ok: false, retry: 60, scope: 'min' };
    } catch (e) { /* cai para KV/memória */ }
  }

  // (B) KV Namespace: janela fixa de 1 min + teto diário
  if (env.RL && typeof env.RL.get === 'function') {
    try {
      const now = Date.now();
      const minWin = Math.floor(now / 60000);
      const dayKey = new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD
      const kMin = 'rl:' + ip + ':' + minWin;
      const kDay = 'rld:' + ip + ':' + dayKey;
      const [cMinRaw, cDayRaw] = await Promise.all([env.RL.get(kMin), env.RL.get(kDay)]);
      const cMin = parseInt(cMinRaw || '0', 10);
      const cDay = parseInt(cDayRaw || '0', 10);
      if (cMin >= perMin) {
        return { ok: false, retry: 60 - Math.floor((now % 60000) / 1000), scope: 'min' };
      }
      if (cDay >= perDay) {
        return { ok: false, retry: 3600, scope: 'day' };
      }
      // Incrementa (não é 100% atômico no KV, mas suficiente contra abuso).
      const write = Promise.all([
        env.RL.put(kMin, String(cMin + 1), { expirationTtl: 90 }),
        env.RL.put(kDay, String(cDay + 1), { expirationTtl: 86400 }),
      ]);
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(write); else await write;
      return { ok: true };
    } catch (e) { /* cai para memória */ }
  }

  // (C) Fallback em memória (por isolate; reinicia sozinho). Básico, mas melhor que nada.
  return memRate(ip, perMin);
}

const MEM = new Map(); // ip -> { count, reset }
function memRate(ip, perMin) {
  const now = Date.now();
  if (MEM.size > 5000) MEM.clear(); // evita crescer sem limite
  let e = MEM.get(ip);
  if (!e || now > e.reset) { e = { count: 0, reset: now + 60000 }; MEM.set(ip, e); }
  e.count++;
  if (e.count > perMin) return { ok: false, retry: Math.ceil((e.reset - now) / 1000), scope: 'min' };
  return { ok: true };
}

function clampInt(v, def, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      ...cors,
    },
  });
}
