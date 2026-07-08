// AGENTE DE DEFESA / LAUDO DE VIABILIDADE (3º documento) — NO SERVIDOR, persistente.
//
// Consolida os DOIS relatórios já gerados — MERCADOLÓGICO + VIABILIDADE FINANCEIRA
// (analises_mercado) e DOCUMENTAL + JURÍDICO (analises_documental) — num PARECER
// FINAL DE DEFESA com veredito (aprovado/condicional/reprovado).
//
// ECONOMIA DELIBERADA: este agente NÃO reprocessa fontes pagas. Ele NÃO usa
// web_search nem Bright Data — apenas LÊ os resultados dos outros dois relatórios
// e faz UMA passada de IA de síntese. Assim o 3º documento é barato e não drena
// cota de scraping/pesquisa. Espelha a mecânica de gerar-analise/gerar-documental.
export const config = { runtime: 'nodejs', maxDuration: 180 };

import { getUser } from './_auth.js';
import { anthropicFetch } from './_claude.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_KEY;
const MODEL = 'claude-sonnet-4-6';

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
async function upsertLaudo(row) {
  await sb('analises_laudo?on_conflict=user_id,imovel_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
  });
}
function extractText(data) {
  if (!data?.content) return '';
  return data.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
}
function parseJSON(text) {
  if (!text) return null;
  const clean = text.trim();
  try { return JSON.parse(clean); } catch {}
  const md = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (md) { try { return JSON.parse(md[1].trim()); } catch {} }
  const obj = clean.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch {} }
  return null;
}
async function anthropic(payload, fetchOpts) {
  const headers = { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  const r = await anthropicFetch({ method: 'POST', headers, body: JSON.stringify(payload) }, fetchOpts);
  return r.json();
}
async function ultimoConcluido(tabela, userId, imovelId) {
  const r = await sb(`${tabela}?user_id=eq.${userId}&imovel_id=eq.${encodeURIComponent(String(imovelId))}&status=eq.concluida&select=result,data_leilao,updated_at&order=updated_at.desc&limit=1`);
  if (!r.ok) return null;
  const [row] = await r.json().catch(() => []);
  return row || null;
}

// Resumo enxuto dos dois relatórios (só o que importa p/ a defesa) — controla custo.
function resumoMercado(m) {
  if (!m) return 'RELATÓRIO MERCADOLÓGICO: ausente.';
  const merc = m.mercado || {};
  const partes = [
    `- Valor de mercado estimado: R$ ${Number(m.valorMercado || 0).toLocaleString('pt-BR')}`,
    merc.precoMedioM2 ? `- Preço médio/m²: R$ ${Number(merc.precoMedioM2).toLocaleString('pt-BR')}` : '',
    merc.aluguelMedio ? `- Aluguel médio: R$ ${Number(merc.aluguelMedio).toLocaleString('pt-BR')} (yield ${(merc.yieldBruto||0).toFixed?.(1) || merc.yieldBruto || 0}% bruto)` : '',
    merc.referenciaFipeZap?.encontrado ? `- FipeZAP ${merc.referenciaFipeZap.localidade || ''}: R$ ${Number(merc.referenciaFipeZap.precoMedioM2||0).toLocaleString('pt-BR')}/m², valorização 12m ${(Number(merc.referenciaFipeZap.valorizacao12m)||0).toFixed(1)}%` : '',
    merc.comentario ? `- Leitura de mercado: ${String(merc.comentario).slice(0, 600)}` : '',
  ].filter(Boolean);
  const parecer = m.parecer ? `\nPARECER MERCADOLÓGICO/FINANCEIRO (na íntegra):\n${String(m.parecer).slice(0, 6000)}` : '';
  return `RELATÓRIO MERCADOLÓGICO + VIABILIDADE FINANCEIRA:\n${partes.join('\n')}${parecer}`;
}
function resumoDocumental(d) {
  if (!d) return 'RELATÓRIO DOCUMENTAL/JURÍDICO: ausente.';
  const riscos = Array.isArray(d.riscos) ? d.riscos : [];
  const rTxt = riscos.length
    ? riscos.map(r => `  · [${(r.severidade || 'informativo').toUpperCase()}] ${r.descricao || r.categoria}${r.constaNaDoc === false ? ' (não consta na documentação — confirmar)' : ''}`).join('\n')
    : '  · Nenhum risco discriminado.';
  const lacunas = Array.isArray(d.lacunas) && d.lacunas.length ? `\nLACUNAS/DILIGÊNCIAS PENDENTES:\n${d.lacunas.map(l => '  · ' + l).join('\n')}` : '';
  const parecer = d.parecer ? `\nPARECER DOCUMENTAL/JURÍDICO (na íntegra):\n${String(d.parecer).slice(0, 6000)}` : '';
  return `RELATÓRIO DOCUMENTAL + JURÍDICO:\n- Nível de risco: ${d.nivelRisco || 'não classificado'}\nRISCOS IDENTIFICADOS:\n${rTxt}${lacunas}${parecer}`;
}

function promptDefesa(im, resMerc, resDoc) {
  return `Você é o GESTOR SÊNIOR de decisão da BidPro Brasil. Sua função é emitir o PARECER FINAL DE VIABILIDADE (laudo de defesa) de uma arrematação em leilão, CONSOLIDANDO os dois relatórios abaixo — o mercadológico/financeiro e o documental/jurídico. Você NÃO refaz as análises; você as PONDERA e conclui.

IMÓVEL: ${im.tipo || 'imóvel'} — ${im.endereco || ''}, ${im.cidade || ''}/${im.estado || ''}

════════ ENTRADA 1 ════════
${resMerc}

════════ ENTRADA 2 ════════
${resDoc}

════════ SUA TAREFA ════════
Além de consolidar, você é o MODERADOR/CONTROLE DE QUALIDADE dos dois relatórios:
avalie a CONFIANÇA de cada um (0–100: completude + consistência + presença de dados
concretos vs. "não consta"), aponte CONTRADIÇÕES entre eles (ex.: mercadológico diz
"ótimo desconto" mas o documental achou ocupação/ônus que corrói a margem) e as
LACUNAS CRÍTICAS que faltam para decidir. Se houver contradição relevante ou um
relatório com confiança baixa (<50), marque "recomendaRevisao": true (o caso deve
ser revisado antes do lance).

Emita um VEREDITO consolidado, cruzando as duas visões:
- "aprovado": mercado/financeiro favorável E sem risco jurídico bloqueante.
- "condicional": vale a pena, MAS depende de resolver diligências/pendências (ex.: confirmar débitos, ocupação, laudêmio) ou de respeitar um teto de lance. Liste as CONDIÇÕES objetivas.
- "reprovado": retorno insuficiente OU risco jurídico bloqueante que inviabiliza/onera demais a operação.

REGRAS:
- Um RISCO BLOQUEANTE no jurídico derruba para "reprovado" ou "condicional" mesmo com bom retorno — explique o porquê.
- VULNERABILIDADE NA OCUPAÇÃO (idoso, PcD, criança, vulnerabilidade social) é fator de RESISTÊNCIA/ATRASO na desocupação e deve entrar como CONDIÇÃO/diligência em TODO imóvel — o status "ocupado/desocupado" do edital é notoriamente furado (dito desocupado com moradores e vice-versa), então a verificação em campo é sempre necessária, mesmo que o documental não tenha apontado ocupação. Trate como "condicional", nunca bloqueio automático, e liste a verificação lícita (consulta processual/prioridade de tramitação se judicial, visita ao imóvel). Nunca sugira consultar dados de saúde/SUS — é ilegal (LGPD) e não deve constar como diligência.
- Retorno abaixo de 30% (investimento) sem economia relevante = "reprovado".
- Seja HONESTO e OBJETIVO. Se reprovado, seja curto e direto no porquê. Não invente dados que não estão nos relatórios; se algo é incerto, trate como condição/diligência.
- Texto formal, simples, sem markdown/asteriscos e SEM travessão "—" (use vírgula, ponto ou dois-pontos; o travessão dá cara de texto de IA e reduz a confiança do cliente).
- LINGUAGEM PARA LEIGO (obrigatório): escreva de forma que QUALQUER pessoa, sem formação jurídica ou financeira, entenda. Frases curtas. Sempre que um termo técnico for inevitável (ex.: propter rem, laudêmio, imissão de posse, usufruto, yield, ROI, TIR), explique em 3 a 6 palavras entre parênteses logo após o termo (ex.: "débitos propter rem (que seguem o imóvel, não a pessoa)"). Traduza percentuais em dinheiro sempre que ajudar. O cliente não é advogado nem economista.
- TAMANHO PROPORCIONAL À COMPLEXIDADE: seja CONCISO por padrão. Caso SIMPLES (poucos riscos, sem processos ou 1 processo claro, veredito direto): parecer curto e objetivo, cada seção em 1 a 3 frases, foque só no que decide. Caso COMPLEXO (múltiplos processos, vários ônus/gravames, contradições relevantes entre os relatórios, ocupação disputada): aí SIM detalhe o necessário para o cliente entender os riscos e as diligências, sem limite artificial. Nunca infle o texto para parecer robusto: um bom laudo tem o tamanho do problema, nem mais, nem menos.

Retorne APENAS este JSON (sem markdown):
{
  "veredito": "aprovado|condicional|reprovado",
  "resumoExecutivo": "2-3 frases para um leigo: comprar ou não, e a razão principal.",
  "pontosFortes": ["", ""],
  "pontosDeAtencao": ["", ""],
  "condicoes": ["condições objetivas para o 'condicional' — vazio se não se aplica"],
  "diligenciasPendentes": ["o que confirmar antes do lance, se houver"],
  "controleQualidade": { "confiancaMercadologico": 0, "confiancaDocumental": 0, "contradicoes": ["contradições entre os dois relatórios, se houver"], "lacunasCriticas": ["o que falta para decidir com segurança"], "recomendaRevisao": false },
  "parecer": "Parecer de defesa em português formal, texto simples, estruturado com '§ SEÇÃO:' — § SEÇÃO: SÍNTESE DA OPORTUNIDADE (mercado x aquisição); § SEÇÃO: LEITURA JURÍDICA E DE RISCO; § SEÇÃO: CONTROLE DE QUALIDADE (confiança de cada relatório e contradições encontradas); § SEÇÃO: CRUZAMENTO E VEREDITO (por que aprovado/condicional/reprovado, cruzando as duas frentes); § SEÇÃO: CONDIÇÕES E DILIGÊNCIAS; § SEÇÃO: RECOMENDAÇÃO FINAL AO CLIENTE."
}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autenticado' }); return; }
  // O laudo de viabilidade consolida a documental/jurídica — mesmo gate: a partir
  // do Investidor Pro (explorador não tem a documental para consolidar).
  try {
    const [perfil] = await (await sb(`perfis?id=eq.${user.id}&select=role&limit=1`)).json();
    if (!perfil || perfil.role === 'explorador' || perfil.role == null) {
      res.status(402).json({ error: 'O laudo de viabilidade está disponível a partir do plano Investidor Pro.', upgrade: true });
      return;
    }
  } catch { /* se a checagem falhar, não trava quem tem direito */ }
  if (!CLAUDE_KEY) { res.status(500).json({ error: 'CLAUDE_KEY ausente' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  const body = req.body || {};
  const { imovelId, titulo, cidade, estado, imovel } = body;
  if (!imovelId) { res.status(400).json({ error: 'imovelId obrigatório' }); return; }

  // Geração EM NOME DE (admin/analista): lê os relatórios do CLIENTE e grava sob ele.
  let ownerId = user.id;
  if (body.paraUserId && body.paraUserId !== user.id) {
    try {
      const [p] = await (await sb(`perfis?id=eq.${user.id}&select=role&limit=1`)).json();
      if (p && (p.role === 'admin' || p.role === 'analista')) ownerId = String(body.paraUserId);
    } catch { /* mantém o próprio */ }
  }

  // Lê os dois relatórios já concluídos deste usuário para este imóvel.
  const [mRow, dRow] = await Promise.all([
    ultimoConcluido('analises_mercado', ownerId, imovelId),
    ultimoConcluido('analises_documental', ownerId, imovelId),
  ]);
  const faltando = [];
  if (!mRow?.result) faltando.push('mercadológico');
  if (!dRow?.result) faltando.push('documental');
  if (faltando.length) {
    // Gate: o laudo é uma SÍNTESE — precisa dos dois relatórios prontos antes.
    res.status(200).json({ ok: true, result: {
      precisaRelatorios: true, faltando,
      motivo: `O laudo de viabilidade consolida os dois relatórios. Gere primeiro: ${faltando.map(f => f === 'mercadológico' ? 'Relatório Mercadológico' : 'Análise Documental').join(' e ')}.`,
    } });
    return;
  }

  const im = {
    tipo: imovel?.tipo, endereco: imovel?.endereco,
    cidade: cidade || imovel?.cidade, estado: estado || imovel?.estado,
  };
  const dataLeilao = (() => {
    const raw = imovel?.dataLeilao || mRow?.data_leilao || dRow?.data_leilao || null;
    return raw && !isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : null;
  })();
  const baseRow = { user_id: ownerId, imovel_id: String(imovelId), titulo: titulo || im.endereco || null, cidade: im.cidade || null, estado: im.estado || null, imovel: imovel || null, data_leilao: dataLeilao };
  await upsertLaudo({ ...baseRow, status: 'gerando', erro: null, result: null });

  // DEADLINE interno < maxDuration (180s): garante gravar 'erro' antes de a Vercel
  // matar a função. Sem isto, se a chamada de IA travar/re-tentar além do limite, a
  // função morre no meio e a linha fica presa em 'gerando' para sempre.
  const DEADLINE_MS = 160000;
  const prazo = new Promise((_, rej) => setTimeout(() => rej(new Error('tempo_limite')), DEADLINE_MS));

  try {
    const result = await Promise.race([prazo, (async () => {
    const resMerc = resumoMercado(mRow.result);
    const resDoc = resumoDocumental(dRow.result);

    // APRENDIZADO: correções que analistas fizeram em vereditos anteriores voltam ao
    // prompt (loop de melhoria contínua — no-op enquanto não houver devolutivas).
    let aprendizados = '';
    try {
      const licoes = await (await sb('laudo_aprendizado?select=veredito_ia,veredito_real,observacao&order=criado_em.desc&limit=30')).json();
      if (Array.isArray(licoes)) {
        const linhas = licoes
          .filter(l => l && (l.veredito_real || l.observacao))
          .map(l => `- IA disse "${String(l.veredito_ia || '—')}", o analista corrigiu para "${String(l.veredito_real || '—')}"${l.observacao ? ` — ${String(l.observacao).slice(0, 200)}` : ''}`);
        if (linhas.length) aprendizados = `\n\nAPRENDIZADOS COM ANALISTAS (correções reais de vereditos anteriores — aplique estas lições):\n${linhas.join('\n')}`;
      }
    } catch { /* aprendizado é best-effort */ }

    const data = await anthropic({
      model: MODEL, max_tokens: 4000,
      system: 'Você é o gestor sênior de decisão da BidPro Brasil. Emite o parecer final de viabilidade consolidando o relatório mercadológico/financeiro e o documental/jurídico. Pondera as duas visões, não as refaz. Honesto e objetivo. Nunca use markdown nem asteriscos. Nunca use travessão (o caractere "—"); escreva com vírgula, ponto ou dois-pontos. Retorne apenas JSON válido.' + aprendizados,
      messages: [{ role: 'user', content: promptDefesa(im, resMerc, resDoc) }],
    }, { retries: 1, timeoutMs: 120000, noFallback: true });
    const parsed = parseJSON(extractText(data)) || {};

    const AVISO = '\n\n§ SEÇÃO: LEMBRETE\nEste laudo de viabilidade é um parecer consolidado gerado com apoio de inteligência artificial a partir dos dois relatórios anteriores — tem caráter de apoio à decisão e não substitui a análise de um profissional nem a verificação presencial. Recomendamos agendar a reunião com um analista para validar o veredito antes de qualquer lance.';

    const result = {
      veredito: parsed.veredito || 'condicional',
      resumoExecutivo: parsed.resumoExecutivo || '',
      pontosFortes: Array.isArray(parsed.pontosFortes) ? parsed.pontosFortes : [],
      pontosDeAtencao: Array.isArray(parsed.pontosDeAtencao) ? parsed.pontosDeAtencao : [],
      condicoes: Array.isArray(parsed.condicoes) ? parsed.condicoes : [],
      diligenciasPendentes: Array.isArray(parsed.diligenciasPendentes) ? parsed.diligenciasPendentes : [],
      controleQualidade: parsed.controleQualidade && typeof parsed.controleQualidade === 'object' ? {
        confiancaMercadologico: Number(parsed.controleQualidade.confiancaMercadologico) || null,
        confiancaDocumental: Number(parsed.controleQualidade.confiancaDocumental) || null,
        contradicoes: Array.isArray(parsed.controleQualidade.contradicoes) ? parsed.controleQualidade.contradicoes : [],
        lacunasCriticas: Array.isArray(parsed.controleQualidade.lacunasCriticas) ? parsed.controleQualidade.lacunasCriticas : [],
        recomendaRevisao: !!parsed.controleQualidade.recomendaRevisao,
      } : null,
      parecer: (parsed.parecer || '') + AVISO,
      baseadoEm: { mercadoEm: mRow.updated_at, documentalEm: dRow.updated_at },
      geradoEm: new Date().toISOString(),
    };
    // Coerência determinística: um veredito "aprovado" NÃO pode conviver com um
    // pedido de revisão do controle de qualidade (baixa confiança/contradição entre
    // os relatórios). Nesse caso rebaixa para "condicional" e registra a condição.
    if (result.veredito === 'aprovado' && result.controleQualidade?.recomendaRevisao) {
      result.veredito = 'condicional';
      if (!result.condicoes.length) {
        result.condicoes = ['Revisar com um analista antes do lance: o controle de qualidade sinalizou baixa confiança ou contradição entre o relatório de mercado e o documental.'];
      }
    }
    return result;
    })()]);

    await upsertLaudo({ ...baseRow, status: 'concluida', erro: null, result });
    res.status(200).json({ ok: true, result });
  } catch (e) {
    const timeout = String(e?.message) === 'tempo_limite';
    const msg = timeout ? 'A geração excedeu o tempo limite do servidor. Costuma ser temporário: tente novamente.' : String(e?.message || e);
    await upsertLaudo({ ...baseRow, status: 'erro', erro: msg });
    res.status(timeout ? 504 : 500).json({ error: timeout ? 'Tempo limite ao gerar o laudo' : 'Falha ao gerar o laudo de viabilidade', detalhe: msg });
  }
}
