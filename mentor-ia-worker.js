/* ════════════════════════════════════════════════════════════════════
   MENTOR IA — Proxy (Cloudflare Worker)
   --------------------------------------------------------------------
   Função: esconder a SUA chave do Gemini. O app do aluno chama este
   Worker; o Worker (e só ele) conhece a chave e fala com o Google.
   Assim NENHUM aluno precisa de chave, e a chave nunca aparece no site.

   Como publicar (grátis):
   1. Crie conta em https://dash.cloudflare.com  →  Workers & Pages.
   2. "Create" → "Create Worker" → dê um nome (ex.: mentor-ia) → Deploy.
   3. "Edit code", apague tudo, cole ESTE arquivo inteiro e "Deploy".
   4. Settings → Variables and Secrets → "Add":
        • Secret  GEMINI_KEY      = sua chave do Google AI Studio
        • (opcional) Variable GEMINI_MODEL    = gemini-2.0-flash
        • (recomendado) Variable ALLOWED_ORIGIN = https://SEU-USUARIO.github.io
      Salve e dê "Deploy" de novo.
   5. Copie a URL do Worker (ex.: https://mentor-ia.SEU-USER.workers.dev)
      e cole em IA_PROXY_URL lá no topo do index.html.
   Pronto: a conversa livre passa a funcionar para todos, de graça,
   dentro da cota do Gemini. Custo só existe se você ativar billing.
   ════════════════════════════════════════════════════════════════════ */

export default {
  async fetch(request, env) {
    const ALLOW  = env.ALLOWED_ORIGIN || '*';
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOW,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
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

    try {
      const payload = await request.json().catch(() => ({}));
      const { system, contents } = payload;
      if (!Array.isArray(contents) || !contents.length) {
        return json({ error: 'Campo "contents" vazio.' }, 400, cors);
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

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}
