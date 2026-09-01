/**
 * scripts/testes/cidade-do-titulo-nao-pode-ser-o-titulo.mjs
 *
 * POR QUE EXISTE (01/09). O BIASI gravava o TÍTULO INTEIRO no campo `cidade` em 88% do
 * acervo — 308 de 350 lotes ativos com " - " dentro da cidade, 7% de cidades úteis. A
 * causa foi um regex cuja classe de caracteres incluía hífen e espaço
 * (`[A-Za-zÀ-ÿ'.\- ]{2,40}`), então ele atravessava os separadores e comia o título para
 * trás. `sem_cidade` não via nada: o campo vinha CHEIO, só que com a coisa errada.
 *
 * O que este teste trava não é o regex antigo — é a REGRA que o substituiu: a cidade só
 * vale se for município REAL daquela UF, e quando não for, o campo fica VAZIO.
 */
import { cidadeBairroDoTitulo } from '../../api/_cidade-do-titulo.js';

const casos = [
  // ── o formato dominante do BIASI: "Tipo - Bairro - Cidade/UF" ──────────────────────
  ['Casa - Parque Dos Timburis - São Carlos/SP', 'São Carlos', 'SP', 'Parque Dos Timburis',
   'o caso que motivou tudo — antes virava cidade="Casa - Parque Dos Timburis - São Carlos"'],
  ['Apartamento - Sampaio - Rio de Janeiro/RJ', 'Rio de Janeiro', 'RJ', 'Sampaio',
   'cidade com espaco no nome nao pode ser cortada'],

  // ── a armadilha do sufixo: o MAIOR tem de ganhar ───────────────────────────────────
  ['Casa - Centro - Santa Helena de Goiás/GO', 'Santa Helena de Goiás', 'GO', 'Centro',
   'nao pode casar so "Goias" (que tambem e municipio de outra UF) nem "Helena de Goias"'],
  ['Imóvel no Centro de Jandaia do Sul/PR', 'Jandaia do Sul', 'PR', '',
   'titulo livre, sem " - ": o sufixo maior ainda tem de vencer'],

  // ── títulos em prosa, que o regex antigo destruía por completo ─────────────────────
  ['Casa no Bairro Trindade em São Gonçalo/RJ', 'São Gonçalo', 'RJ', '', 'conector "em"'],
  ['Imóvel Comercial no Centro de Sorocaba/SP', 'Sorocaba', 'SP', '', 'conector "de"'],
  ['03 Lojas Comerciais em Benfica - Rio de Janeiro/RJ', 'Rio de Janeiro', 'RJ', '',
   'numero na frente e hifen no meio nao atrapalham'],

  // ── ERRO DA FONTE: melhor VAZIO do que errado ──────────────────────────────────────
  ['06 Terrenos no Jardim das Acácias em Paraíso de Tocantins/TO', '', 'TO', '',
   'o municipio e "Paraiso DO Tocantins" — nao inventar'],
  ['Apartamento - Vila Tupi - Várzea Grande/SP', '', 'SP', '',
   'Varzea Grande e MT, nao SP: UF errada na fonte nao pode virar cidade certa'],
  ['Imóvel em São José - Encantando/RS', '', 'RS', '', '"Encantando" nao existe (e Encantado)'],
  ['Apartamento no "Condomínio Parque Residencial Messejana" - Messejana - Messejana/CE', '', 'CE', '',
   'Messejana e bairro de Fortaleza, nao municipio'],

  // ── a UF sobrevive à cidade não reconhecida ────────────────────────────────────────
  ['Galpão em Cidade Que Nao Existe/BA', '', 'BA', '',
   'sem cidade a UF continua valendo — ela vem do sufixo, nao do nome'],

  // ── entradas degeneradas ───────────────────────────────────────────────────────────
  ['', '', '', '', 'vazio'],
  [null, '', '', '', 'nulo'],
  ['Casa sem barra nem uf', '', '', '', 'sem "/UF" nao ha o que afirmar'],
  ['Casa - Centro - Curitiba/pr', 'Curitiba', 'PR', 'Centro', 'UF minuscula normaliza'],
];

let mau = 0;
for (const [titulo, cidade, uf, bairro, oque] of casos) {
  const r = cidadeBairroDoTitulo(titulo);
  const ok = r.cidade === cidade && r.uf === uf && r.bairro === bairro;
  if (!ok) mau++;
  console.log(`${ok ? '  ok  ' : '  FALHOU'} ${JSON.stringify(titulo)}`);
  if (!ok) console.log(`         obtido  cidade="${r.cidade}" uf="${r.uf}" bairro="${r.bairro}"\n         esperado cidade="${cidade}" uf="${uf}" bairro="${bairro}"  · ${oque}`);
}

// A trava que importa mais que qualquer caso isolado: a cidade NUNCA pode conter o
// separador do título. Se isto voltar a passar, o defeito de 01/09 voltou.
const REGRESSAO = ['Casa - Parque Dos Timburis - São Carlos/SP', 'Apartamento - Sampaio - Rio de Janeiro/RJ'];
for (const t of REGRESSAO) {
  const c = cidadeBairroDoTitulo(t).cidade;
  if (/ - /.test(c) || /^(casa|apartamento|imóvel|imovel|terreno|lote|galpão|loja)\b/i.test(c)) {
    console.log(`  FALHOU regressao: cidade="${c}" ainda tem cara de titulo`);
    mau++;
  }
}

console.log(mau === 0 ? `\n${casos.length} casos OK` : `\n${mau} FALHA(S)`);
process.exit(mau === 0 ? 0 : 1);
