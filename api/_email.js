/**
 * Helper de envio de e-mail via Resend (Edge-compatível).
 * Suporta anexos: { filename, path } (URL que o Resend busca) ou { filename, content } (base64).
 * Retorna { ok, id, error }.
 */
import { registrarUso } from './_uso.js';

const RESEND_KEY = process.env.RESEND_API_KEY;
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// ─── ORÇAMENTO DIÁRIO (13/09) ────────────────────────────────────────────────────────────
// Plano Free do Resend: 100 e-mails/dia, sem contrato de plano pago por decisão do dono (usar
// o máximo do teto grátis agora, decidir upgrade quando o volume pedir). O `/signup` do
// Supabase Auth manda e-mail de confirmação SÍNCRONO pela MESMA conta Resend, e um cadastro
// não pode esperar até amanhã — mas aquele envio não passa por este arquivo (é o GoTrue
// falando SMTP direto) e por isso NUNCA aparece em `emails_log`. RESERVA_AUTH é uma margem às
// cegas para não deixar nosso próprio volume (relatório pronto, alertas, etc.) engolir a cota
// que o cadastro de cliente novo precisa no mesmo instante.
const TETO_DIARIO_RESEND = 100;
const RESERVA_AUTH = 20;
const ORCAMENTO_ENVIAREMAIL = TETO_DIARIO_RESEND - RESERVA_AUTH;

// Quantos e-mails (por este helper OU por qualquer outro caminho que grave em `emails_log`,
// como `enviar-alertas-cron.js`) já saíram desde a meia-noite UTC — que é a janela que o
// Resend usa pro teto diário. `null` = não consegui checar; tratado como "sem margem" pelo
// chamador (fail-closed aqui, ao contrário do resto do arquivo, porque estourar a cota real
// bloqueia o cadastro de cliente novo pra todo mundo, não só um envio nosso).
async function enviadosHojeUTC() {
  if (!SB_URL || !SB_KEY) return null;
  try {
    const inicioDia = new Date();
    inicioDia.setUTCHours(0, 0, 0, 0);
    const r = await fetch(
      `${SB_URL}/rest/v1/emails_log?select=id&status=in.(enviado,entregue)&enviado_em=gte.${inicioDia.toISOString()}`,
      {
        method: 'HEAD',
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'count=exact' },
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!r.ok) return null;
    const total = Number(String(r.headers.get('content-range') || '').split('/').pop());
    return Number.isFinite(total) ? total : null;
  } catch { // padrao-ok: falha de rede vira null de propósito — orcamentoRestanteHoje() trata null como "sem margem" (fail-closed, ver comentário acima)
    return null;
  }
}

// Exportado para `enviar-alertas-cron.js` e `drenar-fila-emails-cron.js` — usar SÓ como
// leitura informativa (ex.: decidir se vale a pena nem começar um lote). NÃO é mais o gate
// que decide se um envio individual pode sair: ver `reservarOrcamentoEmail` abaixo.
export async function orcamentoRestanteHoje() {
  const enviados = await enviadosHojeUTC();
  if (enviados == null) return 0; // não sei quanto já saiu → melhor represar que estourar
  return Math.max(0, ORCAMENTO_ENVIAREMAIL - enviados);
}

