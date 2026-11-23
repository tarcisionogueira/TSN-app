// TERMO DE CONTRATAÇÃO DA ASSESSORIA DE VEÍCULO (23/11, pedido do dono).
//
// O termo do imóvel (_termo-assessoria.js) fala em imóvel, imissão na posse, carta de arrematação e taxa
// inicial de R$ 6.000 — nada disso existe num carro de pátio. A assessoria de veículo é SÓ ÊXITO: 5% sobre o
// valor do arremate, mínimo de R$ 2.000. Os números NUNCA são escritos aqui: vêm de
// `regra_negocio['assessoria_veiculo.honorario']` (a mesma linha que o banco usa em `veiculo_honorario()`
// para calcular o valor do caso). Regra ilegível = termo NÃO gerado (contrato com um preço e sistema
// cobrando outro já aconteceu com o imóvel em 30/09).
//
// Lançamento SÓ MANUAL (dono, 23/11): não há checkout nem botão para o cliente. Quem gera é a equipe, pela
// tela /admin/veiculos-arrematados → /api/veiculo-assessoria-termo.
//
// Assinatura pelo mesmo caminho do imóvel (contratos_link + contratos_pendentes), com `plano_key` NULO de
// propósito: assinar este termo NÃO promove o cliente a assessorado de imóvel nem cria plano_assinaturas
// (assinar-contrato.js só faz isso para plano_key de tier).

import { criarDocumento } from './_termo-assessoria.js';
import { dadosConhecidosDoSignatario, preencherSignatario } from './_signatario.js';

const brl = (v) => (Number(v) > 0 ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null);
const dataBR = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null);
const ORIGIN = () => process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
const pctExtenso = (p) => `${String(p).replace('.', ',')}%`;

/** Regra do honorário lida do banco. `sb` = fetch REST com service key. Falha → null (quem chama recusa). */
export async function regraHonorarioVeiculo(sb) {
  const r = await sb('regra_negocio?chave=eq.assessoria_veiculo.honorario&ativo=eq.true&select=valor&limit=1');
  if (!r.ok) return null;
  const [linha] = await r.json().catch(() => []);
  const pct = Number(linha?.valor?.pct), minimo = Number(linha?.valor?.minimo) || 0;
  return pct > 0 ? { pct, minimo } : null;
}

export function descricaoVeiculo(c) {
  const anos = c.ano_fabricacao || c.ano_modelo ? ` ${[c.ano_fabricacao, c.ano_modelo].filter(Boolean).join('/')}` : '';
  const partes = [
    `"${c.titulo}${anos && !String(c.titulo).includes(String(c.ano_modelo || c.ano_fabricacao)) ? anos : ''}"`,
    c.placa && `placa ${c.placa}`, c.chassi && `chassi ${c.chassi}`, c.renavam && `RENAVAM ${c.renavam}`,
    c.lote && `lote ${c.lote}`, c.evento && `leilão/evento ${c.evento}`,
    (c.leiloeiro || c.plataforma) && `realizado por ${[c.leiloeiro, c.plataforma].filter(Boolean).join(' / ')}`,
    c.comitente && `comitente vendedor ${c.comitente}`,
  ].filter(Boolean);
  return partes.join(', ');
}

/**
 * Texto do termo. `caso` = linha de veiculo_casos (pode não ter valor ainda: contratação ANTES do arremate).
 * `regra` = { pct, minimo } do banco — obrigatória.
 */
