/**
 * POST /api/live-inscrever — inscrição na aula ao vivo.
 *
 * Faz duas coisas de uma vez, e é esse o ponto: registra a inscrição E transforma o
 * inscrito em USUÁRIO da plataforma. Uma landing de terceiro captaria o e-mail numa lista
 * que não é nossa — o lead nunca chegaria à base, e o rastreio de origem (consertado em
 * 20/08) não o alcançaria.
 *
 * ATRITO MÍNIMO, DE PROPÓSITO: pede nome, e-mail e WhatsApp. Não pede senha. A conta nasce
 * com senha aleatória e a pessoa recebe o link para defini-la junto com a confirmação.
 * Exigir senha numa página de inscrição derruba conversão e não acrescenta nada agora.
 *
 * Mínimo NÃO é frouxo (27/08): os três campos passam pela MESMA régua do cadastro
 * (`_nome.js`, `_telefone.js`), porque esta rota CRIA CONTA — dado que entra por aqui é o
 * mesmo dado que o resto do sistema usa para emitir contrato e para ligar para o cliente.
 * Enquanto a régua daqui era `nome.length >= 2` e `whatsapp.length >= 10`, a landing era a
 * porta dos fundos por onde entrava exatamente o que o cadastro recusa: a inscrição de
 * teste gravou "tarcisio", primeiro nome solto, e teria aceitado celular sem o 9.
 *
 * E-MAIL JÁ CADASTRADO NÃO É ERRO. Aqui isso é o caso NORMAL (cliente que já usa a
 * plataforma e quer assistir): inscreve e segue. Barrar quem já é cliente seria recusar o
 * público mais quente que existe.
 */
export const config = { runtime: 'nodejs' };

import { checkRateLimit } from './_rate-limit.js';
import { enviarEmail } from './_email.js';
import { erroNome, normalizarNome } from './_nome.js';
import { edicaoDe } from './_live-edicao.js';
import { erroTelefone, limparTelefone, normalizarTelefoneBR } from './_telefone.js';
import { enviarLeadCapi, leadEventId, capiAtivo } from './_meta-capi.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const APP_URL      = process.env.APP_BASE_URL || 'https://www.bidprobrasil.com.br';

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', ...(opts.headers || {}),
    },
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Senha aleatória forte: a pessoa nunca a usa (recebe link para definir a dela), mas a
// conta não pode nascer com senha fraca ou previsível.
function senhaAleatoria() {
  const b = new Uint8Array(18);
  (globalThis.crypto || require('node:crypto').webcrypto).getRandomValues(b);
  return 'Aa1!' + Buffer.from(b).toString('base64url').slice(0, 20);
}

