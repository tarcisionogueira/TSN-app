/**
 * GET  /api/admin-mensagens-grupo  → dado real da aula viva (título, quando, depoimentos,
 *                                     destaques do apresentador, vagas), a lista de imóveis
 *                                     reais candidatos a "oportunidade" + o que já foi gerado
 *                                     hoje (evita gerar/postar a mesma coisa duas vezes).
 * POST /api/admin-mensagens-grupo  → gera o texto de UM tipo de mensagem { tipo, ...extras } e
 *                                     grava em `mensagens_grupo_log`.
 *
 * MESMA NATUREZA "ASSISTIDA" do `admin-whatsapp-fila.js` (01/09): esta rota NÃO POSTA no grupo.
 * `wa.me`/API oficial não servem pra postar num GRUPO (só abrir DM ou exigir template aprovado
 * pela Meta) — o operador copia o texto e cola no grupo pelo próprio WhatsApp. O valor daqui é
 * escrever o texto certo com o DADO REAL da semana (evento vivo, depoimento curado, vagas) sem
 * o operador ter que lembrar dos números, e registrar o que já foi gerado hoje.
 *
 * Toda a montagem de texto vive em `_mensagens-grupo.js` (puro, testado em
 * `testar:mensagem-grupo`) — este arquivo só busca dado real e chama o formatador.
 */
export const config = { runtime: 'nodejs' };

import { getUser } from './_auth.js';
import { escolherAulaViva, quandoPorExtenso } from './admin-whatsapp-fila.js';
import { edicaoDe } from './_live-edicao.js';
import { montarMensagemGrupo, TIPOS_VALIDOS } from './_mensagens-grupo.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BASE = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';

const sb = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
});

// A aula viva + tudo que os formatadores podem precisar, num lugar só — GET e POST usam a
// mesma busca, pra nunca gerar mensagem sobre uma edição diferente da que a tela mostrou.
async function buscarAulaViva() {
  const rEv = await sb('eventos_live?ativo=eq.true&select=slug&order=data_hora.asc');
  if (!rEv.ok) return { erro: { status: 502, body: { error: 'evento_ilegivel', detalhe: await rEv.text() } } };
  const ativos = await rEv.json().catch(() => null);
  if (!Array.isArray(ativos)) return { erro: { status: 502, body: { error: 'evento_ilegivel', detalhe: 'corpo inesperado em eventos_live' } } };

  const proximas = [];
  for (const linha of ativos) {
    const rP = await sb('rpc/live_proxima', { method: 'POST', body: JSON.stringify({ p_slug: linha.slug }) });
    if (!rP.ok) return { erro: { status: 502, body: { error: 'evento_ilegivel', detalhe: await rP.text() } } };
    const prox = await rP.json().catch(() => null);
    if (prox?.data_hora) proximas.push(prox);
  }
  const evento = escolherAulaViva(proximas);
  if (!evento) return { evento: null };

  // `live_proxima` (pública) não devolve `id`/`vagas_max`/`depoimentos`/`apresentador_destaques`
  // de propósito (ver leilaoinscricao/live_proxima) — esta rota é admin-only, então busca a
  // linha completa direto na tabela pelo slug já resolvido.
  const rFull = await sb(`eventos_live?slug=eq.${encodeURIComponent(evento.slug)}&select=id,titulo,vagas_max,depoimentos,apresentador_destaques&limit=1`);
  if (!rFull.ok) return { erro: { status: 502, body: { error: 'evento_ilegivel', detalhe: await rFull.text() } } };
  const [full] = await rFull.json().catch(() => [null]);
  if (!full?.id) return { erro: { status: 502, body: { error: 'evento_ilegivel', detalhe: 'linha completa não encontrada' } } };

  return {
    evento: {
      id: full.id, slug: evento.slug, titulo: full.titulo, data_hora: evento.data_hora,
      edicao: edicaoDe(evento.data_hora), quando: quandoPorExtenso(evento.data_hora),
      vagas_max: full.vagas_max ?? null,
      depoimentos: Array.isArray(full.depoimentos) ? full.depoimentos : [],
      apresentador_destaques: Array.isArray(full.apresentador_destaques) ? full.apresentador_destaques : [],
    },
  };
}

