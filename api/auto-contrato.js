import { getUser, getUserRole } from './_auth.js';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, getIP, rateLimitedRes } from './_rate-limit.js';
import { auditLog } from './_audit.js';
import { sanitizeName, sanitizeEmail } from './_sanitize.js';
import { alertarErro } from './_error-alert.js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const TEMPLATE_ASSESSORADO = `CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE ASSESSORIA PARA ARREMATAÇÃO EM LEILÕES

CONTRATADA (ASSESSORIA): NOGUEIRA EMPREENDIMENTOS LTDA, inscrita no CNPJ nº 02.311.492/0001-61, com sede em Feira de Santana/BA, representada por TARCISIO DE SOUZA NOGUEIRA DE ARAUJO, brasileiro, empresário, inscrito no CPF nº 042.293.535-29.

CONTRATANTE (CLIENTE): [NOME DO SIGNATÁRIO], inscrito(a) no CPF/CNPJ nº [CPF/CNPJ DO SIGNATÁRIO], residente e domiciliado(a) em [ENDEREÇO DO SIGNATÁRIO].

Pelo presente instrumento particular, as partes acima qualificadas celebram o presente Contrato de Prestação de Serviços de Assessoria, que se regerá pelas cláusulas e condições a seguir:

CLÁUSULA PRIMEIRA — DO OBJETO E ESCOPO
1.1. O objeto deste contrato é a prestação de serviços técnicos de assessoria e representação especializada para a aquisição de bens através de leilões (judiciais ou extrajudiciais) pela CONTRATADA em favor da CONTRATANTE, referente a 1 (um) imóvel, com prazo de até 12 (doze) meses a contar da assinatura para a conclusão da arrematação. Os serviços não incluem mentoria ou treinamento.
1.2. O escopo abrange: Triagem e Avaliação (análise técnica e jurídica preliminar dos editais, processos, débitos ocultos e viabilidade mercadológica, sugerindo oportunidades seguras); Habilitação (análise documental e cadastramento junto aos leiloeiros oficiais); Arremate (execução da estratégia de lances e representação no leilão); Resolução Processual (acompanhamento até a Carta de Arrematação); e Posse (diligências para a imissão na posse do bem).
1.3. No ato da imissão na posse, a CONTRATANTE deverá indicar representante próprio de sua confiança para acompanhar o Oficial de Justiça no recebimento do bem.
1.4. O acompanhamento presencial por especialista da CONTRATADA na imissão, se solicitado, gera custos adicionais (deslocamento, hospedagem e alimentação), arcados integralmente pela CONTRATANTE.

CLÁUSULA SEGUNDA — DAS EXCLUSÕES DE ESCOPO
2.1. Este contrato não cobre reforma, reparo, limpeza, modificação, transporte ou descaracterização do bem arrematado.
2.2. A entrega do bem dar-se-á no estado em que se encontra (cláusula ad corpus e "as is" inerente aos leilões); serviços físicos no bem constituem operação distinta, mediante nova contratação e orçamento à parte.

CLÁUSULA TERCEIRA — DA REMUNERAÇÃO E HONORÁRIOS
3.1. Pelos serviços iniciais de assessoria (referentes a 1 imóvel), a CONTRATANTE pagará à CONTRATADA, conforme a modalidade escolhida no ato da contratação: (a) R$ 6.000,00 (seis mil reais) parcelados em 12 (doze) parcelas mensais de R$ 500,00 (quinhentos reais); ou (b) R$ 4.800,00 (quatro mil e oitocentos reais) em pagamento único à vista, com 20% (vinte por cento) de desconto sobre o total parcelado. O pagamento é feito via PIX/cartão em favor da NOGUEIRA EMPREENDIMENTOS LTDA.
3.2. A título de honorários de êxito na arrematação, a CONTRATANTE pagará o percentual fixo de 10% (dez por cento) sobre o valor final da arrematação do bem, independentemente da modalidade de pagamento escolhida.
3.3. Fica estipulado o valor mínimo de R$ 5.000,00 (cinco mil reais) a título de honorários de êxito, caso o percentual de 10% resulte em montante inferior.
3.4. O pagamento dos honorários de êxito deverá ser feito de forma simultânea ao pagamento da comissão do leiloeiro e da arrematação, seja a aquisição à vista ou financiada/hipotecada/parcelada.
3.5. Os honorários não se confundem com a comissão do leiloeiro, custas processuais, taxas, impostos (ITBI, IPVA etc.) ou despesas de remoção, de exclusiva responsabilidade da CONTRATANTE.
3.6. Na modalidade hipotecada (parcelamento do leilão judicial), o escopo ordinário limita-se ao arremate e imissão na posse; o acompanhamento das parcelas mensais dependerá de profissional próprio da CONTRATANTE ou de contratação complementar com a CONTRATADA.

