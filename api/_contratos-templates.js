/**
 * Templates de contratos operacionais da BidPro Brasil.
 * Cada role tem seu template com:
 * - Objeto do serviço específico
 * - Cláusula de Retenção de Valores e SCP (Arts. 991–996 CC)
 * - Autorização Banco Central (Resolução BCB 80/2021)
 * - LGPD (Lei 13.709/2018)
 * - Lei Anticorrupção (Lei 12.846/2013)
 * - Recibo de Saque / RPA para fins fiscais
 *
 * Placeholders preenchidos pelo signatário no momento da assinatura:
 * [NOME_SIGNATÁRIO], [CPF_SIGNATÁRIO], [RG_SIGNATÁRIO],
 * [TIPO_PESSOA], [CNPJ_SIGNATÁRIO], [RAZÃO_SOCIAL_SIGNATÁRIO],
 * [NOME_REPRESENTANTE], [CPF_REPRESENTANTE],
 * [ENDEREÇO_SIGNATÁRIO], [CIDADE_UF_SIGNATÁRIO], [CEP_SIGNATÁRIO]
 */

const EMPRESA = {
  razao: 'NOGUEIRA EMPREENDIMENTOS LTDA',
  cnpj: '02.311.492/0001-61',
  cidade: 'Feira de Santana',
  uf: 'BA',
  foro: 'Feira de Santana/BA',
};

const CLAUSULAS_COMUNS = `
CLÁUSULA 6ª — PROTEÇÃO DE DADOS PESSOAIS (LGPD)
6.1. As Partes comprometem-se a tratar os dados pessoais a que tiverem acesso em razão desta avença em conformidade com a Lei nº 13.709/2018 (Lei Geral de Proteção de Dados — LGPD), adotando medidas técnicas e organizacionais adequadas para garantir a segurança, confidencialidade e integridade das informações.
6.2. O CONTRATADO autoriza expressamente a CONTRATANTE a coletar, armazenar e processar seus dados pessoais (nome, CPF, endereço, conta bancária, chave PIX) para fins de execução deste contrato, emissão de documentos fiscais e realização de transferências financeiras, pelo prazo de vigência do contrato acrescido de 5 (cinco) anos para cumprimento de obrigações legais, nos termos do Art. 7º, V, e Art. 16, I, da LGPD.
6.3. Os dados não serão compartilhados com terceiros, salvo por obrigação legal ou regulatória.

CLÁUSULA 7ª — CONFORMIDADE ANTICORRUPÇÃO
7.1. As Partes declaram que não praticam, não praticarão e não autorizarão a prática de atos ilícitos previstos na Lei nº 12.846/2013 (Lei Anticorrupção), no Decreto nº 8.420/2015 e na Lei nº 8.666/1993, comprometendo-se a manter padrão ético de conduta em todas as atividades relacionadas a este instrumento.
7.2. Fica vedado oferecer, prometer ou dar, direta ou indiretamente, vantagem indevida a agentes públicos ou privados para obter ou manter negócios relacionados a este contrato.
7.3. A constatação de violação desta cláusula ensejará rescisão imediata, sem prejuízo das sanções civis, administrativas e penais cabíveis.

CLÁUSULA 8ª — CONFIDENCIALIDADE
8.1. O CONTRATADO obriga-se a manter absoluto sigilo sobre informações estratégicas, metodologias, dados de clientes e operações da CONTRATANTE a que tiver acesso, pelo prazo de 5 (cinco) anos após a extinção desta avença, sob pena de reparação integral dos danos causados (Arts. 186 e 927 do Código Civil).

CLÁUSULA 9ª — RESCISÃO
9.1. Este contrato poderá ser rescindido por qualquer das Partes mediante notificação por escrito com antecedência mínima de 30 (trinta) dias.
9.2. A CONTRATANTE poderá rescindir imediatamente, sem aviso prévio e sem ônus, em caso de: (i) descumprimento das obrigações contratuais; (ii) conduta ética inadequada; (iii) violação das cláusulas de confidencialidade ou anticorrupção.
9.3. Rescindido o contrato, o CONTRATADO terá direito ao saldo disponível conforme a Cláusula 4ª, a ser liquidado no prazo de até 10 (dez) dias úteis.

CLÁUSULA 10ª — DISPOSIÇÕES GERAIS
10.1. Este instrumento não estabelece vínculo empregatício, previdenciário ou societário entre as Partes, sendo regido pelos Arts. 593 a 609 do Código Civil Brasileiro.
10.2. As alterações a este contrato somente produzirão efeitos se formalizadas por escrito e aceitas por ambas as Partes.
10.3. A eventual tolerância de descumprimento de qualquer cláusula não implica novação ou renúncia de direitos.

CLÁUSULA 11ª — FORO
11.1. As Partes elegem o Foro da Comarca de ${EMPRESA.foro} para dirimir quaisquer controvérsias oriundas deste instrumento, com renúncia expressa a qualquer outro, por mais privilegiado que seja.

Assinatura eletrônica válida nos termos da MP 2.200-2/2001 e Lei 14.063/2020.`;

