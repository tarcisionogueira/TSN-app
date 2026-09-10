/**
 * scripts/testes/webhook-leiloeiro-aceita-foto-e-anexo.mjs
 *
 * POR QUE EXISTE (10/09). Revisão do dono no Portal do Leiloeiro achou que o webhook de
 * parceiros nunca gravava foto nem documento — a tabela de destino (imoveis_leilao) já tinha
 * as colunas (fotos/link_foto/anexos/link_matricula/link_edital/link_regras_venda, as mesmas
 * dos scrapers), mas `upsert_lote` simplesmente não lia esses campos do payload. Corrigido
 * lendo `fotosValidas`/`anexosValidos` diretamente do módulo do webhook — nunca reproduzindo
 * a validação aqui — porque a fonte é um payload de TERCEIRO (parceiro externo, não um
 * scraper nosso): tem que sobreviver a lixo, URL fora do padrão e tipo desconhecido sem
 * quebrar o lote inteiro.
 */
import { fotosValidas, anexosValidos } from '../../api/leiloeiro-webhook.js';

let falhas = 0;
const ok = (cond, oque, extra = '') => {
  if (cond) console.log(`  ✓ ${oque}`);
  else { falhas++; console.log(`  ✗ ${oque}${extra ? ` — ${extra}` : ''}`); }
};

console.log('\nfotosValidas — só URL http(s), nunca deixa o lote quebrar por lixo no array');
{
  ok(fotosValidas({}).length === 0, 'sem `fotos` no lote: array vazio, não erro');
  ok(fotosValidas({ fotos: 'https://x.com/a.jpg' }).length === 0, '`fotos` não é array: ignora (partner mandou string solta)');
  const boas = ['https://x.com/1.jpg', 'https://x.com/2.jpg'];
  ok(JSON.stringify(fotosValidas({ fotos: boas })) === JSON.stringify(boas), 'URLs válidas passam, na ordem enviada (1ª vira capa)');
  ok(fotosValidas({ fotos: ['ftp://x.com/1.jpg', 'não é url', null, 123, 'https://ok.com/2.jpg'] }).length === 1,
    'lixo misturado no array: só a URL http(s) válida sobrevive, resto é descartado em silêncio (não derruba o lote)');
  ok(fotosValidas({ fotos: Array.from({ length: 50 }, (_, i) => `https://x.com/${i}.jpg`) }).length === 30,
    'teto de 30 fotos — parceiro não consegue inflar o payload sem limite');
}

console.log('\nanexosValidos — {url,nome,tipo}, url obrigatória e válida');
{
  ok(anexosValidos({}).length === 0, 'sem `anexos`: array vazio');
  ok(anexosValidos({ anexos: [{ nome: 'Matrícula', tipo: 'matricula' }] }).length === 0, 'anexo sem `url`: descartado (não pode ser documento sem link)');
  ok(anexosValidos({ anexos: ['https://x.com/doc.pdf'] }).length === 0, 'anexo como string solta (não objeto): descartado');
  const a = anexosValidos({ anexos: [{ url: 'https://x.com/matricula.pdf', nome: 'Matrícula do imóvel', tipo: 'matricula' }] });
  ok(a.length === 1 && a[0].url === 'https://x.com/matricula.pdf' && a[0].tipo === 'matricula', 'anexo completo passa com os 3 campos');
  const semNome = anexosValidos({ anexos: [{ url: 'https://x.com/doc.pdf' }] });
  ok(semNome.length === 1 && semNome[0].nome === null && semNome[0].tipo === null, 'nome/tipo ausentes viram null, não quebram (url sozinha já é um anexo válido)');
  ok(anexosValidos({ anexos: Array.from({ length: 30 }, (_, i) => ({ url: `https://x.com/${i}.pdf` })) }).length === 20,
    'teto de 20 anexos');
}

console.log('\nDERIVAÇÃO por tipo — a mesma lógica que o handler usa para preencher link_matricula/link_edital/link_regras_venda');
{
  const anexos = anexosValidos({ anexos: [
    { url: 'https://x.com/matricula.pdf', tipo: 'matricula' },
    { url: 'https://x.com/edital.pdf', tipo: 'edital' },
  ] });
  const linkPorTipo = (t) => anexos.find((a) => a.tipo === t)?.url || null;
  ok(linkPorTipo('matricula') === 'https://x.com/matricula.pdf', 'matrícula denormalizada corretamente');
  ok(linkPorTipo('edital') === 'https://x.com/edital.pdf', 'edital denormalizado corretamente');
  ok(linkPorTipo('regras') === null, 'tipo não enviado (regras) vira null, não undefined nem erro — column fica limpa');
}

console.log(falhas ? `\n✗ ${falhas} falha(s)\n` : '\n✓ todos os casos passaram\n');
process.exit(falhas ? 1 : 0);