CLÁUSULA QUARTA — DO PRAZO E CANCELAMENTO
4.1. Este contrato vigorará por até 12 (doze) meses a contar da assinatura, prazo máximo para a conclusão da arrematação. Não havendo arrematação nesse período por razões imputáveis à CONTRATANTE, o contrato encerra-se sem devolução dos valores pagos.
4.2. A CONTRATANTE deverá assinar este instrumento em até 30 (trinta) dias a contar do envio do link de assinatura, sob pena de cancelamento do serviço e estorno do valor pago.
4.3. A rescisão imotivada por qualquer das partes, mediante aviso prévio de 30 (trinta) dias, sujeita a parte que lhe der causa à multa de 10% (dez por cento) sobre o valor total do contrato.

CLÁUSULA QUINTA — DOS RISCOS INERENTES AOS LEILÕES
5.1. A CONTRATANTE tem ciência de que arrematações em leilões, sobretudo judiciais, têm natureza resolúvel e estão sujeitas a contestações, embargos ou recursos de terceiros (Art. 903 do CPC), podendo o leilão ser suspenso, invalidado ou cancelado por decisão judicial superveniente.
5.2. A CONTRATADA atua com rigor técnico na triagem e análise de riscos (curadoria); o cancelamento por fatos alheios à sua atuação diligente é risco inerente ao negócio e não configura falha na prestação do serviço.
5.3. Cancelada, desfeita ou invalidada a arrematação por decisão judicial ou administrativa após o arremate, sem dolo ou culpa comprovada da CONTRATADA, os serviços de habilitação, estratégia, representação, arremate e acompanhamento inicial serão considerados efetivamente prestados.

CLÁUSULA SEXTA — DA ANTICORRUPÇÃO E DA PREVENÇÃO À LAVAGEM DE DINHEIRO
6.1. As Partes conhecem e cumprem a Lei nº 12.846/2013 (Anticorrupção), comprometendo-se a não praticar suborno, fraude ou oferta de vantagem indevida a agentes públicos, juízes, leiloeiros ou terceiros.
6.2. A CONTRATANTE cumpre as normas de prevenção à lavagem de dinheiro (Lei nº 9.613/1998) e atesta, sob as penas da lei, que todos os recursos utilizados na operação (lance, comissão, taxas, impostos e honorários) têm origem lícita e declarada, obrigando-se a comprová-la sempre que solicitado.
6.3. A violação a esta cláusula autoriza a rescisão imediata por justa causa, sem devolução de valores pagos, com honorários devidos integralmente e comunicação aos órgãos competentes (COAF, Ministério Público).

CLÁUSULA SÉTIMA — DA CONFIDENCIALIDADE, PROPRIEDADE INTELECTUAL E LGPD
7.1. As estratégias de arrematação e análises jurídicas da CONTRATADA são protegidas por sigilo profissional e direitos intelectuais.
7.2. As Partes observam a Lei nº 13.709/2018 (LGPD), resguardando as informações financeiras e pessoais trocadas na operação, limitadas ao estritamente necessário para a execução dos serviços.

CLÁUSULA OITAVA — DO FORO
8.1. As Partes elegem o foro da Comarca de Feira de Santana/BA para dirimir controvérsias, renunciando a qualquer outro por mais privilegiado que seja.

E, por estarem justas e contratadas, as partes assinam o presente instrumento digitalmente, com apontamento de testemunha. Assinatura eletrônica válida nos termos da MP 2.200-2/2001 e Lei 14.063/2020.

CONTRATADA: NOGUEIRA EMPREENDIMENTOS LTDA — CNPJ 02.311.492/0001-61

CONTRATANTE: [NOME DO SIGNATÁRIO] — CPF/CNPJ [CPF/CNPJ DO SIGNATÁRIO]`;

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
  const nomeUsuario = sanitizeName(nomeRaw, 200);
  const emailUsuario = sanitizeEmail(emailRaw);
  if (emailRaw && !emailUsuario) {
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
    : 'Contrato de Adesão ao Clube de Negócios BidPro Brasil';

  const conteudo = (planoKey === 'assessorado' ? TEMPLATE_ASSESSORADO : TEMPLATE_CLUBE)
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
