/**
 * npm run testar:analise-url — a tela de análise se recupera pelo id da URL.
 *
 * 10/09, ao vivo, cliente pagante (Neuma). Rastro no `eventos_atividade`:
 *   01:11:22.879  click    /imovel   "Analisar (10 de 10 deste mês)"
 *   01:11:22.880  pageview /analise
 *   01:11:24.077  pageview /analise          ← REMONTOU 1,2 s depois
 *   01:11:25      analise_estado: mercado=livre; cota=0/10   ← porta aberta
 *   01:11:30 … 01:12:36   SETE cliques em "Gerar", os SETE:
 *                         analise_gerar → "recusado: imovel sem endereco/cidade"
 * O lote (CEF, Mangabeira/Feira de Santana/BA) tem endereço, bairro, cidade, UF E coordenadas
 * no banco. O que faltava era na TELA: na segunda montagem o `location.state` sumiu.
 *
 * POR QUE FICOU INVISÍVEL: `analiseImovelId = imovelInicial?.id || d.id`, e `d.id` é o id LOCAL
 * (`tsn_…`), SEMPRE preenchido. Então a tela parecia inteira — carregou cota, disparou eventos —
 * com o formulário vazio por dentro. É a forma nº 1 do CLAUDE.md numa roupa nova: um vazio que
 * não sabe que está vazio, e que só se revela quando o cliente clica.
 *
 * A MESMA perda causava o segundo sintoma do mesmo dia: sem imóvel, `semImovelBase` fica true e
 * a INCLUSÃO MANUAL abre sozinha — num lote que já tem documentos anexados. Uma raiz, dois bugs.
 *
 * Conserto: o id viaja na URL (`/analise?imovel=<uuid>`); o state vira só o caminho rápido.
 */
import { readFileSync } from 'node:fs';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};
const ler = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');

console.log('\nTODA NAVEGAÇÃO PARA /analise LEVA O ID NA URL');
for (const [arq, n] of [
  ['src/pages/ImovelDetalhe.jsx', 2], ['src/pages/Painel.jsx', 2],
  ['src/pages/MinhasAnalises.jsx', 1], ['src/components/ToastRelatorioPronto.jsx', 1],
]) {
  const src = ler(arq);
  const comId = (src.match(/nav\(`\/analise\?imovel=\$\{encodeURIComponent/g) || []).length;
  checa(`${arq}: ${n} navegação(ões) com id`, comId === n, { achou: comId, esperado: n });
  // "Incluir lote manual" é o caso legítimo SEM imóvel — não pode ser contado como regressão.
  const semId = (src.match(/nav\('\/analise'(?!\s*,\s*\{\s*state:\s*\{\s*manual)/g) || []).length;
  checa(`${arq}: nenhuma navegação sem id (fora a inclusão manual)`, semId === 0, { semId });
}

console.log('\nA TELA SE RECUPERA PELO ID');
{
  const src = ler('src/pages/Analise.jsx');
  checa('lê o parâmetro `imovel` da URL', /useSearchParams/.test(src) && /params\.get\('imovel'\)/.test(src));
  checa('o imóvel pode vir do state OU do recuperado',
    /const imovelInicial = location\.state\?\.imovel \|\| imovelRecuperado;/.test(src));
  checa('relê `imoveis_leilao` pelo id quando o state não serve',
    /from\('imoveis_leilao'\)[\s\S]{0,400}?\.eq\('id', idDaUrl\)/.test(src));
  checa('a releitura passa pela renovação de sessão (falha de leitura ≠ imóvel sem endereço)',
    /lerComRenovacao\(supabase, \(\) => supabase\s*\n?\s*\.from\('imoveis_leilao'\)/.test(src));
  checa('e deixa rastro quando nem assim consegue', /analise_recuperar_imovel/.test(src));
  checa('state MAGRO (só id/título/cidade) também dispara a releitura',
    /jaTem\.endereco \|\| jaTem\.cidade/.test(src));
}

console.log('\nO BOTÃO NÃO ACEITA MAIS SETE CLIQUES EM VÃO');
{
  const src = ler('src/pages/Analise.jsx');
  checa('a condição de "sem imóvel" virou estado da tela', /const semDadosDoImovel = !d\.endereco && !d\.cidade;/.test(src));
  checa('e entra na trava do card de mercado', /semDadosDoImovel && c\.k === 'mercado'/.test(src));
  checa('o botão diz o motivo em vez de só travar', /Dados do im[óo]vel indispon[íi]veis/.test(src));
  checa('e distingue "ainda carregando" de "não veio"', /aindaCarregandoImovel/.test(src));
  checa('o aviso garante que a cota NÃO foi consumida', /nenhuma cota foi consumida/i.test(src));
  checa('a recusa dentro do clique CONTINUA (defesa em profundidade)',
    /recusado: imovel sem endereco\/cidade/.test(src));
}

console.log('\nA INCLUSÃO MANUAL NÃO ABRE SOZINHA EM LOTE DO ACERVO');
{
  const src = ler('src/pages/Analise.jsx');
  checa('`semImovelBase` considera o id da URL', /const semImovelBase = !imovelInicial && !idDaUrl;/.test(src));
  const i = src.indexOf('const semImovelBase'), j = src.indexOf('const [modoManual');
  checa('e é declarado ANTES de `modoManual` (o useState lê no mount)', i > 0 && j > i, { i, j });
}

console.log('\nO SALDO DE RELATÓRIOS É INFORMAÇÃO, NÃO BOTÃO');
{
  const src = ler('src/pages/ImovelDetalhe.jsx');
  checa('o rótulo do botão não carrega mais o contador',
    !/Analisar \(\$\{cota\.restantes\} de \$\{cota\.limite\}/.test(src));
  checa('o botão diz só a ação', /'Analisar gr[áa]tis' : 'Analisar im[óo]vel'/.test(src));
  checa('o saldo virou texto próprio', /const saldoAnalise =/.test(src));
  checa('e não é clicável', /cursor: 'default', userSelect: 'none'/.test(src));
  checa('esgotado CONTINUA no botão (é aviso, não contagem)',
    /'An[áa]lises gr[áa]tis esgotadas' : 'Cota do m[êe]s esgotada'/.test(src));
}

console.log(`\n${falhas ? '✗' : '✓'} ${ok} passaram, ${falhas} falharam\n`);
process.exit(falhas ? 1 : 0);
