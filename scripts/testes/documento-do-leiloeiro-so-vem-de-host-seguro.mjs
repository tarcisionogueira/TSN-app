/**
 * npm run testar:doc-leiloeiro — o achador genérico de documento acha o link certo, e nunca
 * atravessa pra rede interna.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * Item 4 do pedido do dono (03/09): "no edital tem o link do leiloeiro, com isso vamos ter
 * o acesso ao leiloeiro e conectar com ele para pegar os documentos caso não estejam já
 * disponibilizados." `descobrirDocumentosNoSite` é MELHOR ESFORÇO GENÉRICO — fetch + regex
 * sobre HTML estático, não um scraper dedicado por site — e só é seguro porque usa a MESMA
 * proteção anti-SSRF (`hostExternoSeguro`) que `gerar-analise.js` já usa para alcançar
 * documento em site de leiloeiro.
 *
 * Este teste NÃO faz rede (nem deveria — sandbox sem acesso a site de leiloeiro real). Ele
 * prova a extração de link sobre HTML fixo, e prova que o guard de host bloqueia ANTES de
 * qualquer fetch — testável sem rede porque `hostExternoSeguro` é síncrono e puro.
 */
import { hostExternoSeguro } from '../../api/_allowed-hosts.js';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};

// Reimplementa a extração de links (mesma regex de `descobrirDocumentosNoSite`) para testar
// sem precisar de rede — a função de produção só adiciona o fetch em volta disto.
function extrairLinksDoc(html, baseUrl) {
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)]
    .map(([, href, texto]) => ({ href, texto: texto.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }));
  const acha = (re) => {
    const cand = links.find((l) => re.test(l.href) || re.test(l.texto));
    if (!cand) return null;
    try {
      const abs = new URL(cand.href, baseUrl).toString();
      return hostExternoSeguro(abs) ? abs : null;
    } catch { return null; }
  };
  const matricula = acha(/matr[íi]cula/i);
  const edital = acha(/\bedital\b/i);
  return (matricula || edital) ? { matricula, edital } : null;
}

console.log('\nACHA O LINK — por texto do link ou pelo próprio href');
const base = 'https://exemplo-leiloeiro.com.br/lote/123';
checa('acha pelo TEXTO do link ("Baixar matrícula")',
  extrairLinksDoc('<a href="/docs/arq1.pdf">Baixar matrícula do imóvel</a>', base)?.matricula
    === 'https://exemplo-leiloeiro.com.br/docs/arq1.pdf');
checa('acha pelo HREF quando o texto não ajuda ("Clique aqui")',
  extrairLinksDoc('<a href="/docs/edital-2024.pdf">Clique aqui</a>', base)?.edital
    === 'https://exemplo-leiloeiro.com.br/docs/edital-2024.pdf');
// ⚠️ A primeira versão deste teste esperava que o link relativo resolvesse contra a RAIZ do
// domínio — errado: `new URL()` segue a especificação e resolve contra o DIRETÓRIO da URL
// base, igual a um navegador. "matricula.pdf" a partir de ".../lote/123" vira
// ".../lote/matricula.pdf", não ".../matricula.pdf". O teste pegou o erro na expectativa,
// não no código.
checa('resolve link RELATIVO contra o DIRETÓRIO da URL base (como um navegador)',
  extrairLinksDoc('<a href="matricula.pdf">Matrícula</a>', base)?.matricula
    === 'https://exemplo-leiloeiro.com.br/lote/matricula.pdf');
checa('acha matrícula E edital na mesma página',
  (() => { const r = extrairLinksDoc('<a href="/m.pdf">Matrícula</a> <a href="/e.pdf">Edital do leilão</a>', base);
    return r?.matricula?.endsWith('/m.pdf') && r?.edital?.endsWith('/e.pdf'); })());

console.log('\nNÃO INVENTA LINK — página sem documento nenhum');
checa('página sem menção a matrícula/edital → null',
  extrairLinksDoc('<a href="/sobre">Sobre nós</a> <a href="/contato">Contato</a>', base) === null);
checa('página vazia → null', extrairLinksDoc('', base) === null);
checa('só links de navegação (menu, rodapé) → null',
  extrairLinksDoc('<a href="/">Início</a><a href="/leiloes">Leilões</a><a href="/duvidas">Dúvidas</a>', base) === null);

console.log('\nO GUARD ANTI-SSRF — nunca segue link pra dentro da rede interna');
checa('link pra localhost NUNCA vira "achado"',
  extrairLinksDoc('<a href="http://localhost/matricula.pdf">Matrícula</a>', base) === null);
checa('link pra IP privado (10.x) NUNCA vira "achado"',
  extrairLinksDoc('<a href="http://10.0.0.5/matricula.pdf">Matrícula</a>', base) === null);
checa('link pro metadado de nuvem (169.254.169.254) NUNCA vira "achado"',
  extrairLinksDoc('<a href="http://169.254.169.254/matricula.pdf">Matrícula</a>', base) === null);
checa('domínio público de verdade passa (é o caso comum)',
  extrairLinksDoc('<a href="https://outro-site.com.br/matricula.pdf">Matrícula</a>', base)?.matricula
    === 'https://outro-site.com.br/matricula.pdf');

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok}/${ok + falhas} asserções`);
if (ok + falhas < 11) {
  console.error('TESTE INVÁLIDO: rodou menos asserções do que este arquivo declara.');
  process.exit(2);
}
process.exit(falhas === 0 ? 0 : 1);