export function termoAssessoriaVeiculo(regra, caso = null) {
  if (!(regra?.pct > 0)) throw new Error('termoAssessoriaVeiculo: regra do honorário ausente');
  const minimo = brl(regra.minimo);
  const realizado = !!(caso?.valor_arremate > 0);
  const honorario = realizado ? brl(Math.max(Math.round(caso.valor_arremate * regra.pct) / 100, regra.minimo || 0)) : null;
  const objetoCaso = caso
    ? `1.0. Esta contratação refere-se ao veículo ${descricaoVeiculo(caso)}${realizado ? `, arrematado por ${brl(caso.valor_arremate)}${caso.data_arremate ? ` em ${dataBR(caso.data_arremate)}` : ''}` : ''}.\n`
    : '';
  const exito = realizado
    ? `3.3. Para o veículo da Cláusula 1.0, o honorário de êxito soma ${honorario} (${pctExtenso(regra.pct)} de ${brl(caso.valor_arremate)}${minimo ? `, observado o mínimo de ${minimo}` : ''}).`
    : `3.3. O valor do honorário será apurado sobre o lance vencedor, uma vez aceito pelo vendedor, e informado à CONTRATANTE pela Plataforma.`;

  return `CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE ASSESSORIA PARA ARREMATAÇÃO DE VEÍCULO EM LEILÃO

CONTRATADA (ASSESSORIA): NOGUEIRA EMPREENDIMENTOS LTDA, inscrita no CNPJ nº 02.311.492/0001-61, com sede em Feira de Santana/BA, representada por TARCISIO DE SOUZA NOGUEIRA DE ARAUJO, brasileiro, empresário, inscrito no CPF nº 042.293.535-29.

CONTRATANTE (CLIENTE): [NOME DO SIGNATÁRIO], inscrito(a) no CPF/CNPJ nº [CPF/CNPJ DO SIGNATÁRIO], residente e domiciliado(a) em [ENDEREÇO DO SIGNATÁRIO].

Pelo presente instrumento particular, as partes acima qualificadas celebram o presente Contrato de Prestação de Serviços de Assessoria, que se regerá pelas cláusulas e condições a seguir:

CLÁUSULA PRIMEIRA — DO OBJETO E ESCOPO
${objetoCaso}1.1. O objeto deste contrato é a prestação de serviços de assessoria especializada para a aquisição de 1 (um) veículo automotor em leilão (de pátio, extrajudicial ou judicial) pela CONTRATANTE, com o apoio da CONTRATADA, desde a escolha do lote até o veículo documentado em nome da CONTRATANTE. Os serviços não incluem mentoria ou treinamento.
1.2. O escopo abrange: (a) Triagem e Análise — leitura do edital e das condições de venda, comparação com a tabela FIPE e o mercado, verificação de restrições, débitos informados, histórico de sinistro, recuperação de financiamento, classificação de sucata/recuperável e demais pontos de risco do lote; (b) Habilitação — orientação no cadastro e na habilitação junto ao leiloeiro e à plataforma; (c) Arremate — estratégia de lances dentro do valor máximo autorizado pela CONTRATANTE; (d) Pós-arremate — conferência da nota de arrematação e dos valores pagos, orientação no Termo de Responsabilidade e demais documentos exigidos pelo leiloeiro, acompanhamento da liberação e do agendamento da retirada, e controle dos prazos de retirada e de cobrança de estadia; (e) Documentação — orientação na vistoria e na transferência de propriedade junto ao DETRAN até a emissão do documento em nome da CONTRATANTE.
1.3. O acompanhamento é registrado na Plataforma BidPro Brasil (rastreio do veículo), onde a CONTRATANTE consulta a etapa atual e os prazos.

CLÁUSULA SEGUNDA — DAS EXCLUSÕES DE ESCOPO E DAS DESPESAS
2.1. O veículo é vendido no estado em que se encontra ("as is"). O leiloeiro, via de regra, não realiza testes mecânicos, e a CONTRATADA não garante funcionamento, quilometragem, estado de conservação ou ausência de vícios ocultos.
2.2. Não estão incluídos e correm por conta exclusiva da CONTRATANTE: o lance, a comissão do leiloeiro e as taxas do leilão; remoção por guincho ou plataforma e transporte; estadia de pátio; reparos, peças e serviços mecânicos; vistoria e laudo cautelar contratados de terceiros; despachante; taxas do DETRAN, IPVA, licenciamento, seguro obrigatório, multas e demais débitos do veículo, salvo quando o edital atribuir ao vendedor.
2.3. A retirada no pátio deverá ser feita pela CONTRATANTE ou por pessoa por ela indicada com procuração, nos termos exigidos pelo leiloeiro.

CLÁUSULA TERCEIRA — DA REMUNERAÇÃO
3.1. Não há taxa inicial. A CONTRATADA é remunerada exclusivamente por honorário de êxito.
3.2. A título de honorário de êxito, a CONTRATANTE pagará à CONTRATADA ${pctExtenso(regra.pct)} sobre o valor do arremate (lance vencedor ou proposta aceita pelo vendedor, sem somar comissão do leiloeiro e taxas)${minimo ? `, observado o valor mínimo de ${minimo}, caso o percentual resulte em montante inferior` : ''}.
${exito}
3.4. O honorário é devido quando o arremate se torna definitivo (lance vencedor ou proposta aceita). Lance recebido de forma condicional que o vendedor não aprove não gera honorário.
3.5. O pagamento deverá ser feito em até 2 (dois) dias úteis da confirmação do arremate, junto com o pagamento ao leiloeiro.
3.6. Todos os valores devidos no âmbito deste contrato deverão ser processados EXCLUSIVAMENTE pelos meios de pagamento disponibilizados na Plataforma BidPro Brasil. O pagamento por fora da Plataforma — diretamente à CONTRATADA, a prepostos, a terceiros ou por qualquer meio informal — configura quebra contratual, autorizando a rescisão imediata por justa causa e eximindo a CONTRATADA da continuidade das etapas seguintes, sem prejuízo da exigibilidade integral dos valores pactuados.

CLÁUSULA QUARTA — DO PRAZO E CANCELAMENTO
4.1. Este contrato vigora até a emissão do documento do veículo em nome da CONTRATANTE ou, não havendo arremate, por até 6 (seis) meses a contar da assinatura.
4.2. A CONTRATANTE deverá assinar este instrumento em até 30 (trinta) dias a contar do envio do link de assinatura.
4.3. A rescisão imotivada após o arremate não exime a CONTRATANTE do honorário de êxito já devido.

CLÁUSULA QUINTA — DOS RISCOS INERENTES AOS LEILÕES DE VEÍCULOS
5.1. A CONTRATANTE tem ciência de que o leilão pode ser suspenso ou cancelado pelo comitente, pelo leiloeiro ou por decisão judicial, e de que o lance pode ser recebido de forma condicional, dependendo de aprovação do vendedor.
5.2. A não retirada no prazo do edital gera cobrança de estadia pelo pátio, de responsabilidade da CONTRATANTE.
5.3. A CONTRATADA atua com rigor técnico na análise do lote; fatos alheios à sua atuação diligente (vícios ocultos, informações incorretas do vendedor ou do leiloeiro, exigências supervenientes do DETRAN) são riscos inerentes ao negócio e não configuram falha na prestação do serviço.

CLÁUSULA SEXTA — DA ANTICORRUPÇÃO E DA PREVENÇÃO À LAVAGEM DE DINHEIRO
6.1. As Partes conhecem e cumprem a Lei nº 12.846/2013 (Anticorrupção), comprometendo-se a não praticar suborno, fraude ou oferta de vantagem indevida a agentes públicos, leiloeiros ou terceiros.
6.2. A CONTRATANTE cumpre as normas de prevenção à lavagem de dinheiro (Lei nº 9.613/1998) e atesta, sob as penas da lei, que os recursos utilizados na operação têm origem lícita e declarada, obrigando-se a comprová-la sempre que solicitado.
6.3. A violação a esta cláusula autoriza a rescisão imediata por justa causa, com honorários devidos integralmente e comunicação aos órgãos competentes.

CLÁUSULA SÉTIMA — DA CONFIDENCIALIDADE E LGPD
7.1. As análises e estratégias da CONTRATADA são protegidas por sigilo profissional e direitos intelectuais.
7.2. As Partes observam a Lei nº 13.709/2018 (LGPD), limitando o uso das informações pessoais e financeiras ao estritamente necessário para a execução dos serviços.

CLÁUSULA OITAVA — DO FORO
8.1. As Partes elegem o foro da Comarca de Feira de Santana/BA para dirimir controvérsias, renunciando a qualquer outro por mais privilegiado que seja.

E, por estarem justas e contratadas, as partes assinam o presente instrumento digitalmente. Assinatura eletrônica válida nos termos da MP 2.200-2/2001 e Lei 14.063/2020.

CONTRATADA: NOGUEIRA EMPREENDIMENTOS LTDA — CNPJ 02.311.492/0001-61

CONTRATANTE: [NOME DO SIGNATÁRIO] — CPF/CNPJ [CPF/CNPJ DO SIGNATÁRIO]`;
}

