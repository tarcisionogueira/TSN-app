/**
 * scripts/testes/certidao-indisponivel-nao-e-certidao-limpa.mjs — fonte fora do ar nunca vira
 * "sem apontamentos".
 *
 * POR QUE EXISTE (31/08). `consultarCertidoesFiscais` monta `alertas` só quando a fonte
 * RESPONDEU e disse irregular (`X.ok && X.regular === false`). Cada consulta devolve
 * `{ ok: false, indisponivel: true }` em timeout ou HTTP de erro — então **as três fontes fora
 * do ar produziam `alertas` vazio**, e o resumo saía "Certidões fiscais sem apontamentos
 * (Receita/PGFN/FGTS)". Silêncio de rede entregue como certidão negativa, com o nome das três
 * fontes ao lado para dar credibilidade.
 *
 * É a forma #1 do CLAUDE.md, e das piores instâncias possíveis: o destino da frase é
 * `NotaMetodologica.jsx:89`, que a imprime como "Certidões fiscais consultadas automaticamente
 * (Receita Federal, PGFN e FGTS): {resumo}" — afirmando uma consulta que não aconteceu, num
 * parecer jurídico que o cliente lê ANTES de dar lance.
 *
 * A asserção central deste arquivo não é o texto exato: é que **nenhum cenário com fonte muda
 * pode produzir uma frase que passe por certidão limpa**.
 */
import { consultarCertidoesFiscais } from '../../api/_certidoes-fontes.js';

// Substitui a rede: cada caso descreve o que as 3 fontes responderiam.
const LIMPA = { ok: true, regular: true, situacao: 'Sem débitos' };
const IRREGULAR = { ok: true, regular: false, situacao: 'Irregular', tipo: 'cpf' };
const MUDA = { ok: false, indisponivel: true, erro: 'Timeout' };

// Substitui a rede. CADA FONTE TEM SEU PRÓPRIO PROTOCOLO, e simular errado testa outra coisa:
// na Receita um 404 é FALHA (`!res.ok` → `{ok:false}`) e só um 200 com `situacao: 'Regular'` é
// limpo; na PGFN e no FGTS o 404 é justamente o "sem débitos". A 1ª versão deste teste tratou
// 404 como limpo nas três e reprovou o código correto — a forma #10 dentro do próprio teste.
function comFontes({ receita, pgfn, fgts }) {
  const resp = (body) => ({ ok: true, status: 200, json: async () => body });
  globalThis.fetch = async (url) => {
    const u = String(url);
    const alvo = u.includes('receitaws') ? receita : u.includes('pgfn') ? pgfn : fgts;
    if (alvo === MUDA) throw new Error('Timeout');
    if (u.includes('receitaws')) return resp({ situacao: alvo === LIMPA ? 'Regular' : 'Suspensa' });
    // PGFN e FGTS: 404 = sem débito.
    if (alvo === LIMPA) return { ok: false, status: 404 };
    return resp({ situacaoDevedorPgfn: 'IRREGULAR', regular: false, situacao: 'IRREGULAR' });
  };
}

const casos = [
  { oque: 'as 3 responderam e estão limpas → pode dizer "sem apontamentos"',
    fontes: { receita: LIMPA, pgfn: LIMPA, fgts: LIMPA }, conclusivo: true, podeParecerLimpo: true },
  { oque: 'as 3 MUDAS → jamais pode parecer limpo (o defeito de 31/08)',
    fontes: { receita: MUDA, pgfn: MUDA, fgts: MUDA }, conclusivo: false, podeParecerLimpo: false },
  { oque: '2 limpas e 1 muda → parcial, tem de ressalvar',
    fontes: { receita: LIMPA, pgfn: LIMPA, fgts: MUDA }, conclusivo: false, podeParecerLimpo: false },
  { oque: '1 limpa e 2 mudas → parcial',
    fontes: { receita: LIMPA, pgfn: MUDA, fgts: MUDA }, conclusivo: false, podeParecerLimpo: false },
  { oque: 'irregular de verdade continua alertando',
    fontes: { receita: LIMPA, pgfn: IRREGULAR, fgts: LIMPA }, conclusivo: true, podeParecerLimpo: false },
];

const CPF_VALIDO = '12345678901';
let mau = 0;

for (const c of casos) {
  comFontes(c.fontes);
  const r = await consultarCertidoesFiscais(CPF_VALIDO);
  const resumo = r?.resumo || '';
  // "Parece limpo" = afirma ausência de apontamento SEM ressalva de fonte não consultada.
  const pareceLimpo = /sem apontamentos/i.test(resumo)
    && !/NÃO consultadas|NENHUMA das 3|indispon/i.test(resumo);

  const okConclusivo = r?.conclusivo === c.conclusivo;
  const okAparencia = pareceLimpo === c.podeParecerLimpo;
  const ok = okConclusivo && okAparencia;
  if (!ok) mau++;
  console.log(`${ok ? '  ok  ' : '  FALHOU '} conclusivo=${r?.conclusivo} indisponiveis=[${(r?.indisponiveis || []).join(',')}] · ${c.oque}`);
  console.log(`         resumo: ${resumo.slice(0, 150)}`);
  if (!okAparencia) console.log(`         ⚠️ pareceLimpo=${pareceLimpo}, esperado ${c.podeParecerLimpo}`);
}

if (mau) {
  console.error(`\n❌ ${mau} caso(s) fora do esperado em consultarCertidoesFiscais.`);
  process.exit(1);
}
console.log(`\n✅ ${casos.length} casos: fonte indisponível nunca passa por certidão limpa.`);
