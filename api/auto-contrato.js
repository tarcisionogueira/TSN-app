import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const TEMPLATE_ASSESSORADO = `CONTRATO DE ASSESSORIA PARA AQUISIÇÃO DE IMÓVEL EM LEILÃO

CONTRATANTE: NOGUEIRA EMPREENDIMENTOS LTDA, pessoa jurídica de direito privado, inscrita no CNPJ nº 02.311.492/0001-61, com sede na cidade de Feira de Santana, Estado da Bahia, doravante denominada simplesmente CONTRATANTE.

CONTRATADO: [NOME DO SIGNATÁRIO], inscrito no CPF nº [CPF/CNPJ DO SIGNATÁRIO], residente em [ENDEREÇO DO SIGNATÁRIO], doravante denominado simplesmente CONTRATADO.

As partes acima qualificadas têm entre si justo e contratado o seguinte:

CLÁUSULA 1ª — DO OBJETO
O presente contrato tem por objeto a prestação de serviços de assessoria completa pela CONTRATANTE ao CONTRATADO para identificação, análise de viabilidade, análise jurídica, acompanhamento e suporte na aquisição de imóvel por meio de leilão judicial ou extrajudicial, doravante denominada "Assessoria para Aquisição".

CLÁUSULA 2ª — DOS SERVIÇOS INCLUSOS
A assessoria compreende: (a) análise de viabilidade econômica e financeira do imóvel; (b) análise do edital e da matrícula do imóvel; (c) levantamento de riscos jurídicos e ônus reais; (d) cálculo do teto de lance e estratégia de disputa; (e) acompanhamento do leilão; (f) suporte pós-arrematação até a regularização documental.

CLÁUSULA 3ª — DAS OBRIGAÇÕES DO CONTRATADO
O CONTRATADO obriga-se a: (a) fornecer informações verídicas sobre sua capacidade de investimento; (b) disponibilizar os documentos necessários à análise; (c) tomar as decisões de lance e aquisição com plena autonomia, sendo de sua exclusiva responsabilidade o resultado do investimento; (d) assinar o presente instrumento em até 30 (trinta) dias a contar do envio do link de assinatura, sob pena de cancelamento do serviço e estorno do valor pago.

CLÁUSULA 4ª — DO VALOR E FORMA DE PAGAMENTO
Os serviços de assessoria são remunerados pelo valor de R$ 5.000,00 (cinco mil reais), cobrados na contratação, acrescidos de honorários de êxito de 10% (dez por cento) sobre o valor do lance do imóvel arrematado, devidos no momento da arrematação.

CLÁUSULA 5ª — DO PRAZO
O presente contrato vigorará pelo prazo necessário à conclusão da aquisição do imóvel, sem prazo máximo definido, podendo ser rescindido por qualquer das partes mediante aviso prévio de 30 (trinta) dias, respondendo a parte que der causa à rescisão pelo pagamento de multa de 10% (dez por cento) sobre o valor contratado.

CLÁUSULA 6ª — DA CONFIDENCIALIDADE E LGPD
As partes obrigam-se a manter sigilo sobre todas as informações confidenciais trocadas durante a execução deste contrato. O tratamento de dados pessoais dar-se-á em conformidade com a Lei nº 13.709/2018 (LGPD), limitando-se ao estritamente necessário para a execução dos serviços.

CLÁUSULA 7ª — DA RESCISÃO E PENALIDADES
O não pagamento de qualquer parcela devida, ou o descumprimento de qualquer cláusula, poderá ensejar rescisão motivada, com cobrança de multa de 10% (dez por cento) sobre o saldo devedor, sem prejuízo das perdas e danos apurados. Notificações e comunicações entre as partes serão realizadas pelos dados de contato informados no momento da assinatura.

CLÁUSULA 8ª — DO FORO
Fica eleita a Comarca de Feira de Santana/BA para dirimir quaisquer dúvidas ou litígios decorrentes deste contrato, com renúncia expressa a qualquer outro, por mais privilegiado que seja.

Feira de Santana, _____ de _____________ de 20____.

CONTRATANTE:
NOGUEIRA EMPREENDIMENTOS LTDA
CNPJ 02.311.492/0001-61

_______________________________________
Assinatura

CONTRATADO:
[NOME DO SIGNATÁRIO]
[CPF/CNPJ DO SIGNATÁRIO]

_______________________________________
Assinatura`;

const TEMPLATE_CLUBE = `CONTRATO DE ADESÃO AO CLUBE DE NEGÓCIOS TSN ATIVOS

CONTRATANTE: NOGUEIRA EMPREENDIMENTOS LTDA, pessoa jurídica de direito privado, inscrita no CNPJ nº 02.311.492/0001-61, com sede na cidade de Feira de Santana, Estado da Bahia, doravante denominada simplesmente CONTRATANTE.

MEMBRO: [NOME DO SIGNATÁRIO], inscrito no CPF nº [CPF/CNPJ DO SIGNATÁRIO], residente em [ENDEREÇO DO SIGNATÁRIO], doravante denominado simplesmente MEMBRO.

As partes têm entre si justo e contratado:

CLÁUSULA 1ª — DO OBJETO
O presente instrumento tem por objeto a adesão do MEMBRO ao Clube de Negócios TSN Ativos, programa de mentoria e investimento coletivo em leilões imobiliários operado pela CONTRATANTE.

CLÁUSULA 2ª — DOS BENEFÍCIOS DO CLUBE
A adesão confere ao MEMBRO: (a) participação em sessões mensais de mentoria em grupo; (b) análises prioritárias de imóveis em leilão; (c) acesso à plataforma TSN Ativos com recursos exclusivos; (d) networking com demais membros do clube; (e) relatórios mensais de oportunidades de leilão.

CLÁUSULA 3ª — DO VALOR E FORMA DE PAGAMENTO
A mensalidade de adesão ao Clube é de R$ 5.000,00 (cinco mil reais) por mês, devida até o dia 10 de cada mês. O não pagamento por mais de 30 dias ensejará a suspensão automática do acesso até a regularização.

CLÁUSULA 4ª — DO PRAZO E FIDELIDADE
O presente contrato tem prazo mínimo de adesão de 3 (três) meses, podendo ser rescindido após esse período mediante aviso prévio de 30 (trinta) dias. A rescisão dentro do prazo mínimo sujeitará o MEMBRO ao pagamento proporcional das mensalidades restantes.

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
  if (req.method !== 'POST') return res.status(405).end();

  const { userId, planoKey, nomeUsuario, emailUsuario } = req.body || {};
  if (!planoKey || !['assessorado', 'clube'].includes(planoKey)) {
    return res.status(400).json({ error: 'planoKey deve ser assessorado ou clube' });
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
    : 'Contrato de Adesão ao Clube de Negócios TSN Ativos';

  const conteudo = planoKey === 'assessorado' ? TEMPLATE_ASSESSORADO : TEMPLATE_CLUBE;

  const { data, error } = await supabase
    .from('contratos_link')
    .insert({
      titulo,
      conteudo,
      tipo_contrato: 'servico',
      status: 'aguardando',
      criado_por: null,
    })
    .select('token')
    .single();

  if (error || !data) {
    console.error('auto-contrato insert error:', error);
    return res.status(500).json({ error: 'Erro ao criar contrato' });
  }

  const origin = req.headers.origin || `https://${req.headers.host}`;
  return res.status(200).json({
    token: data.token,
    url: `${origin}#/c/${data.token}`,
  });
}