function linkDaAula(slug, edicao, tipo) {
  return `${BASE}/aula/${slug}?utm_source=whatsapp&utm_medium=group&utm_campaign=aula-${edicao}&utm_content=grupo-${tipo}`;
}

// Candidatos reais pro tipo "oportunidade" (08/09) — MESMAS colunas que api/og-share.js já
// lê pro cartão de `/i/:id` (mais tipo/modalidade, novos na 2ª rodada — pedido do dono pra
// dizer o TIPO de leilão no texto). Só ativos, com foto (o link vale pela FOTO no preview do
// WhatsApp) e desconto real de pelo menos 30% — o admin ainda escolhe qual mostrar no
// dropdown, isto só evita catar manualmente no Admin.
//
// PRIORIZA quem tem `data_leilao` marcada (08/09, achado testando com dado real: os 10
// maiores descontos eram TODOS CEF em piso de praças repetidas, sem data nenhuma — desconto
// gigante sem praça marcada soa menos crível e não cria urgência de verdade). Preenche o
// resto até 10 com quem não tem data só se faltar candidato — nunca deixa a lista vazia.
async function buscarOportunidades() {
  const base = 'imoveis_leilao?ativo=eq.true&link_foto=not.is.null&desconto_percentual=gte.30' +
    '&select=id,titulo,tipo,modalidade,cidade,estado,bairro,valor_minimo,valor_avaliacao,desconto_percentual,data_leilao,link_foto';

  const rComData = await sb(`${base}&data_leilao=not.is.null&order=desconto_percentual.desc&limit=10`);
  if (!rComData.ok) { console.error('[mensagens-grupo] nao consegui ler oportunidades (com praca):', await rComData.text()); return []; }
  const comData = await rComData.json().catch(() => null);
  const lista = Array.isArray(comData) ? comData : [];
  if (lista.length >= 10) return lista;

  const rSemData = await sb(`${base}&data_leilao=is.null&order=desconto_percentual.desc&limit=${10 - lista.length}`);
  if (!rSemData.ok) { console.error('[mensagens-grupo] nao consegui ler oportunidades (sem praca):', await rSemData.text()); return lista; }
  const semData = await rSemData.json().catch(() => null);
  return lista.concat(Array.isArray(semData) ? semData : []);
}

function linkDoImovel(id, edicao) {
  return `${BASE}/i/${id}?utm_source=whatsapp&utm_medium=group&utm_campaign=aula-${edicao}&utm_content=grupo-oportunidade`;
}

// `/p/curso/:id` (og-share.js) só tem preview rico pros cursos do array ESTÁTICO — os de
// `cursos_admin` cairiam no cartão genérico ali (gap conhecido, fora do escopo desta
// mensagem). Vai direto pro hash: carrega o curso CERTO, só sem foto no preview do WhatsApp.
function linkCurso(id, edicao) {
  return `${BASE}/#/p/curso/${id}?utm_source=whatsapp&utm_medium=group&utm_campaign=aula-${edicao}&utm_content=grupo-curso`;
}

// Mesma rota pública que `Planos.jsx` usa pra compartilhar cada plano (`compartilharPlano`) —
// `/checkout` é público e apresenta o plano + cadastro/pagamento inline pra quem não tem conta.
function linkPlano(chave, edicao, tipo) {
  return `${BASE}/#/checkout?plano=${chave}&utm_source=whatsapp&utm_medium=group&utm_campaign=aula-${edicao}&utm_content=grupo-${tipo}`;
}

// Candidatos reais pro tipo "curso" — só o que o admin CADASTROU e ATIVOU em `cursos_admin`
// com preço de verdade (pago). Hoje pode devolver lista vazia (achado do dono, 08/09: só
// existe 1 curso ativo e é grátis) — o formatador já sabe devolver `null` nesse caso.
async function buscarCursosPagos() {
  const r = await sb(
    'cursos_admin?ativo=eq.true&gratuito=eq.false&preco=gt.0' +
    '&select=id,titulo,subtitulo,descricao,emoji,nivel,categoria,preco' +
    '&order=destaque.desc,ordem.asc&limit=10'
  );
  if (!r.ok) { console.error('[mensagens-grupo] nao consegui ler cursos_admin:', await r.text()); return []; }
  const rows = await r.json().catch(() => null);
  return Array.isArray(rows) ? rows : [];
}

