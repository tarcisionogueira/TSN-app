/**
 * RECON (só leitura, não grava) — por que a ficha do lote da NORDESTE volta VAZIA nos leilões de
 * pátio (pendência #166).
 *
 * Medido no acervo em 07/10: leilão 213 (judicial) tem 5/5 lotes com ficha de 511–1693 caracteres;
 * os leilões 197–207 (de pátio, títulos "VEÍCULO CONSERVADO …") têm 0 de 112 — a `descricao`
 * gravada tem 41–57 caracteres, que é o TÍTULO entrando pelo fallback `|| titulo`. O classificador
 * de pátio recebia esse título e dizia "sem sinal de pátio na ficha": veredito sobre texto que
 * nunca foi lido, e 0 de 112 lotes de pátio aparecendo em /veiculos.
 *
 * `descricaoDoLote()` devolve '' por TRÊS caminhos e não distingue qual: (a) o lote não tem campo
 * `description`; (b) tem, mas é uma referência `$<hex>` que não foi achada no html; (c) a
 * referência existe, mas a janela de 12.000 caracteres ou o `split('self.__next_f.push')` não
 * alcançaram o texto. Este recon imprime QUAL dos três é — sem isso o conserto seria chute.
 *
 * Roda no GitHub Actions (workflow manual): o sandbox não tem egresso para nordesteleiloes.com.br.
 * Usa o MESMO motor do coletor (`motor/fetch-dom.mjs`, grátis, sem Bright Data).
 */
import './lib/env-runner.mjs';
import { criarMotorDom } from './lib/motor/fetch-dom.mjs';
import { loteDoPayload, descricaoDoLote } from './lib/nordeste-parse.mjs';
import { slugDoLote } from './lib/nordeste-veiculo.mjs';

const ALVOS = (process.env.RECON_URLS || [
  'https://www.nordesteleiloes.com.br/lotes/197-001-veiculo-conservado-dafra-super-100-20092010',
  'https://www.nordesteleiloes.com.br/lotes/197-002-veiculo-conservado-honda-cg-125-cargo-20022003',
  'https://www.nordesteleiloes.com.br/lotes/199-001-veiculo-conservado-honda-cg-125-titan-ks-20012001',
  // CONTROLE: lote judicial cuja ficha o parser JÁ lê. Sem ele, "não achei texto" poderia ser
  // defeito do recon, e não da página — a comparação é o que separa os dois.
  'https://www.nordesteleiloes.com.br/lotes/213-001-motocicleta-yamahaybr125i-factor-ed-ano-20212022',
].join(',')).split(',').map((s) => s.trim()).filter(Boolean);

const marca = (h, termo) => {
  const i = h.toLowerCase().indexOf(termo.toLowerCase());
  return i < 0 ? '(não aparece)' : `pos ${i}: ${JSON.stringify(h.slice(Math.max(0, i - 40), i + 120))}`;
};

const motor = criarMotorDom({ esperaMs: 3000, timeoutMs: 90000 });
let lidos = 0;
for (const url of ALVOS) {
  const slug = slugDoLote(url);
  console.log(`\n═══ ${slug}`);
  const r = await motor.fetchFonte(url);
  if (!r.html) { console.log(`  ✗ não abriu (via=${r.via})`); continue; }
  lidos++;
  const html = r.html;
  console.log(`  html: ${html.length} caracteres (via ${r.via})`);

  const lote = loteDoPayload(html, slug);
  if (!lote) { console.log('  ✗ payload do lote NÃO encontrado — o problema é antes da ficha'); continue; }
  console.log(`  payload: ${Object.keys(lote).length} chaves · title=${JSON.stringify(String(lote.title || '').slice(0, 60))}`);
  const d = lote.description;
  console.log(`  description: tipo=${typeof d} · ${d === undefined ? 'AUSENTE' : JSON.stringify(String(d).slice(0, 80))}`);

  // Qual dos três caminhos de vazio:
  const ref = (String(d || '').match(/^\$([0-9a-f]+)$/i) || [])[1];
  if (d === undefined || d === null) console.log('  → CAUSA (a): o lote não traz o campo `description`');
  else if (!ref) console.log('  → não é referência $hex: o texto deveria vir direto do campo');
  else {
    const ib = html.indexOf(`"${ref}:T`);
    console.log(`  → referência $${ref} · "${ref}:T" ${ib >= 0 ? `achada em pos ${ib}` : 'NÃO ACHADA no html'}`);
    if (ib >= 0) {
      const janela = html.slice(ib, ib + 12000);
      const partes = janela.split('self.__next_f.push');
      console.log(`     janela 12k: ${partes.length} parte(s) ao cortar em self.__next_f.push · parte[1] tem ${partes[1] ? partes[1].length : 0} caracteres`);
      if (!partes[1]) console.log('     → CAUSA (c): o split não produziu parte[1] — o texto não está depois de um push dentro da janela');
      // O texto pode estar logo DEPOIS da marca, sem outro push no meio:
      console.log(`     amostra crua pós-marca: ${JSON.stringify(janela.slice(0, 260))}`);
    } else {
      console.log('  → CAUSA (b): a referência existe no objeto mas não há bloco correspondente no html desta página');
    }
  }

  const desc = descricaoDoLote(html, lote);
  console.log(`  descricaoDoLote() → ${desc.length} caracteres${desc ? `: ${JSON.stringify(desc.slice(0, 120))}` : ''}`);

  // Onde o texto que INTERESSA está no html cru, se é que está:
  for (const termo of ['Localização do Bem', 'Bens:', 'Descrição', 'Local para vistoria'])
    console.log(`  "${termo}" → ${marca(html, termo)}`);
}

console.log(`\n${lidos}/${ALVOS.length} páginas abertas.`);
// "Não consegui medir" não pode sair como "medi e está tudo bem" (CLAUDE.md, trava do schema).
if (!lidos) { console.error('RECON INVÁLIDO: nenhuma página abriu — nada foi medido.'); process.exit(2); }
