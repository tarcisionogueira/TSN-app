import { getUser, getUserRole } from './_auth.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const TEMPLATE_ASSESSORADO = `CONTRATO DE ASSESSORIA PARA AQUISIÇÃO DE IMÓVEL EM LEILÃO

CONTRATANTE: NOGUEIRA EMPREENDIMENTOS LTDA, pessoa jurídica de direito privado, inscrita no CNPJ nº 02.311.492/0001-61, com sede na cidade de Feira de Santana, Estado da Bahia, doravante denominada simplesmente CONTRATANTE.

CONTRATADO: [NOME DO SIGNATÁRIO], inscrito no CPF nº [CPF/CNPJ DO SIGNATÁRIO], residente em [ENDEREÇO DO SIGNATÁRIO], doravante denominado simplesmente CONTRATADO.

As partes acima qualificadas têm entre si justo e contratado o seguinte:

CLÁUSULA 1ª — DO OBJETO
O presente contrato tem por objeto a prestação de serviços de assessoria pela CONTRATANTE ao CONTRATADO para identificação, análise de viabilidade, análise jurídica, acompanhamento e suporte na aquisição de 1 (um) imóvel por meio de leilão judicial ou extrajudicial, com prazo de até 12 (doze) meses a contar da assinatura para a conclusão da arrematação. Os serviços ora contratados não incluem mentoria ou treinamento.

CLÁUSULA 2ª — DOS SERVIÇOS INCLUSOS
A assessoria compreende: (a) análise de viabilidade econômica e financeira do imóvel; (b) análise do edital e da matrícula do imóvel; (c) levantamento de riscos jurídicos e ônus reais; (d) cálculo do teto de lance e estratégia de disputa; (e) acompanhamento do leilão; (f) suporte pós-arrematação até a regularização documental.

CLÁUSULA 3ª — DAS OBRIGAÇÕES DO CONTRATADO
O CONTRATADO obriga-se a: (a) fornecer informações verídicas sobre sua capacidade de investimento; (b) disponibilizar os documentos necessários à análise; (c) tomar as decisões de lance e aquisição com plena autonomia, sendo de sua exclusiva responsabilidade o resultado do investimento; (d) assinar o presente instrumento em até 30 (trinta) dias a contar do envio do link de assinatura, sob pena de cancelamento do serviço e estorno do valor pago.

CLÁUSULA 4ª — DO VALOR E FORMA DE PAGAMENTO
Os serviços de assessoria são remunerados conforme modalidade escolhida pelo CONTRATADO no ato da contratação: (a) R$ 6.000,00 (seis mil reais) parcelados em 12 (doze) parcelas mensais de R$ 500,00 (quinhentos reais), com vencimento no dia 10 de cada mês a contar da assinatura; ou (b) R$ 5.000,00 (cinco mil reais) em pagamento único à vista, com desconto sobre o total parcelado. Sobre o imóvel arrematado incidem honorários de êxito de 10% (dez por cento) sobre o valor do lance, devidos no momento da arrematação, independentemente da modalidade de pagamento escolhida.

CLÁUSULA 5ª — DO PRAZO
O presente contrato vigorará pelo prazo de até 12 (doze) meses a contar da data de assinatura, sendo este o prazo máximo para a conclusão da arrematação. Não havendo arrematação dentro desse período por razões imputáveis ao CONTRATADO, o contrato encerrar-se-á sem devolução dos valores pagos. Qualquer das partes poderá rescindir antecipadamente mediante aviso prévio de 30 (trinta) dias, respondendo a parte que der causa à rescisão imotivada pelo pagamento de multa de 10% (dez por cento) sobre o valor total do contrato.

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
A adesão ao Clube é remunerada conforme modalidade escolhida pelo MEMBRO no ato da contratação: (a) R$ 5.000,00 (cinco mil reais) mensais, devidos até o dia 10 de cada mês, totalizando R$ 60.000,00 (sessenta mil reais) ao longo dos 12 (doze) meses de fidelidade — modalidade sujeita a renovação automática após o período de fidelidade, salvo aviso de cancelamento; ou (b) R$ 48.000,00 (quarenta e oito mil reais) em pagamento único à vista via PIX ou cartão de crédito, com desconto de 20% (vinte por cento) sobre o total parcelado — modalidade que NÃO configura renovação automática, encerrando-se o vínculo ao término dos 12 (doze) meses sem qualquer cobrança adicional. O não pagamento de parcela mensal por mais de 30 (trinta) dias corridos ensejará a suspensão automática do acesso até a regularização.

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

  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autorizado' }); return; }
  if (req.method !== 'POST') return res.status(405).end();

  const { userId, planoKey, nomeUsuario, emailUsuario } = req.body || {};
  if (!planoKey || !['assessorado', 'clube'].includes(planoKey)) {
    return res.status(400).json({ error: 'planoKey deve ser assessorado ou clube' });
  }
  if (emailUsuario && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailUsuario)) {
    return res.status(400).json({ error: 'emailUsuario inválido' });
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
      assinante_email: emailUsuario || null,
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
