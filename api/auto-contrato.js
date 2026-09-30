import { getUser, getUserRole } from './_auth.js';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, getIP, rateLimitedRes } from './_rate-limit.js';
import { auditLog } from './_audit.js';
import { sanitizeName, sanitizeEmail } from './_sanitize.js';
import { alertarErro } from './_error-alert.js';
import { termoAssessoria } from './_termo-assessoria.js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// O texto do contrato de assessoria vive em api/_termo-assessoria.js (30/09): o mesmo termo sai
// no checkout (aqui) e na arrematação ATRIBUÍDA pela equipe, com a procuração particular anexa.


const TEMPLATE_CLUBE = `CONTRATO DE ADESÃO AO CLUBE DE NEGÓCIOS BIDPRO BRASIL

CONTRATANTE: NOGUEIRA EMPREENDIMENTOS LTDA, pessoa jurídica de direito privado, inscrita no CNPJ nº 02.311.492/0001-61, com sede na cidade de Feira de Santana, Estado da Bahia, doravante denominada simplesmente CONTRATANTE.

MEMBRO: [NOME DO SIGNATÁRIO], inscrito no CPF nº [CPF/CNPJ DO SIGNATÁRIO], residente em [ENDEREÇO DO SIGNATÁRIO], doravante denominado simplesmente MEMBRO.

As partes têm entre si justo e contratado:

CLÁUSULA 1ª — DO OBJETO
O presente instrumento tem por objeto a adesão do MEMBRO ao Clube de Negócios BidPro Brasil, programa de mentoria e investimento coletivo em leilões imobiliários operado pela CONTRATANTE.

CLÁUSULA 2ª — DOS BENEFÍCIOS DO CLUBE
A adesão confere ao MEMBRO: (a) participação em sessões mensais de mentoria em grupo; (b) análises prioritárias de imóveis em leilão; (c) acesso à plataforma BidPro Brasil com recursos exclusivos; (d) networking com demais membros do clube; (e) relatórios mensais de oportunidades de leilão.

CLÁUSULA 3ª — DO VALOR E FORMA DE PAGAMENTO
A adesão ao Clube é remunerada conforme modalidade escolhida pelo MEMBRO no ato da contratação: (a) R$ 5.000,00 (cinco mil reais) mensais, devidos até o dia 10 de cada mês, totalizando R$ 60.000,00 (sessenta mil reais) ao longo dos 12 (doze) meses de fidelidade — modalidade sujeita a renovação automática após o período de fidelidade, salvo aviso de cancelamento; ou (b) R$ 48.000,00 (quarenta e oito mil reais) em pagamento único à vista via PIX ou cartão de crédito, com desconto de 20% (vinte por cento) sobre o total parcelado — modalidade que NÃO configura renovação automática, encerrando-se o vínculo ao término dos 12 (doze) meses sem qualquer cobrança adicional. O não pagamento de parcela mensal por mais de 30 (trinta) dias corridos ensejará a suspensão automática do acesso até a regularização.

Todos os pagamentos devidos no âmbito deste contrato — inclusive, quando aplicável, os honorários de êxito relativos aos serviços de assessoria para arrematação incluídos na adesão ao Clube — deverão ser processados EXCLUSIVAMENTE pelos meios de pagamento disponibilizados na Plataforma BidPro Brasil. O pagamento de qualquer valor por fora da Plataforma — diretamente à CONTRATANTE, a prepostos, a terceiros ou por qualquer meio informal — configura, por si só, quebra contratual por tentativa de extravio de valores, autorizando a rescisão imediata por justa causa (Cláusula 7ª) e eximindo a CONTRATANTE de qualquer responsabilidade sobre a continuidade das etapas subsequentes do fluxo de arrematação, sem prejuízo da exigibilidade integral dos valores pactuados.

CLÁUSULA 4ª — DO PRAZO E FIDELIDADE
O presente contrato tem prazo mínimo de fidelidade de 12 (doze) meses a contar da assinatura, independentemente da modalidade de pagamento escolhida. Após esse período, o MEMBRO poderá cancelar a adesão mediante aviso prévio de 30 (trinta) dias. A rescisão imotivada dentro do prazo de fidelidade sujeitará o MEMBRO ao pagamento integral das mensalidades restantes até o término dos 12 meses.

CLÁUSULA 5ª — DAS OBRIGAÇÕES DO MEMBRO
O MEMBRO obriga-se a: (a) efetuar os pagamentos nas datas acordadas; (b) utilizar as informações e análises do Clube exclusivamente para uso próprio, sendo vedada a divulgação a terceiros; (c) assinar o presente instrumento em até 30 (trinta) dias a contar do envio do link de assinatura, sob pena de cancelamento e estorno do valor pago.

CLÁUSULA 6ª — DA CONFIDENCIALIDADE E LGPD
As informações compartilhadas no âmbito do Clube são de uso exclusivo dos membros. O tratamento de dados pessoais observará a Lei nº 13.709/2018 (LGPD). Notificações e comunicações serão realizadas pelos dados de contato informados na assinatura.

CLÁUSULA 7ª — DA RESCISÃO
O descumprimento de qualquer cláusula por qualquer das partes poderá ensejar rescisão imediata, sem prejuízo das obrigações vencidas.

CLÁUSULA 8ª — DO FORO
Fica eleita a Comarca de Feira de Santana/BA para dirimir quaisquer dúvidas ou litígios, com renúncia expressa a qualquer outro foro.

Feira de Santana, _____ de _____________ de 20____.

CONTRATANTE:
NOGUEIRA EMPREENDIMENTOS LTDA
CNPJ 02.311.492/0001-61

_______________________________________
Assinatura

MEMBRO:
[NOME DO SIGNATÁRIO]
[CPF/CNPJ DO SIGNATÁRIO]

_______________________________________
Assinatura`;