// ─── RESERVA ATÔMICA (14/09) ──────────────────────────────────────────────────────────────
// `orcamentoRestanteHoje()` é uma LEITURA (conta emails_log) — três chamadores independentes
// (esta função, `enviar-alertas-cron.js` num loop de minutos, `drenar-fila-emails-cron.js`)
// cada um lia sua própria foto do orçamento e decidia sozinho, sem trava nenhuma entre eles.
// Enquanto o cron de alertas processa um lote, os outros dois continuam vendo uma contagem
// que ainda não reflete os envios em andamento — e cada um, isoladamente, "tinha margem".
// Resultado real (13/09): 4 e-mails devolvidos pelo Resend com "daily email sending quota"
// mesmo com o represamento ativo. MESMA classe de bug do Bright Data (sub-cota em memória,
// sem reserva — ver api/_brightdata.js), MESMA correção: um único INSERT...ON CONFLICT...WHERE
// no banco, que soma e checa o teto na MESMA operação — dois chamadores concorrentes não
// conseguem os dois passar pelo mesmo slot. Todo envio de verdade (`enviarEmail`, o loop de
// `enviar-alertas-cron.js`, a drenagem da fila) precisa reservar AQUI antes de mandar.
export async function reservarOrcamentoEmail() {
  if (!SB_URL || !SB_KEY) return { permitido: false, motivo: 'sem_credencial' };
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/reservar_orcamento_email`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_teto: ORCAMENTO_ENVIAREMAIL }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return { permitido: false, motivo: 'rpc_indisponivel', detalhe: `HTTP ${r.status}` };
    const j = await r.json().catch(() => null);
    if (!j || typeof j !== 'object') return { permitido: false, motivo: 'rpc_sem_corpo' };
    return j;
  } catch (e) { // fail-closed: não saber se há margem é tratado como "sem margem"
    return { permitido: false, motivo: 'rpc_indisponivel', detalhe: String(e?.message || e).slice(0, 120) };
  }
}

// Represa um e-mail que não coube no orçamento de hoje. Guarda o payload inteiro pra
// `drenar-fila-emails-cron.js` chamar `enviarEmail` de novo amanhã — inclusive reaplicando a
// supressão (a lista pode ter mudado entre hoje e o dia do envio real).
async function enfileirar({ to, cc, subject, html, text, replyTo, meta }) {
  if (!SB_URL || !SB_KEY) return false;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/emails_fila`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destinatario: (Array.isArray(to) ? to : [to]).filter(Boolean).join(','),
        cc: cc?.length ? (Array.isArray(cc) ? cc : [cc]) : null,
        assunto: (subject || '').slice(0, 300),
        html: html || null,
        texto_plano: text || null,
        reply_to: replyTo || null,
        tipo: meta?.tipo || null,
        user_id: meta?.userId || null,
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// Registra o histórico de e-mails enviados (o Resend só retém por tempo limitado).
// Só metadados — assunto/tipo/status, nunca o corpo. Best-effort: NUNCA quebra o
// envio. Alimenta o card "E-mails recebidos" do Cliente 360.
async function registrarEmailLog(rows) {
  if (!SB_URL || !SB_KEY || !rows?.length) return;
  try {
    await fetch(`${SB_URL}/rest/v1/emails_log`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(rows),
    });
  } catch { /* histórico é best-effort */ }
}

// ─── SUPRESSÃO: NÃO INSISTIR EM ENDEREÇO PROVADAMENTE MORTO (27/08) ──────────────────────
// Ver `supabase/migrations/emails_supressao_nao_insistir_em_endereco_morto.sql` para o
// porquê e para as três regras. Aqui só se LÊ a decisão que o banco já tomou.
//
// O GATE VALE POR PADRÃO, e a lista abaixo é a exceção. A direção importa: um tipo NOVO de
// e-mail nasce coberto pelo gate, e o pior que acontece é não insistir num endereço que já
// provou não existir — nada se perde, porque ele não chegaria de qualquer forma. A direção
// contrária (nasce liberado) deixaria cada disparo novo escapar em silêncio, que é o defeito
// que este arquivo está consertando.
//
// Entra na lista o que é JURÍDICO, FINANCEIRO ou de SEGURANÇA DA CONTA: aqui a tentativa
// vale mesmo com pouca chance de chegar, e o custo de reputação de um envio único é baixo
// perto do de engolir um contrato ou um aviso de acesso indevido.
const SUPRESSAO_NAO_SE_APLICA = new Set([
  'contrato', 'assinatura', 'parecer_juridico', 'juridica_preliminar', 'honorario_exito',
  'pagamento', 'estorno', 'estorno_comissao', 'kyc_documento', 'boas_vindas',
]);

// Devolve { suprimidos:Set, verificado:boolean }.
// `verificado:false` NÃO é "está limpo" — é "não consegui checar", e quem chama registra a
// diferença. Fundir os dois seria a forma de falha nº 1 do CLAUDE.md dentro do próprio
// conserto que existe para evitá-la.
// Exportado porque NEM TODO ENVIO PASSA POR `enviarEmail` — `enviar-alertas-cron.js` chama a
// API do Resend direto, e é justamente ele que manda o `oportunidades`, o maior volume da
// casa e o disparo que reincidiu nos dois endereços com bounce. Um gate que cobrisse só este
// helper teria cara de conserto sem pegar o principal ofensor.
export async function consultarSupressao(destinos, tipo) {
  const vazio = new Set();
  if (SUPRESSAO_NAO_SE_APLICA.has(tipo || '')) return { suprimidos: vazio, verificado: true };
  if (!SB_URL || !SB_KEY || !destinos.length) return { suprimidos: vazio, verificado: false };
  try {
    // RPC com ARRAY no CORPO, e não lista na URL. Endereço com '+' (user+tag@gmail.com) vira
    // ESPAÇO ao decodificar uma query string: o filtro não casaria e o endereço suprimido
    // passaria — em silêncio, que é justamente o defeito que este gate existe para fechar.
    const r = await fetch(`${SB_URL}/rest/v1/rpc/emails_suprimidos`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_destinatarios: destinos.map((d) => String(d).toLowerCase()) }),
      signal: AbortSignal.timeout(4000),
    });
    // `.ok` checado de propósito: o PostgREST devolve 4xx com corpo JSON, e um `.json()`
    // direto viraria lista vazia — ou seja, "ninguém suprimido" por causa de um erro.
    if (!r.ok) return { suprimidos: vazio, verificado: false };
    const linhas = await r.json();
    if (!Array.isArray(linhas)) return { suprimidos: vazio, verificado: false };
    return { suprimidos: new Set(linhas.map((l) => String(l.destinatario).toLowerCase())), verificado: true };
  } catch {
    return { suprimidos: vazio, verificado: false };
  }
}

