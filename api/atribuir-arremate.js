/**
 * POST /api/atribuir-arremate — admin/analista ATRIBUI uma arrematação a um usuário
 * (ex.: cliente novo que já tem operação em andamento). Cria um CASO marcado como
 * "arrematado" (habilita o acompanhamento + lançamentos financeiros/indicadores).
 *
 * Body: { user_id, imovel_endereco?, imovel_valor?, tipo_leilao?, cidade?, estado?, tipo_imovel? }
 * Só admin/analista. Usa service key (age em nome de outro usuário — fora do RLS).
 *
 * A atribuição existe para alimentar a IA com uma ARREMATAÇÃO REAL (sem cobrar o
 * assessorado): cria um imóvel-âncora oculto → habilita anexar o AUTO DE ARREMATAÇÃO
 * + documentos e gerar os 3 relatórios (mercadológico/jurídico/laudo), que ficam de
 * base para a IA aprender e ganhar assertividade.
 *
 * REGRA DO DONO (30/07): atribuição manual NÃO gera cobrança e NÃO altera os direitos
 * do usuário — o role e as cotas de relatórios/Índice ficam como estão (explorador
 * mantém as de explorador, Investidor Pro as do Pro). O acesso ao acompanhamento vem
 * do VÍNCULO ao caso (RLS por cliente_id + "Meus acompanhamentos"), não do role.
 *
 * ─── 29/08: A PROMOÇÃO VOLTA, MAS COMO ESCOLHA EXPLÍCITA ────────────────────────────────
 * O dono relatou um cliente atribuído manualmente que "já deveria ser assessorado". As duas
 * intenções não se contradizem: 30/07 protegia a atribuição de ESTUDO (alimentar a IA com uma
 * arrematação real sem dar plano de graça); o caso novo é cliente que contratou de fato. O que
 * faltava era DISTINGUIR os dois — e essa distinção não pode morar na cabeça de quem clica.
 * Agora é uma caixa na tela: `promover_assessorado` (padrão FALSE, ou seja, 30/07 segue valendo
 * para quem não marca).
 *
 * ⚠️ A regra saiu do comentário e virou DADO: `regra_negocio['atribuicao.promove_assessorado']`,
 * aplicada por `promover_para_assessorado()`. A de 30/07 viveu um mês só aqui, e por isso nem o
 * dono tinha como consultá-la antes de pedir o contrário — é literalmente o achado de 08/08 que
 * criou aquela tabela. `auditoria_regras_negocio()` agora vigia as duas pontas.
 */
export const config = { runtime: 'edge' };

