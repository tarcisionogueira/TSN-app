// Destinos de TEMPORADA (aluguel de curta duração / veraneio) do Brasil — referência única do
// backend para (a) classificar o imóvel como "bom para temporada" e (b) sustentar a DEFESA no
// parecer. Lista curada do acervo real + validada na web (demanda Airbnb / alta temporada).
// Mantém `cidade_norm` (sem espaços/acentos, igual à coluna gerada). AJUSTÁVEL conforme a operação.
// OBS.: o filtro da tela de Leilões (src/pages/Busca.jsx → CIDADES_TEMPORADA) espelha esta lista —
// ao alterar aqui, alinhe lá.

// Motivo de atratividade por cidade (defesa curta p/ o parecer). Onde não houver específico,
// cai no genérico por proximidade de litoral.
const MOTIVO = {
  // — Litoral SP —
  guaruja: 'Guarujá (SP): principal balneário da Baixada Santista, alta demanda de veraneio e proximidade da capital.',
  praiagrande: 'Praia Grande (SP): um dos maiores fluxos de turismo de temporada do litoral paulista, orla extensa e acesso fácil por rodovia.',
  saovicente: 'São Vicente (SP): litoral da RM da Baixada Santista, procura constante de temporada.',
  bertioga: 'Bertioga (SP): destino de veraneio do litoral norte paulista (Riviera de São Lourenço), alta ocupação no verão.',
  saosebastiao: 'São Sebastião (SP): porta de entrada de Maresias e praias do litoral norte, forte demanda de temporada.',
  ubatuba: 'Ubatuba (SP): 100+ praias catalogadas, um dos destinos de praia mais procurados do litoral norte de SP.',
  caraguatatuba: 'Caraguatatuba (SP): polo do litoral norte paulista com forte demanda de locação por temporada.',
  ilhabela: 'Ilhabela (SP): ilha-arquipélago de alto apelo turístico e náutico, diárias elevadas na alta temporada.',
  itanhaem: 'Itanhaém (SP): litoral sul paulista, veraneio acessível e boa procura sazonal.',
  mongagua: 'Mongaguá (SP): balneário do litoral sul de SP com público de temporada.',
  peruibe: 'Peruíbe (SP): litoral sul paulista, natureza preservada e demanda de veraneio.',
  // — Litoral RJ / Região dos Lagos —
  cabofrio: 'Cabo Frio (RJ): Região dos Lagos, sol quase o ano todo e altíssima procura de temporada.',
  armacaodosbuzios: 'Búzios (RJ): destino turístico premium, uma das maiores taxas de ocupação de temporada do país.',
  arraialdocabo: 'Arraial do Cabo (RJ): o "Caribe brasileiro", praias de águas cristalinas e forte turismo.',
  angradosreis: 'Angra dos Reis (RJ): Costa Verde e ilhas, turismo náutico e de alto padrão.',
  paraty: 'Paraty (RJ): centro histórico patrimônio + praias, fluxo turístico o ano todo.',
  macae: 'Macaé (RJ): litoral fluminense com demanda de temporada e corporativa (petróleo).',
  marica: 'Maricá (RJ): litoral em forte valorização na Região Metropolitana do Rio, demanda crescente.',
  saopedrodaaldeia: 'São Pedro da Aldeia (RJ): Região dos Lagos, veraneio e lagoa de Araruama.',
  niteroi: 'Niterói (RJ): praias urbanas e vista para o Rio, procura turística e de curta estadia.',
  // — Santa Catarina —
  florianopolis: 'Florianópolis (SC): 85–90% de ocupação na temporada, praias famosas (Jurerê, Joaquina) e demanda Airbnb o ano todo.',
  balneariocamboriu: 'Balneário Camboriú (SC): um dos destinos mais rentáveis do país para temporada, verticalização e vida noturna.',
  itapema: 'Itapema (SC): vizinha de BC em forte valorização, orla nobre e alta procura de temporada.',
  bombinhas: 'Bombinhas (SC): santuário de mergulho e praias, altíssima ocupação no verão.',
  garopaba: 'Garopaba (SC): surfe e praias, destino consolidado do litoral catarinense.',
  itajai: 'Itajaí (SC): litoral catarinense (Praia Brava), turismo e eventos.',
  navegantes: 'Navegantes (SC): litoral norte de SC, aeroporto e praias, demanda crescente.',
  portobelo: 'Porto Belo (SC): praias e Ilha de Porto Belo, veraneio catarinense.',
  saofranciscodosul: 'São Francisco do Sul (SC): centro histórico e praias, turismo do litoral norte.',
  // — Bahia —
  portoseguro: 'Porto Seguro (BA): polo turístico consolidado do Nordeste, boa infraestrutura e alta temporada forte.',
  ilheus: 'Ilhéus (BA): litoral cacaueiro, praias e turismo cultural.',
  itacare: 'Itacaré (BA): ecoturismo e surfe, destino de alto apelo e diárias elevadas.',
  valenca: 'Valença (BA): acesso à Península de Maraú/Ilha de Boipeba, turismo de natureza.',
  maragogi: 'Maragogi (AL): "Caribe brasileiro", piscinas naturais e altíssima procura turística.',
  // — Alagoas / Pernambuco —
  maceio: 'Maceió (AL): praias urbanas de destaque nacional e boa infraestrutura para temporada.',
  ipojuca: 'Ipojuca (PE): abriga Porto de Galinhas, um dos destinos de praia mais procurados do Brasil.',
  cabodesantoagostinho: 'Cabo de Santo Agostinho (PE): praias premiadas (Gunga/Calhetas), forte turismo.',
  tamandare: 'Tamandaré (PE): piscinas naturais e praias, veraneio pernambucano.',
  // — Espírito Santo —
  vilavelha: 'Vila Velha (ES): praia da Costa e orla urbana, procura de temporada na Grande Vitória.',
  guarapari: 'Guarapari (ES): "Cidade Saúde", praias de areias monazíticas, destino de veraneio tradicional.',
  marataizes: 'Marataízes (ES): litoral sul capixaba, veraneio acessível.',
  anchieta: 'Anchieta (ES): praias e santuário histórico, turismo litorâneo.',
  // — Rio Grande do Sul —
  torres: 'Torres (RS): principal destino de praia do litoral gaúcho, alta temporada intensa.',
  capaodacanoa: 'Capão da Canoa (RS): litoral norte gaúcho, grande fluxo de veraneio.',
  tramandai: 'Tramandaí (RS): litoral norte do RS, veraneio consolidado.',
  imbe: 'Imbé (RS): vizinha de Tramandaí, praia e temporada.',
  xangrila: 'Xangri-lá (RS): litoral nobre gaúcho (Atlântida), diárias elevadas na temporada.',
  // — Paraná —
  guaratuba: 'Guaratuba (PR): baía e praias, destino de veraneio do litoral paranaense.',
  matinhos: 'Matinhos (PR): Caiobá e orla, principal balneário do litoral do PR.',
  pontaldoparana: 'Pontal do Paraná (PR): praias e temporada no litoral paranaense.',
  // — RN / CE —
  natal: 'Natal (RN): "Cidade do Sol", dunas e praias urbanas, destino nordestino consolidado.',
  extremoz: 'Extremoz (RN): praia de Genipabu e dunas, forte apelo turístico próximo a Natal.',
  fortaleza: 'Fortaleza (CE): capital com praias urbanas e enorme fluxo turístico o ano todo.',
  aquiraz: 'Aquiraz (CE): Porto das Dunas / Beach Park, um dos maiores polos de resort do Nordeste.',
  caucaia: 'Caucaia (CE): praia do Cumbuco, kitesurfe e turismo internacional.',
  beberibe: 'Beberibe (CE): Morro Branco e falésias, destino de praia cearense.',
};
export const CIDADES_TEMPORADA = new Set(Object.keys(MOTIVO));

// Defesa de atratividade da cidade p/ temporada (string) — específico quando houver; senão null.
export function motivoTemporada(cidadeNorm) {
  return MOTIVO[cidadeNorm] || null;
}
export function ehCidadeTemporada(cidadeNorm) {
  return !!cidadeNorm && CIDADES_TEMPORADA.has(cidadeNorm);
}