const CLAUSULA_SCP = `
CLÁUSULA 4ª — RETENÇÃO DE VALORES, SOCIEDADE EM CONTA DE PARTICIPAÇÃO (SCP) E SAQUES
4.1. Os valores devidos ao CONTRATADO serão creditados em conta corrente mantida pela CONTRATANTE junto à instituição de pagamento Mercado Pago (MP Pagamentos S.A., CNPJ 10.573.521/0001-91), sob controle da plataforma, constituindo uma Sociedade em Conta de Participação (SCP), nos termos dos Arts. 991 a 996 do Código Civil Brasileiro.
4.2. Nesta SCP, a CONTRATANTE figura como Sócia Ostensiva (responsável pela operação e gestão dos recursos perante terceiros) e o CONTRATADO como Sócio Participante (titular do crédito pela prestação dos serviços, sem gestão dos recursos).
4.3. O rendimento de CDI (Certificado de Depósito Interbancário) gerado pelo saldo mantido na conta MP durante o período de retenção será revertido à Sócia Ostensiva (CONTRATANTE), como contraprestação pela gestão, custódia e operacionalização da plataforma, sendo este o modelo econômico expressamente acordado entre as Partes.
4.4. O CONTRATADO autoriza expressamente a CONTRATANTE a reter os valores creditados em seu nome pelo tempo que julgar necessário para o adequado fluxo de caixa da plataforma, ficando assegurado o direito de solicitação de saque a qualquer momento, processado em até 2 (dois) dias úteis após aprovação pela CONTRATANTE.
4.5. Para fins fiscais, cada saque realizado constituirá distribuição de resultado da SCP, devendo o CONTRATADO emitir o competente documento fiscal (RPA — Recibo de Pagamento Autônomo, NFS-e ou EIRELI/ME, conforme seu enquadramento tributário) correspondente ao valor sacado, para fins de dedução no imposto de renda da CONTRATANTE (Arts. 158, §1°, e 299 do Decreto nº 9.580/2018 — RIR/2018).
4.6. A CONTRATANTE entregará ao CONTRATADO, a cada saque aprovado, comprovante de transferência e extrato de crédito para fins de escrituração contábil.
4.7. O CONTRATADO autoriza, nos termos do Art. 7º, IX, da Lei nº 13.709/2018 (LGPD), o tratamento de seus dados bancários (chave PIX, agência, conta) exclusivamente para fins de processamento dos saques previstos nesta cláusula.
4.8. O saldo acumulado na SCP não é garantido por fundos de seguro de depósito (FGC), sendo mantido em conta de pagamento conforme regulamentação do Banco Central do Brasil (Resolução BCB nº 80/2021).
4.9. O CONTRATADO declara estar ciente e concordar que o modelo de retenção descrito nesta cláusula se enquadra nas atividades de instituição de pagamento nos termos da Lei nº 12.865/2013 e da Resolução BCB nº 80/2021, autorizando expressamente a CONTRATANTE a operar desta forma até o limite regulatório aplicável.`;

// ─── TEMPLATE: CONSULTOR ────────────────────────────────────────────────────