// meta (opcional): { tipo, userId } — categoriza e vincula o e-mail ao cliente.
// Checa o orçamento diário ANTES de tudo; represa em `emails_fila` quando estoura. Quem
// precisa mandar de verdade AGORA e já sabe que o orçamento permite (o cron que drena a
// fila, logo abaixo) chama `enviarEmailAgora` direto — nunca esta função, senão um segundo
// estouro no meio da drenagem re-enfileiraria o MESMO e-mail como uma linha nova.
export async function enviarEmail({ from, to, cc, subject, html, text, attachments, replyTo, headers, meta }) {
  const destinos = (Array.isArray(to) ? to : [to]).filter(Boolean);
  const reserva = await reservarOrcamentoEmail();
  if (!reserva.permitido) {
    const enfileirou = await enfileirar({ to: destinos, cc, subject, html, text, replyTo, meta });
    await registrarEmailLog(destinos.map((dest) => ({
      user_id: meta?.userId || null,
      destinatario: String(dest).toLowerCase().slice(0, 200),
      assunto: (subject || '').slice(0, 300),
      tipo: meta?.tipo || null,
      status: 'enfileirado',
      erro: enfileirou ? 'orcamento diario do Resend excedido — represado p/ envio no dia seguinte' : 'orcamento excedido E falha ao enfileirar — e-mail perdido',
    })));
    return { ok: false, error: 'orcamento_diario_excedido', enfileirado: enfileirou };
  }
  return enviarEmailAgora({ from, to, cc, subject, html, text, attachments, replyTo, headers, meta });
}

// Envio de verdade, sem checar orçamento (quem chama já garantiu isso). Exportado só para
// `drenar-fila-emails-cron.js` — todo o resto deve chamar `enviarEmail`.
export async function enviarEmailAgora({ from, to, cc, subject, html, text, attachments, replyTo, headers, meta }) {
  const destinos = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!RESEND_KEY) {
    // Sem a key não sai e-mail nenhum — e, sem este registro, isso era INVISÍVEL (o return
    // acontecia antes do log). Um problema de configuração precisa aparecer no 360/health-check.
    await registrarEmailLog(destinos.map((dest) => ({
      user_id: meta?.userId || null,
      destinatario: String(dest).toLowerCase().slice(0, 200),
      assunto: (subject || '').slice(0, 300),
      tipo: meta?.tipo || null,
      status: 'falha',
      erro: 'RESEND_API_KEY ausente',
    })));
    return { ok: false, error: 'sem_resend' };
  }
  // ─── O GATE ────────────────────────────────────────────────────────────────────────────
  const { suprimidos, verificado } = await consultarSupressao(destinos, meta?.tipo);
  const permitidos = destinos.filter((d) => !suprimidos.has(String(d).toLowerCase()));
  const barrados = destinos.filter((d) => suprimidos.has(String(d).toLowerCase()));

  // Toda supressão vira LINHA no emails_log. Um e-mail que deixou de sair sem deixar rastro
  // seria indistinguível de um e-mail que nunca foi pedido — e aí o gate viraria o próximo
  // buraco silencioso, em vez do conserto de um.
  if (barrados.length) {
    await registrarEmailLog(barrados.map((dest) => ({
      user_id: meta?.userId || null,
      destinatario: String(dest).toLowerCase().slice(0, 200),
      assunto: (subject || '').slice(0, 300),
      tipo: meta?.tipo || null,
      status: 'suprimido',
      erro: 'endereco na lista de supressao (bounce permanente/repetido ou reclamacao)',
    })));
  }
  if (!permitidos.length) {
    // Diz QUAL "não" — como `e.semCota` no freio do Bright Data. Carimbar `ok:true` aqui
    // faria o chamador contar como entregue algo que não saiu; carimbar só `ok:false` sem o
    // motivo faria um cron de alerta gritar "falha de envio" onde houve decisão correta.
    return { ok: false, error: 'suprimido', suprimido: true, destinatarios_suprimidos: barrados.length };
  }

  const payload = {
    from: from || 'BidPro Brasil <noreply@bidprobrasil.com.br>',
    to: permitidos,
    subject,
  };
  if (cc?.length) payload.cc = Array.isArray(cc) ? cc : [cc];
  if (html) payload.html = html;
  if (text) payload.text = text;
  if (replyTo) payload.reply_to = replyTo;
  if (headers) payload.headers = headers;
  if (attachments?.length) payload.attachments = attachments;

  let out;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      out = { ok: false, error: data?.message || `resend_${res.status}` };
    } else {
      const n = payload.to.length + (payload.cc?.length || 0); // destinatários faturados
      registrarUso('resend', 'email', { unidades: n });
      out = { ok: true, id: data?.id || null };
    }
  } catch (e) {
    out = { ok: false, error: String(e?.message || e) };
  }
  // Loga um registro por destinatário (to) — inclusive falhas, p/ auditoria.
  // O `await` é ESSENCIAL, não estilo: sem ele a função serverless respondia e podia ser
  // congelada antes de o insert completar, perdendo o registro de forma intermitente. Foi o
  // que aconteceu com as boas-vindas de 31/07, 01/08 e 02/08 — os e-mails SAÍRAM (uso do
  // Resend registrado no mesmo segundo), mas sumiram do card "E-mails recebidos" do 360.
  await registrarEmailLog(payload.to.map((dest) => ({
    user_id: meta?.userId || null,
    destinatario: String(dest).toLowerCase().slice(0, 200),
    assunto: (subject || '').slice(0, 300),
    tipo: meta?.tipo || null,
    status: out.ok ? 'enviado' : 'falha',
    resend_id: out.ok ? (out.id || null) : null,
    // Envio bem-sucedido em que a supressão NÃO pôde ser consultada fica marcado. O envio é
    // a decisão certa (derrubar e-mail transacional porque o banco piscou seria pior), mas
    // "mandei sem conferir" não pode virar "conferi e estava limpo" — é a diferença que a
    // lista de formas de falha do CLAUDE.md manda nunca apagar.
    erro: out.ok
      ? (verificado ? null : 'enviado sem verificar a lista de supressao')
      : String(out.error || '').slice(0, 300),
  })));
  return out;
}