import { getAuthUser, getUserRoleById } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CORS = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br', 'Content-Type': 'application/json' };

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const role = await getUserRoleById(user.id);
  if (role !== 'admin' && role !== 'analista') return json({ error: 'Apenas admin/analista podem atribuir arremates.' }, 403);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Supabase não configurado' }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const { user_id, imovel_endereco, imovel_valor, tipo_leilao, cidade, estado, tipo_imovel, numero_processo, valor_avaliacao,
          promover_assessorado } = body || {};
  if (!user_id) return json({ error: 'user_id obrigatório' }, 400);
  const numProc = (String(numero_processo || '').trim()) || null;
  const avaliacao = Number(String(valor_avaliacao ?? '').toString().replace(/\./g, '').replace(',', '.')) || null;

  // Valida o usuário-alvo.
  const [alvo] = await (await sb(`perfis?id=eq.${encodeURIComponent(user_id)}&select=id,role&limit=1`)).json().catch(() => []);
  if (!alvo) return json({ error: 'Usuário não encontrado' }, 404);

  const agora = new Date();
  const valor = Number(String(imovel_valor ?? '').toString().replace(/\./g, '').replace(',', '.')) || null;
  // Guard contra "extraJUDICIAL" casar /judicial/ (senão um arremate extrajudicial
  // digitado pela equipe era gravado como 'judicial' — modalidade errada no imóvel).
  const modalidade = /judicial/i.test(tipo_leilao || '') && !/extra/i.test(tipo_leilao || '') ? 'judicial' : 'extrajudicial';

  // 1) Cria o IMÓVEL-ÂNCORA oculto (ativo=false → fora da busca pública). É ele que
  //    habilita anexar o auto de arrematação/documentos (imovel_anexos exige imovel_id)
  //    e a geração dos 3 relatórios da IA, que ficam de base para aprendizado.
  const imovelRow = {
    fonte: 'atribuido_manual',
    fonte_id: crypto.randomUUID(),
    titulo: imovel_endereco || 'Arremate atribuído pela equipe',
    tipo: tipo_imovel || null,
    modalidade,
    estado: estado || null,
    cidade: cidade || null,
    endereco: imovel_endereco || null,
    valor_minimo: valor,
    valor_avaliacao: avaliacao,
    numero_processo: numProc,
    descricao: 'Arrematação real atribuída pela equipe (sem cobrança) para gerar os laudos e servir de aprendizado à IA.',
    ativo: false,
  };
  const imRes = await sb('imoveis_leilao', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(imovelRow) });
  if (!imRes.ok) return json({ error: 'Falha ao criar o imóvel do arremate', detalhe: await imRes.text().catch(() => '') }, 500);
  const [imovel] = await imRes.json().catch(() => []);
  const imovelId = imovel?.id || null;

  // 2) Cria o CASO já marcado como arrematado, vinculado ao imóvel-âncora (habilita
  //    o acompanhamento/lançamentos e conecta os anexos/relatórios ao mesmo id).
  const casoRow = {
    cliente_id: user_id,
    imovel_id: imovelId,
    imovel_endereco: imovel_endereco || 'Operação atribuída pela equipe',
    imovel_valor: valor,
    status_etapa: 'arrematado',
    arrematado_em: agora.toISOString(),
    tipo_leilao: modalidade,
    analista_id: role === 'analista' ? user.id : null,
  };
  const casoRes = await sb('casos', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(casoRow) });
  if (!casoRes.ok) return json({ error: 'Falha ao criar o caso', detalhe: await casoRes.text().catch(() => '') }, 500);
  const [caso] = await casoRes.json().catch(() => []);

  // 2.1) Semeia o corpus de aprendizado (previsto×realizado) deste arremate real.
  //      O realizado começa com o valor arrematado; o previsto e a assertividade são
  //      preenchidos por /api/arremate-recalibrar quando os relatórios/docs chegam.
  if (imovelId) {
    try {
      await sb('arremate_aprendizado?on_conflict=imovel_id', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          imovel_id: imovelId, caso_id: caso?.id, user_id,
          modalidade, origem: 'atribuido_manual',
          realizado: valor ? { valor_arrematado: valor } : {},
        }),
      });
    } catch { /* aprendizado é best-effort */ }

    // 2.2) Cria o ARREMATADO (portfólio do cliente) + o lançamento da arrematação —
    //      é o ledger onde revenda/aluguel serão registrados e de onde o corpus lê o
    //      realizado. Sem isto o join financeiro fica vazio.
    try {
      const arrRes = await sb('arrematados', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          user_id, imovel_id: imovelId, titulo: imovel_endereco || 'Arremate atribuído',
          cidade: cidade || null, estado: estado || null, status: 'arrematado',
          valor_arrematacao: valor, data_arrematacao: agora.toISOString().slice(0, 10),
        }),
      });
      const [arr] = arrRes.ok ? await arrRes.json().catch(() => []) : [];
      if (arr?.id && valor) {
        await sb('arrematado_lancamentos', {
          method: 'POST', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ arrematado_id: arr.id, user_id, tipo: 'saida', categoria: 'Arrematação', descricao: 'Valor da arrematação', valor, data: agora.toISOString().slice(0, 10) }),
        });
      }
    } catch { /* ledger é best-effort */ }

    // 2.3) Monitor CNJ: se há nº de processo (judicial sempre; extrajudicial só na
    //      imissão na posse), acompanha a evolução até a baixa/encerramento e aprende
    //      o desembaraço. Reaproveita o cron cnj-monitor-cron + processos_monitorados.
    if (numProc) {
      try {
        await sb('processos_monitorados?on_conflict=numero_processo', {
          method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({
            numero_processo: numProc, uf: estado || null, caso_id: caso?.id, imovel_id: imovelId,
            rotulo: `Arremate ${modalidade} ${(imovel_endereco || '').slice(0, 80)}`.trim(), ativo: true, criado_por: user.id,
          }),
        });
      } catch { /* monitor é best-effort */ }
    }
  }

  // 3) PROMOÇÃO — só quando o admin MARCOU. Sem a marcação vale a regra de 30/07: atribuição
  //    não mexe em role nem em cotas, e o acompanhamento vem do vínculo ao caso via RLS.
  //    Quem aplica é `promover_para_assessorado()` (SECURITY DEFINER, sem grant para anon /
  //    authenticated), e não um `update` solto aqui: é a função que a regra em `regra_negocio`
  //    declara como sua aplicadora, e é isso que a `auditoria_regras_negocio()` confere.
  let roleFinal = alvo.role, rolePromovido = false;
  if (promover_assessorado === true) {
    const r = await sb('rpc/promover_para_assessorado', {
      method: 'POST',
      body: JSON.stringify({ p_user_id: user_id, p_motivo: `atribuicao manual por ${user.id}` }),
    });
    // `.ok` checado de propósito: uma promoção que falha em silêncio devolveria "role_alterado"
    // conforme a INTENÇÃO e não conforme o BANCO — o admin fecharia a tela achando que promoveu.
    if (r.ok) {
      roleFinal = (await r.json().catch(() => null)) || alvo.role;
      rolePromovido = roleFinal !== alvo.role;
    } else {
      return json({ ok: true, caso_id: caso?.id, imovel_id: imovelId, role: alvo.role, role_alterado: false,
        aviso: `caso criado, mas a promocao para assessorado FALHOU (HTTP ${r.status}) — promova pela tela de usuarios` }, 200);
    }
  }
  return json({ ok: true, caso_id: caso?.id, imovel_id: imovelId, role: roleFinal, role_alterado: rolePromovido });
}
