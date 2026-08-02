import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

export default async function handler(req, res) {
  // Daily.co envia GET para validar o endpoint ao registrar
  if (req.method === 'GET') return res.status(200).json({ ok: true });
  if (req.method !== 'POST') return res.status(405).end();

  // Verifica segredo compartilhado enviado pelo Daily.co no header
  const DAILY_WEBHOOK_SECRET = process.env.DAILY_WEBHOOK_SECRET;
  if (!DAILY_WEBHOOK_SECRET) {
    console.error('daily-webhook: DAILY_WEBHOOK_SECRET não configurado');
    return res.status(500).json({ error: 'webhook não configurado' });
  }
  const sentSecret = req.headers['x-daily-webhook-secret'] || req.headers['authorization'] || '';
  const clean = sentSecret.replace(/^Bearer\s+/i, '').trim();
  // Comparação em tempo constante (evita timing attack no segredo do webhook).
  const eqCt = (a, b) => { let d = a.length ^ b.length; for (let i = 0; i < b.length; i++) d |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i); return d === 0; };
  if (!eqCt(clean, DAILY_WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Webhook secret inválido' });
  }

  const event = req.body;
  const tipo = event?.action;

  // Só processa eventos de transcrição concluída
  if (tipo !== 'transcription-ready') {
    return res.status(200).json({ ok: true, skipped: tipo });
  }

  const roomName = event?.room_name || event?.room;
  const transcricao = event?.transcription?.text || event?.transcript || '';
  const duracaoSeg = event?.duration || null;

  if (!roomName) return res.status(200).json({ ok: true, skipped: 'sem_room' });

  // Busca a solicitação pelo nome da sala (prefixo tsn-{8chars})
  const prefixo = roomName.match(/^tsn-([a-f0-9]{8})/)?.[1];
  if (!prefixo) return res.status(200).json({ ok: true, skipped: 'room_desconhecida' });

  const { data: sol } = await supabase
    .from('solicitacoes')
    .select('id')
    .ilike('google_meet_link', `%${prefixo}%`)
    .maybeSingle();

  if (!sol) {
    console.warn('Daily webhook: solicitação não encontrada para room', roomName);
    return res.status(200).json({ ok: true, skipped: 'solicitacao_nao_encontrada' });
  }

  // IDEMPOTÊNCIA: webhook reentrega em timeout/5xx. Sem chave, cada reentrega duplicava a
  // transcrição na ficha da reunião E repetia o extrairLicoes() abaixo (Gemini, pago),
  // poluindo o aprendizado com o mesmo conteúdo. `daily_room_name` é único no banco
  // (transcricoes_reuniao_room_uidx) — quem decide o empate é o índice, não um check-then-insert
  // que perderia a corrida entre duas reentregas simultâneas.
  const { data: inseridas, error } = await supabase
    .from('transcricoes_reuniao')
    .upsert({
      solicitacao_id: sol.id,
      transcricao,
      duracao_seg: duracaoSeg,
      daily_room_name: roomName,
    }, { onConflict: 'daily_room_name', ignoreDuplicates: true })
    .select('id');

  if (error) {
    console.error('Daily webhook Supabase error:', error.message);
    return res.status(500).json({ error: error.message });
  }
  // Nada inserido = reentrega do MESMO evento: responde ok e NÃO repete a extração paga.
  if (!inseridas?.length) {
    return res.status(200).json({ ok: true, duplicado: true, solicitacao_id: sol.id });
  }

  // APRENDIZADO: extrai LIÇÕES da transcrição (Gemini, barato) e roteia para o agente
  // certo (mercadológico/documental/defesa). Best-effort — nunca derruba o webhook.
  try { await extrairLicoes(transcricao); } catch (e) { console.warn('licoes:', e?.message); }

  return res.status(200).json({ ok: true, solicitacao_id: sol.id });
}

// Extrai lições da transcrição da reunião e grava nas tabelas de aprendizado dos
// agentes. Cada lição é etiquetada com o agente-alvo. Roda no Gemini (custo baixo).
async function extrairLicoes(transcricao) {
  const GEMINI_KEY = (process.env.GEMINI_API_KEY || '').trim();
  const texto = String(transcricao || '').trim();
  if (!GEMINI_KEY || texto.length < 200) return; // sem chave ou transcrição irrelevante

  const prompt = `Você analisa a TRANSCRIÇÃO de uma reunião entre analista e cliente sobre a arrematação de um imóvel em leilão. Extraia LIÇÕES OBJETIVAS que melhorem os relatórios automáticos da BidPro — o que o analista corrigiu, apontou que a análise errou, ou que o cliente perguntou e faltou no relatório. Cada lição é etiquetada com o agente que deve aprender: "mercadologico" (preço/mercado/viabilidade), "documental" (ônus/ocupação/jurídico) ou "defesa" (veredito/decisão). Se não houver lição clara, retorne listas vazias. NÃO invente.

TRANSCRIÇÃO:
${texto.slice(0, 12000)}

Retorne APENAS este JSON (sem markdown):
{ "licoes": [ { "agente": "mercadologico|documental|defesa", "campo": "", "valor_ia": "o que o sistema disse (se citado)", "valor_real": "a correção do analista", "observacao": "a lição em 1 frase" } ] }`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  let parsed = null;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.GEMINI_MODEL || 'gemini-2.5-flash')}:generateContent`,
      { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_KEY }, signal: ctrl.signal,
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 2000, thinkingConfig: { thinkingBudget: 0 }, temperature: 0.3 } }) },
    );
    if (!r.ok) return;
    const data = await r.json();
    const out = (data?.candidates?.[0]?.content?.parts || []).map(p => (p && typeof p.text === 'string' ? p.text : '')).join('');
    const m = out.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : null;
  } catch { return; } finally { clearTimeout(t); }

  const licoes = Array.isArray(parsed?.licoes) ? parsed.licoes : [];
  const TABELA = { mercadologico: 'mercado_aprendizado', documental: 'juridico_aprendizado', defesa: 'laudo_aprendizado' };
  for (const l of licoes) {
    if (!l || (!l.valor_real && !l.observacao)) continue;
    const tabela = TABELA[l.agente];
    if (!tabela) continue;
    try {
      if (tabela === 'juridico_aprendizado') {
        await supabase.from(tabela).insert({ campo: l.campo || null, valor_ia: l.valor_ia || null, valor_advogado: l.valor_real || null, observacao: l.observacao || null });
      } else if (tabela === 'laudo_aprendizado') {
        await supabase.from(tabela).insert({ veredito_ia: l.valor_ia || null, veredito_real: l.valor_real || null, observacao: l.observacao || null });
      } else {
        await supabase.from(tabela).insert({ campo: l.campo || null, valor_ia: l.valor_ia || null, valor_real: l.valor_real || null, observacao: l.observacao || null, origem: 'reuniao' });
      }
    } catch { /* uma lição que falha não trava as demais */ }
  }
}