export function templateConsultor() {
  return `CONTRATO DE CONSULTORIA E AFILIAÇÃO — PLATAFORMA BIDPRO BRASIL
Modalidade: Consultor Parceiro / Afiliado

PARTES

CONTRATANTE: ${EMPRESA.razao}, inscrita no CNPJ sob nº ${EMPRESA.cnpj}, com sede em ${EMPRESA.cidade}/${EMPRESA.uf}, doravante denominada simplesmente CONTRATANTE.

CONTRATADO(A): [NOME_SIGNATÁRIO], portador(a) do CPF nº [CPF_SIGNATÁRIO] e RG nº [RG_SIGNATÁRIO], residente e domiciliado(a) em [ENDEREÇO_SIGNATÁRIO], [CIDADE_UF_SIGNATÁRIO], CEP [CEP_SIGNATÁRIO] (Pessoa Física), ou na qualidade de representante legal de [RAZÃO_SOCIAL_SIGNATÁRIO], CNPJ [CNPJ_SIGNATÁRIO] (Pessoa Jurídica), doravante denominado(a) simplesmente CONTRATADO.

Têm entre si justo e contratado o seguinte:

CLÁUSULA 1ª — OBJETO
1.1. O presente instrumento tem por objeto a prestação de serviços de consultoria comercial, captação de clientes investidores e divulgação da plataforma BidPro Brasil de análise de imóveis em leilão, desenvolvida pela CONTRATANTE.
1.2. O CONTRATADO atuará como Consultor Parceiro (Afiliado), sem exclusividade territorial, identificando potenciais investidores interessados nos serviços e planos da plataforma, encaminhando-os ao funil de vendas da CONTRATANTE por meio de link de afiliado rastreável.

CLÁUSULA 2ª — OBRIGAÇÕES DO CONTRATADO
2.1. Promover a plataforma com transparência, sem fazer promessas de rentabilidade ou garantias não autorizadas pela CONTRATANTE.
2.2. Manter conduta ética e profissional em todas as interações com potenciais clientes.
2.3. Não realizar cobranças ou recebimentos em nome da CONTRATANTE.
2.4. Informar imediatamente qualquer irregularidade ou conflito de interesse que possa comprometer a imagem da plataforma.
2.5. Manter sigilo sobre as condições comerciais e metodologias da CONTRATANTE.

CLÁUSULA 3ª — REMUNERAÇÃO
3.1. O CONTRATADO fará jus a comissão sobre cada plano ativo indicado, conforme tabela de comissionamento vigente na plataforma, disponível no painel do consultor.
3.2. A remuneração será creditada mensalmente, após a confirmação do pagamento pelo cliente indicado, conforme política de chargeback vigente (prazo de confirmação: até 30 dias da data do pagamento).
3.3. A CONTRATANTE reserva-se o direito de alterar a tabela de comissionamento mediante comunicação prévia de 30 (trinta) dias.
${CLAUSULA_SCP}

CLÁUSULA 5ª — PRAZO
5.1. Este contrato é firmado por prazo indeterminado, vigorando a partir da data de assinatura eletrônica.
${CLAUSULAS_COMUNS}`;
}

// ─── TEMPLATE: ANALISTA ─────────────────────────────────────────────────────

export function templateAnalista() {
  return `CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE ANÁLISE — PLATAFORMA BIDPRO BRASIL
Modalidade: Analista de Imóveis Parceiro

PARTES

CONTRATANTE: ${EMPRESA.razao}, inscrita no CNPJ sob nº ${EMPRESA.cnpj}, com sede em ${EMPRESA.cidade}/${EMPRESA.uf}, doravante denominada simplesmente CONTRATANTE.

CONTRATADO(A): [NOME_SIGNATÁRIO], portador(a) do CPF nº [CPF_SIGNATÁRIO] e RG nº [RG_SIGNATÁRIO], residente e domiciliado(a) em [ENDEREÇO_SIGNATÁRIO], [CIDADE_UF_SIGNATÁRIO], CEP [CEP_SIGNATÁRIO] (Pessoa Física), ou na qualidade de representante legal de [RAZÃO_SOCIAL_SIGNATÁRIO], CNPJ [CNPJ_SIGNATÁRIO] (Pessoa Jurídica), doravante denominado(a) simplesmente CONTRATADO.

Têm entre si justo e contratado o seguinte:

CLÁUSULA 1ª — OBJETO
1.1. O presente instrumento tem por objeto a prestação de serviços especializados de análise de viabilidade de imóveis em leilão, elaboração de laudos técnicos de arrematação e avaliação mercadológica, no âmbito da plataforma BidPro Brasil.
1.2. Os serviços serão prestados de forma remota, mediante demanda encaminhada pela CONTRATANTE, com prazo de entrega definido em cada solicitação.

CLÁUSULA 2ª — OBRIGAÇÕES DO CONTRATADO
2.1. Elaborar laudos técnicos com precisão, imparcialidade e embasamento em dados de mercado verificáveis.
2.2. Utilizar exclusivamente os dados e metodologias disponibilizados pela plataforma BidPro Brasil para composição dos laudos.
2.3. Manter sigilo absoluto sobre as informações dos clientes e imóveis analisados.
2.4. Não emitir laudos com garantias de resultado financeiro ou rentabilidade presumida.
2.5. Informar à CONTRATANTE qualquer conflito de interesse identificado nos imóveis a analisar.
2.6. Manter atualização constante sobre legislação, jurisprudência e práticas de mercado relevantes à sua área de especialidade.

CLÁUSULA 3ª — REMUNERAÇÃO
3.1. A remuneração será fixada por laudo elaborado, conforme tabela de honorários vigente na plataforma, acordada entre as Partes no início de cada demanda.
3.2. O pagamento será realizado após a entrega e aprovação do laudo pelo responsável da CONTRATANTE.
${CLAUSULA_SCP}

CLÁUSULA 5ª — PRAZO E EXCLUSIVIDADE
5.1. Este contrato é firmado por prazo indeterminado.
5.2. Não há exclusividade: o CONTRATADO poderá prestar serviços a outras plataformas ou clientes, desde que não haja conflito de interesse com as operações da CONTRATANTE.
${CLAUSULAS_COMUNS}`;
}