export default async function handler(req, res) {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });

  const rPerfil = await sb(`perfis?id=eq.${user.id}&select=role`);
  if (!rPerfil.ok) return res.status(502).json({ error: 'perfil_ilegivel', detalhe: await rPerfil.text() });
  const [perfil] = await rPerfil.json();
  if (perfil?.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });

  const { evento, erro } = await buscarAulaViva();
  if (erro) return res.status(erro.status).json(erro.body);
  if (!evento) return res.status(200).json({ evento: null, motivo: 'nenhuma aula futura ativa' });

  const oportunidades = await buscarOportunidades();
  const cursosPagos = await buscarCursosPagos();

  if (req.method === 'POST') {
    const tipo = String(req.body?.tipo || '');
    if (!TIPOS_VALIDOS.includes(tipo)) return res.status(400).json({ error: 'tipo_invalido' });

    const link = linkDaAula(evento.slug, evento.edicao, tipo);
    const extras = req.body?.dados && typeof req.body.dados === 'object' ? req.body.dados : {};

    let dados;
    if (tipo === 'convite') {
      dados = { titulo: evento.titulo, quando: evento.quando, link, destaque: evento.apresentador_destaques[Number(extras.destaque_index)] || null };
    } else if (tipo === 'case') {
      dados = { depoimento: evento.depoimentos[Number(extras.depoimento_index)] || null, link };
    } else if (tipo === 'educacao') {
      dados = { mito: extras.mito, verdade: extras.verdade };
    } else if (tipo === 'enquete') {
      dados = { pergunta: extras.pergunta, opcoes: extras.opcoes };
    } else if (tipo === 'urgencia') {
      dados = { titulo: evento.titulo, quando: evento.quando, estagio: extras.estagio, vagasMax: evento.vagas_max, link };
    } else if (tipo === 'followup') {
      dados = { titulo: evento.titulo, link };
    } else if (tipo === 'oportunidade') {
      const imovel = oportunidades[Number(extras.imovel_index)] || null;
      dados = { imovel, link: imovel ? linkDoImovel(imovel.id, evento.edicao) : null };
    } else if (tipo === 'curso') {
      const curso = cursosPagos[Number(extras.curso_index)] || null;
      dados = { curso, link: curso ? linkCurso(curso.id, evento.edicao) : null };
    } else if (tipo === 'assessoria') {
      dados = { link: linkPlano('assessorado', evento.edicao, 'assessoria') };
    } else if (tipo === 'assinatura') {
      dados = { link: linkPlano('top2', evento.edicao, 'assinatura') };
    }

    const texto = montarMensagemGrupo(tipo, dados);
    if (!texto) return res.status(422).json({ error: 'dado_insuficiente', detalhe: 'falta informação real pra montar esta mensagem — confira o depoimento/mito/verdade/opções.' });

    const rGrava = await sb('mensagens_grupo_log', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ evento_id: evento.id, edicao: evento.edicao, tipo, texto, gerado_por: user.id }),
    });
    // Falha ao GRAVAR o log não pode derrubar o texto já gerado — o operador ainda quer copiar
    // e postar. Mas precisa aparecer: sem isso, a próxima consulta de "o que já foi gerado
    // hoje" mostra menos do que realmente saiu, e o operador gera (e posta) tudo de novo.
    if (!rGrava.ok) console.error('[mensagens-grupo] nao gravou o log:', await rGrava.text());

    return res.status(200).json({ texto, log_gravado: rGrava.ok });
  }

  const rHoje = await sb(`mensagens_grupo_log?evento_id=eq.${evento.id}&edicao=eq.${evento.edicao}&select=tipo,criado_em&order=criado_em.desc`);
  let geradasHoje = null;
  if (rHoje.ok) geradasHoje = await rHoje.json().catch(() => null);
  else console.error('[mensagens-grupo] nao consegui ler o log de hoje:', await rHoje.text());

  return res.status(200).json({
    evento: {
      slug: evento.slug, titulo: evento.titulo, quando: evento.quando, edicao: evento.edicao,
      vagas_max: evento.vagas_max, depoimentos: evento.depoimentos, apresentador_destaques: evento.apresentador_destaques,
    },
    oportunidades,
    cursos_pagos: cursosPagos,
    geradas_hoje: geradasHoje,
  });
}