export default async function handler(req, res) {
  // O convite no acervo aberto (api/publico.js, /leiloes) é HTML puro — sem JS de
  // aplicação, de propósito (é página de SEO). Um <form method="POST"> comum chega aqui
  // com Content-Type x-www-form-urlencoded; a landing dedicada (LiveInscricao.jsx) chama
  // via fetch com application/json. `saida()` é o ÚNICO lugar que decide o formato da
  // resposta — todo `return res.status(...).json(...)` abaixo vira `return saida(...)`,
  // preservando exatamente a mesma lógica/mensagens; só a ENTREGA muda por origem.
  const ct = String(req.headers['content-type'] || '');
  const isFormPost = /^(application\/x-www-form-urlencoded|multipart\/form-data)/i.test(ct);
  function saida(status, payload) {
    if (!isFormPost) return res.status(status).json(payload);
    const destino = (status >= 200 && status < 300) ? '/leiloes?inscrito=1#convite-live' : '/leiloes?live_erro=1#convite-live';
    res.writeHead(302, { Location: destino });
    return res.end();
  }

  if (req.method !== 'POST') return saida(405, { error: 'Método não permitido' });
  if (!SUPABASE_URL || !SERVICE_KEY) return saida(500, { error: 'Configuração ausente' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'sem-ip';
  const rl = await checkRateLimit(`live:${ip}`, 8, 600);
  if (!rl.ok) return saida(429, { error: 'Muitas tentativas. Tente novamente em alguns minutos.' });

  const b = req.body || {};
  const slug     = String(b.slug || '').trim().slice(0, 80);
  const nome     = normalizarNome(String(b.nome || '').slice(0, 120));
  const email    = String(b.email || '').trim().toLowerCase().slice(0, 160);
  // INDICAÇÃO DO PARCEIRO (28/08). A aula passa a ser material de divulgação dos parceiros, e
  // sem isto o link deles produziria o oposto do combinado: a conta nasce aqui, no servidor,
  // SEM upline — e 24h depois o cron `adotar_orfaos_padrao_dono` a adotaria para o DONO. O
  // parceiro divulgaria, traria o inscrito e perderia a carteira, em silêncio.
  const ref      = String(b.ref || '').trim().slice(0, 40);
  // `normalizarTelefoneBR` tira o "+55" do autopreenchimento ANTES de validar: 13 dígitos
  // reprovariam por tamanho, e reprovar um número certo é tão ruim quanto aceitar um errado.
  const whatsapp = normalizarTelefoneBR(b.whatsapp).slice(0, 15);
  const cidade   = String(b.cidade || '').trim().slice(0, 90);
  const uf       = String(b.uf || '').trim().toUpperCase().slice(0, 2);
  const utm      = (b.utm && typeof b.utm === 'object') ? b.utm : {};

  if (!slug) return saida(400, { error: 'Evento não informado.' });
  const eNome = erroNome(nome);
  if (eNome) return saida(400, { error: eNome });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return saida(400, { error: 'E-mail inválido.' });
  // `erroTelefone` deixa passar o VAZIO por contrato (obrigatoriedade é decisão de quem
  // chama). Aqui o WhatsApp é o canal de contato direto e o do grupo, então o vazio é
  // checado à parte. (Desde 28/08 o LEMBRETE e o link da sala saem por e-mail, no
  // `live-lembrete-cron` — antes disso esta linha dizia que saíam pelo WhatsApp, o que
  // descrevia uma intenção e não um mecanismo: não havia cron nenhum enviando.)
  if (!limparTelefone(whatsapp)) return saida(400, { error: 'Informe o seu WhatsApp com DDD.' });
  const eTel = erroTelefone(whatsapp);
  if (eTel) return saida(400, { error: eTel });
  // Cidade é obrigatória só na landing dedicada (pede o campo, usa pra buscar ao vivo na
  // aula). O convite do acervo aberto (form puro) é de propósito mais enxuto — 3 campos,
  // sem cidade — e cidade vazia já é aceita mais abaixo (grava null, sem quebrar nada).
  if (!isFormPost && cidade.length < 2) return saida(400, { error: 'Informe a sua cidade.' });

  // O evento tem de existir e estar ativo — nunca confiar no que a tela mandou.
  // `.ok` conferido À PARTE: leitura que FALHOU e aula que NÃO EXISTE levam a respostas
  // opostas. O `evRes.ok ? … : []` que estava aqui transformava um 5xx do PostgREST em
  // "esta aula não está com inscrições abertas" — o inscrito lia que não há aula e não
  // voltava mais, num dia em que a aula existia.
  const evRes = await sb(`eventos_live?slug=eq.${encodeURIComponent(slug)}&ativo=eq.true&select=id,titulo,data_hora,link_grupo,whatsapp_direto,vagas_max`);
  if (!evRes.ok) return saida(502, { error: 'Não conseguimos abrir a inscrição agora. Tente de novo em instantes.' });
  const evs = await evRes.json().catch(() => []);
  const ev = Array.isArray(evs) && evs[0];
  if (!ev) return saida(404, { error: 'Esta aula não está com inscrições abertas.' });

  // A DATA VEM DE `live_proxima`, NUNCA DA COLUNA (03/09).
  // `eventos_live.data_hora` guarda a ocorrência ANTERIOR até `live_rolar_recorrentes()`
  // avançar a coluna — e ela só avança depois de `oferta_fecha_em`, não depois da aula.
  // No intervalo entre as duas coisas (02/09 22h → 06/09 03h, quatro dias) a coluna aponta
  // para uma aula que JÁ ACONTECEU, e o e-mail de confirmação — a primeira coisa que o
  // inscrito lê do produto — dizia "sua vaga está garantida … 02 de setembro". A landing
  // (`LiveInscricao.jsx:106`), o convite (`_convite-live.js:70`) e a sala
  // (`live-criar-sala.js:54`) já liam pela RPC; era esta rota que mantinha a segunda verdade.
  const proxRes = await sb('rpc/live_proxima', { method: 'POST', body: JSON.stringify({ p_slug: slug }) });
  if (!proxRes.ok) return saida(502, { error: 'Não conseguimos abrir a inscrição agora. Tente de novo em instantes.' });
  const prox = await proxRes.json().catch(() => null);
  if (!prox?.data_hora) return saida(404, { error: 'Esta aula não está com inscrições abertas.' });
  ev.data_hora = prox.data_hora;
  // A EDIÇÃO é a chave que separa uma semana da outra. `live_inscricoes` ganhou a coluna em
  // 03/09 e o gatilho `live_edicao_preencher` a garante mesmo se ninguém mandar — mandar
  // explicitamente aqui é o que deixa a intenção legível no lugar onde ela é decidida.
  const edicao = edicaoDe(prox.data_hora);

  // Vagas: contar ANTES de criar conta. A checagem é best-effort contra corrida (duas
  // inscrições simultâneas na última vaga passam), e isso é deliberado — recusar alguém
  // por causa de um empate custa mais do que uma vaga a mais na sala.
  if (ev.vagas_max) {
    // POR EDIÇÃO (03/09): sem o filtro, a contagem soma TODAS as semanas e a sala fecharia
    // por causa de gente que assistiu no mês passado. Hoje `vagas_max` é nulo e o ramo nem
    // roda — é justamente por isso que o erro passaria despercebido até o dia em que alguém
    // preenchesse o campo, e aí recusaria inscrito com a sala vazia.
    const cRes = await sb(`live_inscricoes?evento_id=eq.${ev.id}&edicao=eq.${edicao}&select=id`, { headers: { Prefer: 'count=exact' } });
    const total = Number(String(cRes.headers.get('content-range') || '').split('/')[1] || 0);
    if (total >= ev.vagas_max) return saida(409, { error: 'As vagas para esta aula se esgotaram.' });
  }

  // ── A conta ────────────────────────────────────────────────────────────────
  // Já existe? Não é erro: é o cliente que já usa a plataforma querendo assistir.
  let userId = null;
  let contaNova = false;
  const buscaRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (buscaRes.ok) {
    const found = await buscaRes.json().catch(() => ({}));
    const lista = Array.isArray(found?.users) ? found.users : [];
    userId = lista.find(u => String(u.email || '').toLowerCase() === email)?.id || null;
  }

  // Quem indicou? Aceita o CÓDIGO do parceiro (o que vai no link) ou o id cru, do mesmo jeito
  // que `vincular_upline` aceita no caminho do navegador. Resolver ANTES de criar a conta é o
  // que permite gravar o vínculo no mesmo upsert do perfil — um `update` depois poderia falhar
  // sozinho e deixar a conta órfã com cara de vinculada.
  let upline = null;
  if (ref) {
    const ehUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
    const filtro = ehUuid
      ? `id=eq.${encodeURIComponent(ref)}`
      : `codigo_indicacao=eq.${encodeURIComponent(ref.toUpperCase())}`;
    try {
      const r = await sb(`perfis?${filtro}&select=id,ativo&limit=1`);
      // `.ok` antes do corpo: um 400 daqui viraria "parceiro não existe" e o crédito iria
      // para o dono na rolagem de 24h — o vazio entregue como resposta, custando comissão.
      if (r.ok) { const [p] = await r.json().catch(() => []); if (p?.id && p.ativo !== false) upline = p.id; }
      else console.error('[live-inscrever] leitura do parceiro falhou', r.status, ref);
    } catch (e) { console.error('[live-inscrever] leitura do parceiro lançou:', e?.message); }
    if (!upline) console.warn('[live-inscrever] ref sem parceiro correspondente:', ref);
  }

  if (!userId) {
    const meta = { nome, whatsapp, role: 'explorador', lgpd_aceito: true, lgpd_data: new Date().toISOString(), origem_live: slug };
    const cRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: senhaAleatoria(), email_confirm: true, user_metadata: meta }),
    });
    const cData = await cRes.json().catch(() => ({}));
    if (!cRes.ok) {
      const msg = String(cData?.msg || cData?.error_description || cData?.error || cData?.message || '');
      // Corrida com outra inscrição do mesmo e-mail: segue sem conta, a inscrição vale.
      if (!/already.*(registered|exists)|been registered|duplicate/i.test(msg)) {
        console.error('[live-inscrever] conta não criada', cRes.status, msg.slice(0, 200));
      }
    } else {
      userId = cData?.id || cData?.user?.id || null;
      contaNova = !!userId;
      // Perfil com telefone e marketing de origem. Best-effort: sem isto a inscrição
      // continua válida, e o trigger de novo usuário já criou a linha básica.
      if (userId) {
        try {
          await sb('perfis?on_conflict=id', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({
              id: userId, nome, telefone: whatsapp, role: 'explorador',
              // O vínculo entra AQUI, na criação — e só quando há parceiro de verdade. Nunca
              // sobrescreve nada: esta linha só roda para conta NOVA. `indicacao_origem`
              // carimba a procedência, para o painel não confundir com o upline padrão.
              ...(upline && upline !== userId
                ? { indicado_por: upline, indicacao_origem: 'link_parceiro', ultima_indicacao_em: new Date().toISOString() }
                : {}),
              // A cidade vira o primeiro filtro útil do novo usuário: quem entra na
              // plataforma sem região definida vê o acervo do país inteiro e não
              // reconhece nada — a pior primeira impressão possível.
              endereco_cidade: cidade || null, endereco_uf: uf || null,
              lgpd_aceito: true, lgpd_data: meta.lgpd_data,
              mkt_utm_source: utm.utm_source || null, mkt_utm_medium: utm.utm_medium || null,
              mkt_utm_campaign: utm.utm_campaign || null, mkt_gclid: utm.gclid || null,
              // content/term entraram em 27/08: sem eles a inscricao na aula sabia a CAMPANHA
              // mas nao a PECA — e e a peca que decide qual criativo recebe verba.
              mkt_utm_content: utm.utm_content || null, mkt_utm_term: utm.utm_term || null,
              mkt_fbclid: utm.fbclid || null, mkt_referrer: utm.referrer || null,
              mkt_landing: `/live/${slug}`, mkt_capturado_em: new Date().toISOString(),
            }),
          });
        } catch { /* best-effort */ }
      }
    }
  }

  // ── A inscrição ────────────────────────────────────────────────────────────
  // `merge-duplicates` sobre (evento_id, email, edicao): reenviar o formulário atualiza os
  // dados em vez de estourar erro na cara de quem só clicou duas vezes. A `edicao` entrou na
  // chave em 03/09 — sem ela, a MESMA pessoa não conseguia se inscrever na aula da semana
  // seguinte: o upsert encontrava a linha antiga e apenas a atualizava, então a inscrição de
  // 09/09 "dava certo" sem existir, e ela não entrava em nenhuma lista da nova edição.
  const insRes = await sb('live_inscricoes?on_conflict=evento_id,email,edicao', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      evento_id: ev.id, edicao, user_id: userId, nome, email, whatsapp, cidade: cidade || null, uf: uf || null,
      origem: String(b.origem || utm.utm_source || utm.referrer || '').slice(0, 200) || null,
      utm,
    }),
  });
  // A inscrição é o produto desta rota: se ela não gravou, NÃO se pode dizer "inscrito".
  // Confirmar uma vaga que não existe é a falha que só aparece no dia da aula.
  if (!insRes.ok) {
    const det = await insRes.text().catch(() => '');
    console.error('[live-inscrever] inscrição NÃO gravada', insRes.status, det.slice(0, 300));
    return saida(500, { error: 'Não conseguimos concluir a sua inscrição. Tente de novo em instantes.' });
  }

  // ── Meta: evento Lead ──────────────────────────────────────────────────────
  // AQUI, e não antes: a inscrição já está gravada (o `if (!insRes.ok)` acima aborta), então
  // este Lead descreve um fato. Disparado antes, ensinaria o Meta a comprar o público de uma
  // inscrição que não aconteceu — e o erro só apareceria semanas depois, na forma de verba
  // otimizada para o lado errado.
  //
  // O `fbc` é reconstruído a partir do `fbclid` que a landing capturou (`marketing.js` grava
  // a atribuição de primeiro toque). O formato é o que o Meta especifica: fb.1.<ms>.<fbclid>.
  // Sem ele o evento chega, mas casa com muito menos gente.
  const evId = leadEventId(slug, email);
  const fbclid = String(utm.fbclid || '').trim();
  const leadRes = await enviarLeadCapi({
    eventoSlug: slug, email, telefone: whatsapp, nome, cidade, uf, userId,
    eventId: evId,
    fbc: fbclid ? `fb.1.${Date.now()}.${fbclid}` : null,
    fbp: String(b.fbp || '').trim() || null,
    clientIp: ip !== 'sem-ip' ? ip : null,
    userAgent: req.headers['user-agent'] || null,
    sourceUrl: `${APP_URL}/live/${slug}`,
  }).catch((e) => ({ ok: false, erro: String(e?.message || e) }));

  // RASTRO DO DESFECHO. O CAPI é dormente até as envs existirem, e um helper dormente devolve
  // silêncio — exatamente igual a um que funcionou. Sem esta linha, "o Lead está sendo
  // enviado?" só teria resposta abrindo o Events Manager do Meta e torcendo. Agora a resposta
  // está no banco, e `skipped: capi_inativo` diz por extenso QUAL não foi o motivo.
  try {
    await sb('eventos_atividade', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        user_id: userId, tipo: 'meta_lead', alvo: `live:${slug}`,
        detalhe: leadRes?.ok ? `enviado (${evId})`
          : leadRes?.skipped ? `NAO enviado — ${leadRes.skipped}`
          : `FALHOU — ${leadRes?.http || leadRes?.erro || 'desconhecido'}`,
      }),
    });
  } catch { /* rastro best-effort: nunca derruba a inscrição */ }

  // ── Confirmação por e-mail ─────────────────────────────────────────────────
  // Falha de e-mail NÃO derruba a inscrição (ela já está gravada, que é o que importa),
  // mas vai para o log: uma confirmação que não chega vira falta na aula.
  const quando = new Date(ev.data_hora).toLocaleString('pt-BR', {
    timeZone: 'America/Bahia', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit',
  });
  const primeiro = nome.split(' ')[0];
  const linkSenha = contaNova ? `${APP_URL}/#/redefinir-senha` : `${APP_URL}/#/login`;
  try {
    await enviarEmail({
      to: email,
      subject: `Inscrição confirmada — ${ev.titulo}`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
        <p style="font-size:15px">Olá, ${esc(primeiro)}!</p>
        <p style="font-size:14px;line-height:1.7">Sua vaga está garantida em <strong>${esc(ev.titulo)}</strong>.</p>
        <p style="font-size:15px;line-height:1.7;background:#f1f5f9;border-radius:10px;padding:14px 16px">
          📅 <strong>${esc(quando)}</strong><br>
          <span style="font-size:13px;color:#475569">Horário de Brasília</span>
        </p>
        <p style="font-size:14px;line-height:1.7">O <strong>link da sala</strong> chega neste mesmo e-mail: um lembrete no dia anterior e outro pouco antes de começar. Não precisa fazer mais nada.</p>
        ${ev.link_grupo ? `<p style="font-size:14px;line-height:1.7">Se quiser acompanhar os avisos por lá também, o grupo está aberto:</p>
        <p style="margin:18px 0"><a href="${esc(ev.link_grupo)}" style="background:#16a34a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;font-size:14px">Entrar no grupo do WhatsApp →</a></p>` : ''}
        ${contaNova ? `<p style="font-size:14px;line-height:1.7">Também criamos o seu acesso à plataforma, onde vou mostrar as oportunidades ao vivo. Defina a sua senha quando quiser: <a href="${esc(linkSenha)}">${esc(linkSenha)}</a></p>` : ''}
        <p style="font-size:13px;line-height:1.7;color:#475569">Se não puder comparecer, é só responder este e-mail avisando.</p>
        <p style="font-size:12px;color:#94a3b8;margin-top:24px">BidPro Brasil</p>
      </div>`,
      text: `Olá, ${primeiro}!\n\nSua vaga está garantida em ${ev.titulo}.\n\n${quando} (horário de Brasília)\n\nO link da sala chega neste mesmo e-mail: um lembrete no dia anterior e outro pouco antes de começar.\n${ev.link_grupo ? `\nGrupo do WhatsApp (opcional): ${ev.link_grupo}\n` : ''}${contaNova ? `\nSeu acesso à plataforma foi criado. Defina a sua senha em: ${linkSenha}\n` : ''}\nBidPro Brasil`,
      meta: { userId, tipo: 'live_inscricao' },
    });
  } catch (e) {
    console.error('[live-inscrever] e-mail de confirmação falhou', e?.message);
  }

  // CÓDIGO DE INDICAÇÃO de quem acabou de se inscrever — é o que permite o "Convide um amigo"
  // aparecer já na tela de confirmação, que é o instante de maior disposição para compartilhar.
  // Simples LEITURA: desde `codigo_indicacao_para_todos_desde_o_cadastro` o gatilho garante o
  // código no INSERT do perfil, então não há o que gerar aqui (e o servidor não poderia: a RPC
  // `gerar_codigo_indicacao` exige `auth.uid()`, que é nulo com a service key).
  let codigoIndicacao = null;
  if (userId) {
    try {
      const rCod = await sb(`perfis?id=eq.${userId}&select=codigo_indicacao&limit=1`);
      // `.ok` checado: um 4xx do PostgREST tem corpo JSON válido, e o `.json()` direto viraria
      // "essa pessoa não tem código" — o card sumiria da tela sem ninguém saber por quê.
      if (rCod.ok) { const [pc] = await rCod.json().catch(() => []); codigoIndicacao = pc?.codigo_indicacao || null; }
      else console.error('[live-inscrever] leitura do codigo_indicacao falhou', rCod.status);
    } catch (e) { console.error('[live-inscrever] codigo_indicacao', e?.message || e); }
  }

  return saida(200, {
    ok: true, contaNova, link_grupo: ev.link_grupo || null, titulo: ev.titulo, data_hora: ev.data_hora,
    codigo_indicacao: codigoIndicacao,
    // O NAVEGADOR RECEBE O ID PRONTO, não a regra para calculá-lo. Pixel e CAPI mandando o
    // mesmo `event_id` fazem o Meta contar UMA conversão em vez de duas; duplicar a fórmula
    // nos dois lados seria criar duas cópias de uma regra que só funciona enquanto forem
    // idênticas — e o Purchase já carrega essa dívida (ver _meta-capi.js).
    lead_event_id: evId,
    // Diz à tela se vale a pena disparar o Pixel. Não é obrigatório para funcionar (o
    // `metaTrack` já é no-op sem pixel), mas deixa o estado VISÍVEL em vez de suposto.
    meta_capi: capiAtivo(),
    // Número vem do BANCO e não do bundle: variável VITE_ obriga novo deploy para
    // trocar, e numa página de campanha isso é número errado no ar até alguém lembrar.
    whatsapp_direto: String(ev.whatsapp_direto || '').replace(/\D/g, '') || null,
  });
}
