/**
 * /api/parecer-pre-leilao-cron — o parecer do escritório ANTES do leilão vira aprendizado do documental
 * (pendência #492, 16/11, pedido do dono: "para o agente que cuida dos relatórios documentais aprender com
 * as informações fornecidas pelo advogado").
 *
 * O "Apoio jurídico" (api/enviar-email-caso.js) sai sem caso: a resposta do escritório entra em email_caixa
 * com caso_id nulo e resposta_de = o envio. Os outros crons de aprendizado só leem CASOS (pós-arremate), e
 * o parecer de Capão da Canoa (12 páginas, 4 correções ao nosso relatório) só virou lição porque foi lido à
 * mão. Aqui, para cada resposta nova:
 *   1. só vale remetente de escritório ATIVO em juridico_destinatarios (mesmo domínio) — parceiro de crédito
 *      que respondeu na cadeia não é parecer;
 *   2. acha o lote pelo envio original (email_caixa.resend_email_id → caso_emails_enviados.imovel_id);
 *   3. lê o texto da resposta (sem o trecho citado) e os PDFs anexos já arquivados no bucket `documentos`;
 *   4. pega o relatório documental do lote que existia no envio (de quem enviou, se houver);
 *   5. a IA confronta os dois e devolve divergências (o que o relatório disse × o que o advogado corrigiu) e
 *      lições gerais; tudo entra em juridico_aprendizado (fonte 'parecer_pre_leilao'), que o
 *      gerar-documental já lê com prioridade para correção do advogado (valor_ia preenchido).
 * Controle em parecer_pre_leilao_lido (uma linha por e-mail). Falha de leitura ou de IA grava motivo 'falha'
 * e a resposta volta à fila até 3 tentativas; nada é dado como lido sem ter sido lido.
 * `?seco=1` mostra o confronto sem gravar. `?email=<uuid>` força uma resposta (mesmo já lida, só com seco).
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { isCronAuthorized } from './_auth.js';
import { iaTexto } from './_claude.js';
import { carregarPDFParse } from './_pdf-safe.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BASE         = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
const sb  = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...hdr, ...(opts.headers || {}) } });
const MAX_POR_RODADA = 3;
const MAX_TENTATIVAS = 3;
const MAX_PDF_BYTES  = 8 * 1024 * 1024;
const RE_UUID = /^[0-9a-f-]{36}$/i;

async function ler(path) {
  const r = await sb(path);
  if (!r.ok) throw new Error(`leitura ${path.split('?')[0]} HTTP ${r.status}`);
  return r.json();
}

const SISTEMA = `Você é o revisor jurídico de uma assessoria de leilões de imóveis. Recebe (A) o relatório documental que a empresa gerou por IA para um lote e enviou ao escritório de advocacia antes do leilão e (B) a resposta do escritório (texto e parecer anexo). Seu trabalho é ensinar o gerador de relatórios a errar menos. Responda SOMENTE com JSON válido:
{"eh_parecer":true|false,"divergencias":[{"campo":"tema curto em snake_case, ex.: debitos:hipoteca","valor_ia":"o que o relatório A afirmou ou deixou de dizer, em 1 frase","valor_advogado":"a regra correta segundo o escritório, escrita como instrução para relatórios FUTUROS, 1-3 frases","recorte":"geral|uf"}],"licoes":[{"tema":"curto","licao":"regra geral que o escritório afirmou e que o relatório deveria seguir, 1-2 frases","recorte":"geral|uf"}]}
Regras: eh_parecer=false quando B não analisa o imóvel (agradecimento, recusa, assunto de crédito ou comercial, só "segue anexo" sem anexo legível); nesse caso devolva listas vazias. Divergência só quando B corrige, contradiz ou acrescenta algo relevante que A errou ou omitiu; o que A acertou não entra. Lição só se for regra reaproveitável em OUTROS imóveis, nunca um fato isolado deste lote. recorte=geral para lei federal (CPC, CC, CTN, jurisprudência do STJ) e prática nacional; uf só quando depender de norma ou prática do estado. Nunca invente fundamento legal que B não citou. NUNCA cite nome, CPF, número de processo, matrícula ou endereço de pessoa ou do imóvel: o texto vai para relatórios de OUTROS clientes. No máximo 6 divergências e 4 lições. Sem travessões no texto.`;

function lerJSON(txt) {
  const ini = txt.indexOf('{'), fim = txt.lastIndexOf('}');
  if (ini < 0 || fim < 0) return null;
  try { return JSON.parse(txt.slice(ini, fim + 1)); } catch { return null; }
}

// A resposta traz o nosso pedido citado embaixo; só o que o escritório escreveu interessa.
export function semCitacao(texto) {
  const linhas = String(texto || '').split(/\r?\n/);
  const out = [];
  for (const l of linhas) {
    if (/^\s*(Em .{5,120}escreveu:|On .{5,120}wrote:|De:\s|From:\s|-{2,}\s*Original|Enviada em:)/i.test(l)) break;
    // O Gmail quebra o cabeçalho da citação em duas linhas ("Em qui., 12 de nov. ... de Araujo" /
    // "(BidPro Brasil) <...> escreveu:"): ao achar o fim, tira também o começo que já tinha entrado.
    if (/(escreveu|wrote):\s*$/i.test(l)) {
      for (let k = 0; k < 2 && out.length; k++) {
        const ult = out.pop();
        if (/^\s*(Em|On)\s/i.test(ult)) break;
        if (k === 1) out.push(ult); // não era o começo do cabeçalho: devolve
      }
      break;
    }
    if (/^\s*>/.test(l)) continue;
    out.push(l);
  }
  return out.join('\n').trim();
}

async function textoDoPdf(arquivo) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/documentos/${arquivo.split('/').map(encodeURIComponent).join('/')}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }, signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`anexo ${arquivo} HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_PDF_BYTES) throw new Error(`anexo ${arquivo} com ${buf.length} bytes (teto ${MAX_PDF_BYTES})`);
  const PDFParse = await carregarPDFParse();
  const parser = new PDFParse({ data: buf });
  try { return String((await parser.getText())?.text || '').trim(); }
  finally { await parser.destroy().catch(() => {}); }
}

// Recorta do relatório o que o advogado avalia (riscos, débitos, parecer, processo), sem estourar o prompt.
export function resumoDocumental(result) {
  const r = result || {};
  // Chaves conferidas no result real (documental d2cd3b89, 16/11): parecer, nivelRisco, riscos,
  // pontosAtencao, lacunas, pendencias, raioX.*, extracao.debitosDiscriminados, cnj.parecer.
  const pick = {
    parecer: r.parecer ?? null, nivelRisco: r.nivelRisco ?? null, confianca: r.confianca ?? null,
    riscos: r.riscos ?? null, pontosAtencao: r.pontosAtencao ?? null, lacunas: r.lacunas ?? null, pendencias: r.pendencias ?? null,
    raioX: r.raioX ? { debitos: r.raioX.debitos, ocupacaoDetalhe: r.raioX.ocupacaoDetalhe, direitoPreferencia: r.raioX.direitoPreferencia,
      certidoesRecomendadas: r.raioX.certidoesRecomendadas, fraudeExecucao: r.raioX.fraudeExecucao } : null,
    debitosDiscriminados: r.extracao?.debitosDiscriminados ?? null,
    processo: r.cnj?.parecer ?? null,
  };
  // Formato desconhecido (nenhuma chave conhecida): manda o JSON inteiro em vez de um recorte vazio.
  const conhecido = Object.values(pick).some((v) => v != null);
  return JSON.stringify(conhecido ? pick : r).slice(0, 16000);
}

async function marcar(emailId, linha, { seco, tentativasAntes = 0 }) {
  if (seco) return;
  const corpo = { email_id: emailId, tentativas: tentativasAntes + 1, lido_em: new Date().toISOString(), ...linha };
  const r = await sb('parecer_pre_leilao_lido', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(corpo) });
  const gravado = r.ok ? await r.json().catch(() => []) : [];
  if (!gravado.length) throw new Error(`controle do e-mail ${emailId} não gravado: HTTP ${r.status}`);
}

async function processar(email, { seco, tentativasAntes, dominiosJuridico }) {
  const dominio = String(email.de_email || '').toLowerCase().split('@')[1] || '';
  if (!dominiosJuridico.has(dominio)) {
    await marcar(email.id, { motivo: 'remetente_nao_juridico', detalhe: dominio }, { seco, tentativasAntes });
    return { email: email.id, motivo: 'remetente_nao_juridico' };
  }
  const [envio] = await ler(`email_caixa?id=eq.${email.resposta_de}&select=id,resend_email_id,enviado_por,criado_em`);
  const [aud] = envio?.resend_email_id ? await ler(`caso_emails_enviados?resend_id=eq.${encodeURIComponent(envio.resend_email_id)}&imovel_id=not.is.null&select=imovel_id&limit=1`) : [];
  const imovelId = aud?.imovel_id || null;
  if (!imovelId) {
    await marcar(email.id, { motivo: 'sem_lote' }, { seco, tentativasAntes });
    return { email: email.id, motivo: 'sem_lote' };
  }
  const [lote] = await ler(`imoveis_leilao?id=eq.${imovelId}&select=id,estado,modalidade`);
  // O relatório que o escritório leu: o de quem enviou, gerado até o envio; senão o mais recente até o envio.
  const ate = encodeURIComponent(new Date(new Date(envio.criado_em).getTime() + 5 * 60e3).toISOString());
  const docs = await ler(`analises_documental?imovel_id=eq.${imovelId}&updated_at=lte.${ate}&select=id,user_id,result,updated_at&order=updated_at.desc&limit=5`);
  const doc = docs.find((d) => d.user_id === envio.enviado_por) || docs[0];
  if (!doc) {
    await marcar(email.id, { imovel_id: imovelId, motivo: 'sem_relatorio' }, { seco, tentativasAntes });
    return { email: email.id, motivo: 'sem_relatorio' };
  }

  const partes = [];
  const corpo = semCitacao(email.texto);
  if (corpo) partes.push(`TEXTO DO E-MAIL:\n${corpo.slice(0, 4000)}`);
  const pdfs = (email.anexos || []).filter((a) => a?.arquivo && /\.pdf$/i.test(a.arquivo)).slice(0, 3);
  for (const a of pdfs) {
    const t = await textoDoPdf(a.arquivo); // falha de leitura LANÇA: o e-mail não é dado como lido
    if (t) partes.push(`PARECER ANEXO (${a.nome || 'PDF'}):\n${t.slice(0, 30000)}`);
  }
  const anexoSemArquivo = (email.anexos || []).some((a) => /\.pdf$/i.test(a?.nome || '') && !a?.arquivo);
  if (anexoSemArquivo) throw new Error('PDF anexo ainda não arquivado no bucket (arquivar-anexos-email-cron): tentar na próxima rodada');

  const prompt = `(A) RELATÓRIO DOCUMENTAL DA EMPRESA (JSON):\n${resumoDocumental(doc.result)}\n\n(B) RESPOSTA DO ESCRITÓRIO:\n${partes.join('\n\n') || '(vazia)'}`;
  const ia = await iaTexto({ system: SISTEMA, prompt: prompt.slice(0, 60000), maxTokens: 2000, primario: 'claude', timeoutMs: 90000 });
  const json = ia?.texto ? lerJSON(ia.texto) : null;
  if (!json) throw new Error(ia ? 'resposta da IA não é JSON' : 'IA indisponível');

  const uf = lote?.estado || null;
  const modalidade = lote?.modalidade || null;
  const obs = `Parecer jurídico pré-leilão (e-mail ${email.id}, ${String(email.criado_em).slice(0, 10)}) sobre o relatório documental ${doc.id}.`;
  const linhas = [];
  if (json.eh_parecer) {
    for (const d of (json.divergencias || []).slice(0, 6)) {
      if (!d?.valor_advogado) continue;
      linhas.push({ caso_id: null, imovel_id: imovelId, fonte: 'parecer_pre_leilao', uf: d.recorte === 'uf' ? uf : null, modalidade,
        campo: String(d.campo || 'geral').slice(0, 80), valor_ia: d.valor_ia ? String(d.valor_ia).slice(0, 600) : null,
        valor_advogado: String(d.valor_advogado).slice(0, 900), observacao: obs });
    }
    for (const l of (json.licoes || []).slice(0, 4)) {
      if (!l?.licao) continue;
      linhas.push({ caso_id: null, imovel_id: imovelId, fonte: 'parecer_pre_leilao', uf: l.recorte === 'uf' ? uf : null, modalidade,
        campo: `licao_escritorio:${String(l.tema || 'geral').slice(0, 60)}`, valor_ia: null,
        valor_advogado: String(l.licao).slice(0, 900), observacao: obs });
    }
  }
  if (seco) return { email: email.id, imovel: imovelId, relatorio: doc.id, eh_parecer: !!json.eh_parecer, pdfs: pdfs.length, licoes: linhas };

  if (linhas.length) {
    const r = await sb('juridico_aprendizado', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(linhas) });
    const gravadas = r.ok ? await r.json().catch(() => []) : [];
    if (gravadas.length !== linhas.length) throw new Error(`gravar lições HTTP ${r.status}: gravou ${gravadas.length} de ${linhas.length}`);
  }
  await marcar(email.id, { imovel_id: imovelId, analise_id: doc.id, licoes: linhas.length, motivo: linhas.length ? 'ok' : 'sem_licao' }, { seco, tentativasAntes });
  return { email: email.id, imovel: imovelId, relatorio: doc.id, licoes: linhas.length };
}

async function handler(req) {
  if (!isCronAuthorized(req)) return new Response(JSON.stringify({ error: 'não autorizado' }), { status: 401 });
  const url = new URL(req.url, BASE);
  const seco = url.searchParams.get('seco') === '1';
  const forcado = url.searchParams.get('email');
  const res = { seco, lidos: 0, licoes: 0, falhas: 0, resultados: [] };
  try {
    if (forcado && !RE_UUID.test(forcado)) throw new Error('email inválido');
    if (forcado && !seco) throw new Error('?email= só com ?seco=1 (reler um parecer já lido duplicaria as lições)');
    const dests = await ler('juridico_destinatarios?ativo=eq.true&select=email');
    const dominiosJuridico = new Set(dests.map((d) => String(d.email || '').toLowerCase().split('@')[1]).filter(Boolean));
    const campos = 'id,de_email,texto,anexos,resposta_de,criado_em';
    let alvos;
    if (forcado) {
      alvos = await ler(`email_caixa?id=eq.${forcado}&select=${campos}`);
    } else {
      const desde = new Date(Date.now() - 60 * 864e5).toISOString();
      const novas = await ler(`email_caixa?direcao=eq.entrada&categoria=eq.juridico&caso_id=is.null&resposta_de=not.is.null&criado_em=gte.${desde}&select=${campos}&order=criado_em.asc&limit=100`);
      const ids = novas.map((n) => n.id);
      const controle = ids.length ? await ler(`parecer_pre_leilao_lido?email_id=in.(${ids.join(',')})&select=email_id,motivo,tentativas`) : [];
      const porId = new Map(controle.map((c) => [c.email_id, c]));
      alvos = novas.filter((n) => { const c = porId.get(n.id); return !c || (c.motivo === 'falha' && c.tentativas < MAX_TENTATIVAS); })
        .map((n) => ({ ...n, _tentativas: porId.get(n.id)?.tentativas || 0 }))
        .slice(0, MAX_POR_RODADA);
    }
    for (const e of alvos) {
      try {
        const r = await processar(e, { seco, tentativasAntes: e._tentativas || 0, dominiosJuridico });
        res.resultados.push(r);
        if (r.relatorio) { res.lidos++; res.licoes += Array.isArray(r.licoes) ? r.licoes.length : (r.licoes || 0); }
      } catch (err) {
        res.falhas++;
        res.resultados.push({ email: e.id, erro: err?.message });
        console.error(`[parecer-pre-leilao] e-mail ${e.id}:`, err?.message);
        try { await marcar(e.id, { motivo: 'falha', detalhe: String(err?.message || err).slice(0, 300) }, { seco, tentativasAntes: e._tentativas || 0 }); }
        catch (e2) { console.error('[parecer-pre-leilao] controle da falha não gravado:', e2?.message); }
      }
    }
  } catch (e) {
    console.error('[parecer-pre-leilao] falhou:', e?.message);
    return new Response(JSON.stringify({ ok: false, erro: e?.message, ...res }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  console.log('[parecer-pre-leilao]', JSON.stringify({ lidos: res.lidos, licoes: res.licoes, falhas: res.falhas }));
  return new Response(JSON.stringify({ ok: true, ...res }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export const GET = handler;
export const POST = handler;