// E-mail de BOAS-VINDAS + aviso anti-"squatting", disparado UMA vez por conta (em qualquer
// caminho de cadastro). Como o acesso pode ser liberado sem etapa de confirmação, avisamos
// o dono do endereço; se não foi ele, recupera via "Esqueci minha senha" (o link só chega
// no e-mail dele). Best-effort: quem chama trata falha sem derrubar o fluxo.
export async function enviarBoasVindas({ to, nome, origin, userId }) {
  const base = origin || process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
  const loginUrl = `${base}/#/login`;
  const primeiroNome = String(nome || '').trim().split(' ')[0] || 'Investidor';
  return enviarEmail({
    to,
    subject: 'Bem-vindo(a) à BidPro Brasil — sua conta foi criada',
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1e293b">
      <h2 style="color:#0D63DB;margin:0 0 12px">Olá, ${primeiroNome}! 👋</h2>
      <p style="font-size:15px;line-height:1.6">Sua conta na <strong>BidPro Brasil</strong> foi criada e já está ativa. Você pode buscar leilões em todo o Brasil, usar a calculadora de arrematação e acessar os materiais.</p>
      <p style="margin:20px 0"><a href="${loginUrl}" style="background:#0D63DB;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:700;display:inline-block">Acessar minha conta</a></p>
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:12px 16px;font-size:13px;line-height:1.6;color:#9a3412">
        <strong>Não reconhece este cadastro?</strong> Se não foi você quem criou esta conta, alguém pode ter usado o seu e-mail. Você pode assumir o acesso em <a href="${loginUrl}" style="color:#9a3412;font-weight:700">${loginUrl.replace(/^https?:\/\//, '')}</a> usando <strong>"Esqueci minha senha"</strong> (o link de redefinição só chega neste e-mail), ou responder a esta mensagem que ajudamos.
      </div>
      <p style="font-size:12px;color:#94a3b8;margin-top:20px">BidPro Brasil — Leilão &amp; Investimentos</p>
    </div>`,
    text: `Olá, ${primeiroNome}!\n\nSua conta na BidPro Brasil foi criada e já está ativa. Acesse em ${loginUrl}.\n\nNão reconhece este cadastro? Se não foi você, alguém pode ter usado o seu e-mail. Assuma o acesso em ${loginUrl} usando "Esqueci minha senha" (o link só chega neste e-mail), ou responda a esta mensagem.\n\nBidPro Brasil — Leilão & Investimentos`,
    meta: { tipo: 'boas_vindas', userId: userId || null },
  });
}