export default async function handler(req, res) {
  const ip = getIP(req);
  const rl = await checkRateLimit(`auto-contrato:${ip}`, 10, 60_000);
  if (!rl.ok) return rateLimitedRes(res, rl.resetAt);

  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autorizado' }); return; }
  if (req.method !== 'POST') return res.status(405).end();

  const { userId: userIdRaw, planoKey, nomeUsuario: nomeRaw, emailUsuario: emailRaw } = req.body || {};

  // Garante que o usuário só pode gerar contrato para si mesmo (exceto admin/consultor)
  const { getUserRoleById } = await import('./_auth.js');
  const callerRole = await getUserRoleById(user.id);
  const isStaff = ['admin', 'consultor', 'analista', 'advogado'].includes(callerRole);
  const userId = isStaff ? (userIdRaw || user.id) : user.id;

  if (!planoKey || !['assessorado', 'clube'].includes(planoKey)) {
    return res.status(400).json({ error: 'planoKey deve ser assessorado ou clube' });
  }
  // Sanitiza ANTES da trava de elegibilidade — a trava usa `emailUsuario`. Enquanto estes dois
  // `const` ficavam DEPOIS do gate, o acesso caía na zona morta temporal (ReferenceError), o
  // catch fail-closed engolia e TODO self-service de 'assessorado' devolvia 502
  // 'nao_foi_possivel_validar_elegibilidade' — parecia inelegibilidade, era bug de ordem.
  const nomeUsuario = sanitizeName(nomeRaw, 200);
  const emailUsuario = sanitizeEmail(emailRaw);
  if (emailRaw && !emailUsuario) {
    return res.status(400).json({ error: 'emailUsuario inválido' });
  }
  // TRAVA ABSOLUTA (dono): a assessoria é EXCLUSIVA do Investidor Pro. A regra não pode
  // viver só na tela — sem isto, um POST direto aqui geraria o contrato de assessoria para
  // um Explorador. Staff (atribuição manual) passa; 'clube' NÃO entra (já inclui assessoria,
  // e o gate devolveria clube_incluido). Só self-service de 'assessorado' é barrado.
  if (planoKey === 'assessorado' && !isStaff) {
    try {
      const { podeContratarAssessoria } = await import('./_assessoria.js');
      const gate = await podeContratarAssessoria({ userId, email: emailUsuario || user.email, role: callerRole });
      if (!gate.podeContratar) {
        return res.status(409).json({ error: 'requer_investidor_pro', motivo: gate.motivo });
      }
    } catch (e) {
      // Fail-CLOSED nesta trava: se não deu para confirmar a elegibilidade, não gera o contrato.
      // Loga a causa — foi um erro mudo aqui que escondeu a TDZ do emailUsuario por semanas.
      console.error('[auto-contrato] gate de assessoria falhou:', String(e?.message || e));
      return res.status(502).json({ error: 'nao_foi_possivel_validar_elegibilidade' });
    }
  }

  // Tenta buscar nome do perfil do usuário
  let nomeContrato = nomeUsuario || '';
  if (userId) {
    try {
      const { data: perfil } = await supabase.from('perfis').select('nome').eq('id', userId).single();
      if (perfil?.nome) nomeContrato = perfil.nome;
    } catch (_) {}
  }

  const titulo = planoKey === 'assessorado'
    ? 'Contrato de Assessoria para Aquisição de Imóvel em Leilão'
    : 'Contrato de Adesão ao Clube de Negócios BidPro Brasil';

  const conteudo = (planoKey === 'assessorado' ? termoAssessoria() : TEMPLATE_CLUBE)
    .replace(/\[NOME DO SIGNATÁRIO\]/gi, nomeContrato)
    .replace(/\[NOME\]/gi, nomeContrato);

  const { data, error } = await supabase
    .from('contratos_link')
    .insert({
      titulo,
      conteudo,
      tipo_contrato: 'servico',
      status: 'aguardando_assinatura',
      requer_assinatura: true,
      criado_por: userId || null,
      assinante_email: emailUsuario || null,
      plano_key: planoKey,
      produto_tipo: 'plano',
      // KYC OBRIGATÓRIO na assinatura de assessoria/clube (pedido do dono): o signatário
      // envia SELFIE (verificacao_identidade) + FOTO DO DOCUMENTO (docs_extras_exigidos) antes
      // de assinar. As imagens ficam em contratos_link.docs_identidade e passam a compor o
      // comprovante de aceite (prova de autoria de quem contratou).
      kyc_incluido: true,
      verificacao_identidade: 'selfie',
      docs_extras_exigidos: ['foto_doc'],
    })
    .select('token, id')
    .single();

  if (error || !data) {
    console.error('auto-contrato insert error:', error);
    return res.status(500).json({ error: 'Erro ao criar contrato' });
  }

  // ENFORCEMENT: cria o "contrato pendente" que BLOQUEIA o acesso à plataforma até a assinatura
  // (lido por ContratoObrigatorio). Prazo de 30 dias (aviso dispensável); após, bloqueio de tela
  // cheia. Idempotente: não duplica se já houver um pendente 'aguardando' deste plano p/ o usuário.
  if (userId) {
    try {
      const { data: jaPend } = await supabase.from('contratos_pendentes')
        .select('id').eq('user_id', userId).eq('produto_id', planoKey).eq('status', 'aguardando').maybeSingle();
      if (!jaPend) {
        const expira = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        await supabase.from('contratos_pendentes').insert({
          user_id: userId, produto_tipo: 'plano', produto_id: planoKey,
          contrato_link_id: data.id, status: 'aguardando', expira_em: expira,
        });
      }
    } catch (e) { console.error('auto-contrato pendente:', e.message); }
  }

  // Origin/Host vêm do cliente e o link leva o token de assinatura — usa o domínio do servidor.
  const origin = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
  return res.status(200).json({
    token: data.token,
    url: `${origin}#/c/${data.token}`,
  });
}
