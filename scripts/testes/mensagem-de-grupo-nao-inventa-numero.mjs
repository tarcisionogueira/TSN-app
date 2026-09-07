/**
 * npm run testar:mensagem-grupo — as mensagens do grupo de WhatsApp da aula ao vivo (07/09,
 * api/_mensagens-grupo.js) nunca inventam número, fato jurídico ou prazo — só reorganizam o
 * que já foi dado como verdadeiro (pelo admin, ou pelo próprio `eventos_live.depoimentos`).
 *
 * Por que este teste existe: é a mesma classe de risco que `montarMensagem`
 * (admin-whatsapp-fila.js) já testa para o convite individual, agora pro grupo — e aqui o
 * pior caso possível (educação jurídica errada, postada pra 180 pessoas de uma vez) é mais
 * caro que o da mensagem individual.
 */
import {
  montarConvite, montarCase, montarEducacao, montarEnquete, montarUrgencia, montarFollowup,
  montarMensagemGrupo,
} from '../../api/_mensagens-grupo.js';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};

console.log('\nCASE DE SUCESSO — usa SÓ o depoimento dado, nunca recalcula ou completa número');
{
  const dep = { tag: 'Em fase de venda', nome: 'Rafael S.', local: null, texto: 'Foi disputado até o fim.', resultado: 'Lance vencedor de R$ 112.949,63, após disputa direta (4 lances registrados).' };
  const r = montarCase({ depoimento: dep, link: 'https://x/aula/y' });
  checa('resultado real aparece literal, sem edição', r?.includes(dep.resultado), r);
  checa('local ausente (null) não vira "(null)" no texto', !r?.includes('null'), r);
  checa('nome do depoimento aparece', r?.includes('Rafael S.'), r);
}
checa('sem "resultado" no depoimento → null (não inventa case)',
  montarCase({ depoimento: { nome: 'Alguém' }, link: 'https://x' }) === null);
checa('sem depoimento nenhum → null',
  montarCase({ depoimento: null, link: 'https://x' }) === null);

console.log('\nEDUCAÇÃO (mito ou verdade) — zero fato além do que o admin escreveu');
{
  const mito = 'Imóvel de leilão fica marcado pra sempre no documento';
  const verdade = 'Depois de 30 dias da arrematação, o registro sai normal.';
  const r = montarEducacao({ mito, verdade });
  checa('mito e verdade aparecem literais', r?.includes(mito) && r?.includes(verdade), r);
}
checa('sem "verdade" → null (não completa sozinho)',
  montarEducacao({ mito: 'algo', verdade: '' }) === null);
checa('sem "mito" → null',
  montarEducacao({ mito: '', verdade: 'algo' }) === null);

console.log('\nURGÊNCIA PRÉ-LIVE — vagas só aparecem quando o evento tem teto de VERDADE cadastrado');
{
  const base = { titulo: 'Aula de Leilão', quando: 'hoje, às 19h', link: 'https://x/aula/y' };
  const semVaga = montarUrgencia({ ...base, estagio: 't-2h' });
  checa('sem vagasMax → sem a palavra "Vagas" no texto (não inventa teto)', !semVaga?.includes('Vagas'), semVaga);
  const comVaga = montarUrgencia({ ...base, estagio: 't-2h', vagasMax: 40 });
  checa('com vagasMax=40 real → mostra o número real', comVaga?.includes('40'), comVaga);
  checa('estágio desconhecido → null (não inventa um estágio genérico)',
    montarUrgencia({ ...base, estagio: 't-3dias' }) === null);
  checa('sem link → null', montarUrgencia({ ...base, estagio: 't-2h', link: '' }) === null);
}

console.log('\nCONVITE — omite a linha de destaque quando nenhum é passado, nunca "undefined"');
{
  const base = { titulo: 'Aula X', quando: 'na quarta, às 19h', link: 'https://x/aula/y' };
  const semDestaque = montarConvite(base);
  checa('sem destaque → sem "undefined" em lugar nenhum', !semDestaque?.includes('undefined'), semDestaque);
  const comDestaque = montarConvite({ ...base, destaque: 'Mais de R$ 70 milhões em operações conduzidas.' });
  checa('com destaque → aparece literal', comDestaque?.includes('R$ 70 milhões'), comDestaque);
}

console.log('\nENQUETE — precisa de pergunta + pelo menos 2 opções pra ser enquete de verdade');
checa('1 opção só → null', montarEnquete({ pergunta: 'Qual?', opcoes: ['Só uma'] }) === null);
checa('sem pergunta → null', montarEnquete({ pergunta: '', opcoes: ['A', 'B'] }) === null);
{
  const r = montarEnquete({ pergunta: 'Qual imóvel te interessa?', opcoes: ['Apartamento', 'Casa', 'Terreno'] });
  checa('3 opções → numeradas 1️⃣2️⃣3️⃣, nenhuma perdida', ['1️⃣', '2️⃣', '3️⃣'].every((n) => r?.includes(n)) && r?.includes('Apartamento') && r?.includes('Terreno'), r);
}

console.log('\nFOLLOW-UP — sem prazo de replay inventado, só título e link reais');
checa('sem título → null', montarFollowup({ titulo: '', link: 'https://x' }) === null);
checa('com título e link → não promete prazo nenhum (sem a palavra "até")',
  (() => { const r = montarFollowup({ titulo: 'Aula X', link: 'https://x' }); return r && !r.includes(' até '); })());

console.log('\nDISPATCHER — tipo desconhecido não quebra, devolve null');
checa('tipo inexistente → null', montarMensagemGrupo('tipo-que-nao-existe', {}) === null);
checa('dispatcher chega no formatador certo (convite)',
  montarMensagemGrupo('convite', { titulo: 'X', quando: 'hoje, às 19h', link: 'https://x' })?.includes('X'));

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok}/${ok + falhas} asserções`);
if (ok + falhas < 18) {
  console.error('TESTE INVÁLIDO: rodou menos asserções do que este arquivo declara.');
  process.exit(2);
}
process.exit(falhas === 0 ? 0 : 1);