/**
 * Gera o termo de um caso de veículo (veiculo_casos) e, se pedido e houver honorário a cobrar, a cobrança
 * avulsa do honorário. Nunca lança: devolve { ok:false, motivo } em qualquer falha.
 */
export async function gerarTermoAssessoriaVeiculo(sb, { casoId, criadoPor = null, cobrar = false }) {
  try {
    const rC = await sb(`veiculo_casos?id=eq.${encodeURIComponent(casoId)}&select=*&limit=1`);
    if (!rC.ok) return { ok: false, motivo: `leitura do caso HTTP ${rC.status}` };
    const [caso] = await rC.json();
    if (!caso) return { ok: false, motivo: 'caso de veículo não encontrado' };
    if (!caso.cliente_id) return { ok: false, motivo: 'caso sem cliente vinculado — o termo precisa de quem assina' };
    if (!caso.assessoria) return { ok: false, motivo: 'caso sem assessoria contratada — marque "assessoria" antes de gerar o termo' };
    const regra = await regraHonorarioVeiculo(sb);
    if (!regra) return { ok: false, motivo: 'não consegui ler a regra do honorário (regra_negocio assessoria_veiculo.honorario) — termo NÃO gerado' };

    const rP = await sb(`perfis?id=eq.${caso.cliente_id}&select=nome&limit=1`);
    if (!rP.ok) return { ok: false, motivo: `leitura do perfil HTTP ${rP.status}` };
    const [perfil] = await rP.json();
    const nome = perfil?.nome || null;
    const conteudo = preencherSignatario(
      termoAssessoriaVeiculo(regra, caso).replace(/\[NOME DO SIGNATÁRIO\]/gi, nome || '[NOME DO SIGNATÁRIO]'),
      await dadosConhecidosDoSignatario(sb, caso.cliente_id),
    );

    // Cobrança do honorário: só com arremate definido, valor calculado pelo BANCO (caso.honorario_valor)
    // e se ainda não houver uma (não duplica ao gerar o termo de novo).
    let cobrancaUrl = null, aviso = null;
    if (cobrar) {
      if (caso.cobranca_id) cobrancaUrl = `${ORIGIN()}/#/cobranca/${caso.cobranca_id}`;
      else if (!(Number(caso.honorario_valor) > 0)) aviso = 'sem valor de arremate ainda — cobrança do honorário não criada';
      else if (['pago', 'isento'].includes(caso.honorario_status)) aviso = `honorário ${caso.honorario_status} — cobrança não criada`;
      else {
        const rCob = await sb('cobrancas_avulsas', {
          method: 'POST', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            descricao: `Assessoria de veículo BidPro — honorário de êxito · ${caso.titulo}${caso.placa ? ` (${caso.placa})` : ''}`.slice(0, 500),
            valor: Number(caso.honorario_valor), destinatario_nome: nome, criado_por: criadoPor,
          }),
        });
        if (!rCob.ok) return { ok: false, motivo: `cobrança do honorário não foi criada (HTTP ${rCob.status}) — termo NÃO gerado para não citar cobrança inexistente` };
        const [cob] = await rCob.json();
        if (!cob?.id) return { ok: false, motivo: 'cobrança não voltou do banco' };
        cobrancaUrl = `${ORIGIN()}/#/cobranca/${cob.id}`;
        const rU = await sb(`veiculo_casos?id=eq.${caso.id}`, {
          method: 'PATCH', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ cobranca_id: cob.id, honorario_status: 'cobrado' }),
        });
        const marcado = rU.ok ? await rU.json().catch(() => []) : [];
        if (!marcado.length) aviso = `cobrança ${cob.id} criada, mas o caso não registrou o vínculo (HTTP ${rU.status})`;
      }
    }

    const r = await criarDocumento(sb, {
      userId: caso.cliente_id, titulo: 'Termo de Contratação da Assessoria de Veículo', conteudo,
      produtoTipo: 'assessoria', produtoId: `veiculo:${caso.id}`, planoKey: null, imovelId: null, criadoPor,
    });
    if (r.ok && r.url && r.url !== caso.termo_url) {
      const rT = await sb(`veiculo_casos?id=eq.${caso.id}`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ termo_url: r.url }),
      });
      const gravado = rT.ok ? await rT.json().catch(() => []) : [];
      if (!gravado.length) aviso = [aviso, `link do termo não gravado no caso (HTTP ${rT.status})`].filter(Boolean).join('; ');
    }
    return { ...r, cobrancaUrl, ...(aviso || r.aviso ? { aviso: [r.aviso, aviso].filter(Boolean).join('; ') } : {}) };
  } catch (e) {
    return { ok: false, motivo: String(e?.message || e).slice(0, 160) };
  }
}