// ─── TEMPLATE: ADVOGADO ─────────────────────────────────────────────────────

export function templateAdvogado() {
  return `CONTRATO DE PRESTAÇÃO DE SERVIÇOS JURÍDICOS — PLATAFORMA BIDPRO BRASIL
Modalidade: Advogado Parceiro

PARTES

CONTRATANTE: ${EMPRESA.razao}, inscrita no CNPJ sob nº ${EMPRESA.cnpj}, com sede em ${EMPRESA.cidade}/${EMPRESA.uf}, doravante denominada simplesmente CONTRATANTE.

CONTRATADO(A): [NOME_SIGNATÁRIO], advogado(a) inscrito(a) na OAB sob nº [OAB_SIGNATÁRIO], portador(a) do CPF nº [CPF_SIGNATÁRIO], residente e domiciliado(a) em [ENDEREÇO_SIGNATÁRIO], [CIDADE_UF_SIGNATÁRIO], CEP [CEP_SIGNATÁRIO] (Pessoa Física), ou na qualidade de sócio administrador de [RAZÃO_SOCIAL_SIGNATÁRIO], CNPJ [CNPJ_SIGNATÁRIO] (Sociedade de Advogados), doravante denominado(a) simplesmente CONTRATADO.

Têm entre si justo e contratado o seguinte:

CLÁUSULA 1ª — OBJETO
1.1. O presente instrumento tem por objeto a prestação de serviços jurídicos especializados em Direito Imobiliário, Direito Civil e Execuções Judiciais, com ênfase em análise de editais de leilão, matrículas de imóveis, processos judiciais e riscos à arrematação, no âmbito da plataforma BidPro Brasil.
1.2. Os serviços abrangem: (i) análise jurídica de editais e matrículas; (ii) consulta ao sistema CNJ DataJud sobre processos vinculados a imóveis; (iii) elaboração de pareceres sobre riscos à arrematação; (iv) orientação pós-arrematação sobre regularização cartorária e imissão de posse.
1.3. Este contrato é firmado nos termos dos Arts. 593 a 609 do Código Civil, observado o Estatuto da OAB (Lei nº 8.906/1994) e o Código de Ética e Disciplina da OAB.

CLÁUSULA 2ª — OBRIGAÇÕES DO CONTRATADO
2.1. Prestar os serviços com diligência, competência e independência técnica, nos termos do Art. 7º do Estatuto da OAB.
2.2. Manter sigilo profissional absoluto sobre as informações dos clientes, processos e imóveis, conforme Art. 34, VII, do Estatuto da OAB.
2.3. Comunicar à CONTRATANTE qualquer impedimento ético ou conflito de interesse que impossibilite a análise de determinado caso.
2.4. Não constituir mandato judicial em nome de clientes da plataforma sem formalização de contrato de honorários diretamente com o cliente, sendo os serviços aqui contratados de natureza consultiva e não contenciosa.
2.5. Entregar os pareceres nos prazos acordados em cada demanda, sob pena de desconto proporcional nos honorários.

CLÁUSULA 3ª — REMUNERAÇÃO
3.1. Os honorários serão fixados por parecer ou por avença específica, conforme tabela de referência da OAB e negociação prévia entre as Partes.
3.2. Os honorários advocatícios são devidos após a entrega e aceite do parecer pela CONTRATANTE.
3.3. O presente contrato não implica salário, pró-labore ou qualquer contraprestação fixa periódica, sendo a remuneração exclusivamente por produção.
${CLAUSULA_SCP}

CLÁUSULA 5ª — PRAZO E INDEPENDÊNCIA
5.1. Este contrato é firmado por prazo indeterminado, preservada a independência técnica e funcional do CONTRATADO.
5.2. O CONTRATADO não é preposto, empregado ou representante legal da CONTRATANTE, não podendo em seu nome firmar instrumentos, receber citações ou assumir obrigações.
${CLAUSULAS_COMUNS}`;
}

// ─── (DESATIVADO) TEMPLATE: ASSESSORADO ─────────────────────────────────────
// O contrato REAL do assessorado/clube vive em api/auto-contrato.js (fluxo do checkout,
// com os valores atuais do plano). A função abaixo NÃO está registrada em TEMPLATES.

export function templateAssessorado() {
  return `CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE ASSESSORIA PARA ARREMATAÇÃO EM LEILÕES

CONTRATADA (ASSESSORIA): ${EMPRESA.razao}, inscrita no CNPJ nº ${EMPRESA.cnpj}, com sede em ${EMPRESA.cidade}/${EMPRESA.uf}, representada por TARCISIO DE SOUZA NOGUEIRA DE ARAUJO, brasileiro, empresário, inscrito no CPF nº 042.293.535-29.

CONTRATANTE (CLIENTE): [NOME_SIGNATÁRIO], inscrito(a) no CPF nº [CPF_SIGNATÁRIO], RG nº [RG_SIGNATÁRIO], residente e domiciliado(a) em [ENDEREÇO_SIGNATÁRIO], [CIDADE_UF_SIGNATÁRIO], CEP [CEP_SIGNATÁRIO].

Pelo presente instrumento particular, as partes acima qualificadas celebram o presente Contrato de Prestação de Serviços de Assessoria, que se regerá pelas cláusulas e condições a seguir:

CLÁUSULA PRIMEIRA — DO OBJETO E ESCOPO
1.1. O objeto deste contrato é a prestação de serviços técnicos de assessoria e representação especializada para a aquisição de bens através de leilões (judiciais ou extrajudiciais) pela CONTRATADA em favor da CONTRATANTE.
1.2. O escopo abrange: Triagem e Avaliação (análise técnica e jurídica preliminar dos editais, processos, débitos ocultos e viabilidade mercadológica, sugerindo oportunidades seguras); Habilitação (análise documental e cadastramento junto aos leiloeiros oficiais); Arremate (execução da estratégia de lances combinada e representação no leilão); Resolução Processual (acompanhamento dos trâmites até a Carta de Arrematação); e Posse (diligências para a imissão na posse do bem).
1.3. No ato da imissão na posse, a CONTRATANTE deverá indicar representante próprio de sua confiança para acompanhar o Oficial de Justiça no recebimento do bem.
1.4. O acompanhamento presencial por especialista da CONTRATADA na imissão, se solicitado, gera custos adicionais (deslocamento, hospedagem e alimentação), arcados integralmente pela CONTRATANTE.

CLÁUSULA SEGUNDA — DAS EXCLUSÕES DE ESCOPO
2.1. Este contrato não cobre reforma, reparo, limpeza, modificação, transporte ou descaracterização do bem arrematado.
2.2. A entrega do bem dar-se-á no estado em que se encontra (cláusula ad corpus e "as is" inerente aos leilões); serviços físicos no bem constituem operação distinta, mediante nova contratação e orçamento à parte.

CLÁUSULA TERCEIRA — DA REMUNERAÇÃO E HONORÁRIOS
3.1. Pelos serviços iniciais de assessoria (referentes a 1 imóvel), a CONTRATANTE pagará à CONTRATADA o valor de [VALOR_SERVICO], de forma imediata à assinatura deste contrato, via PIX em favor da ${EMPRESA.razao} (chave CNPJ nº ${EMPRESA.cnpj}).
3.2. A título de honorários de êxito na arrematação, a CONTRATANTE pagará o percentual fixo de 10% (dez por cento) sobre o valor final da arrematação do bem.
3.3. Fica estipulado o valor mínimo de R$ 5.000,00 (cinco mil reais) a título de honorários de êxito, caso o percentual de 10% resulte em montante inferior.
3.4. O pagamento dos honorários de êxito deverá ser feito de forma simultânea ao pagamento da comissão do leiloeiro e da arrematação, seja a aquisição à vista ou financiada/hipotecada/parcelada.
3.5. Os honorários não se confundem com a comissão do leiloeiro, custas processuais, taxas, impostos (ITBI, IPVA etc.) ou despesas de remoção, de exclusiva responsabilidade da CONTRATANTE.
3.6. Na modalidade hipotecada (parcelamento do leilão judicial), o escopo ordinário limita-se ao arremate e imissão na posse; o acompanhamento das parcelas mensais dependerá de profissional próprio da CONTRATANTE ou de contratação complementar com a CONTRATADA.

CLÁUSULA QUARTA — DOS RISCOS INERENTES AOS LEILÕES E DO CANCELAMENTO
4.1. A CONTRATANTE tem ciência de que arrematações em leilões, sobretudo judiciais, têm natureza resolúvel e estão sujeitas a contestações, embargos ou recursos de terceiros (Art. 903 do CPC), podendo o leilão ser suspenso, invalidado ou cancelado por decisão judicial superveniente.
4.2. A CONTRATADA atua com rigor técnico na triagem e análise de riscos (curadoria); o cancelamento por fatos alheios à sua atuação diligente é risco inerente ao negócio e não configura falha na prestação do serviço.
4.3. Cancelada, desfeita ou invalidada a arrematação por decisão judicial ou administrativa após o arremate, sem dolo ou culpa comprovada da CONTRATADA, os serviços de habilitação, estratégia, representação, arremate e acompanhamento inicial serão considerados efetivamente prestados.

CLÁUSULA QUINTA — DA ANTICORRUPÇÃO E DA PREVENÇÃO À LAVAGEM DE DINHEIRO
5.1. As Partes conhecem e cumprem a Lei nº 12.846/2013 (Anticorrupção), comprometendo-se a não praticar suborno, fraude ou oferta de vantagem indevida a agentes públicos, juízes, leiloeiros ou terceiros.
5.2. A CONTRATANTE cumpre as normas de prevenção à lavagem de dinheiro (Lei nº 9.613/1998).
5.3. A CONTRATANTE atesta, sob as penas da lei, que todos os recursos utilizados na operação (lance, comissão, taxas, impostos e honorários) têm origem lícita e declarada.
5.4. A CONTRATANTE obriga-se a comprovar, sempre que solicitado, a regularidade e a trilha financeira dos recursos utilizados.
5.5. A violação a esta cláusula autoriza a rescisão imediata por justa causa, sem devolução de valores pagos, com honorários devidos integralmente e comunicação aos órgãos competentes (COAF, Ministério Público).

CLÁUSULA SEXTA — DA PROPRIEDADE INTELECTUAL, SIGILO E LGPD
6.1. As estratégias de arrematação e análises jurídicas da CONTRATADA são protegidas por sigilo profissional e direitos intelectuais.
6.2. As Partes observam a Lei nº 13.709/2018 (LGPD), resguardando as informações financeiras e pessoais trocadas na operação.

CLÁUSULA SÉTIMA — DO FORO
7.1. As Partes elegem o foro da Comarca de ${EMPRESA.foro} para dirimir controvérsias, renunciando a qualquer outro por mais privilegiado que seja.

E, por estarem justas e contratadas, as partes assinam o presente instrumento digitalmente, com apontamento de testemunha.

Assinatura eletrônica válida nos termos da MP 2.200-2/2001 e Lei 14.063/2020.`;
}

export const TEMPLATES = {
  consultor:   { gerar: templateConsultor,   titulo: 'Contrato de Consultoria e Afiliação — BidPro Brasil', tipo: 'servico' },
  analista:    { gerar: templateAnalista,    titulo: 'Contrato de Análise de Imóveis — BidPro Brasil',       tipo: 'servico' },
  advogado:  { gerar: templateAdvogado,  titulo: 'Contrato de Serviços Jurídicos — BidPro Brasil',        tipo: 'servico' },
};
