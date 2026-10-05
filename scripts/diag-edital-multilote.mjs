/**
 * Diagnóstico (#50, 05/10): por que um edital de VÁRIOS lotes não foi reconhecido como tal?
 * Lê o edital com as MESMAS funções de produção e imprime: ehDocMultiLote, as marcações de lote
 * achadas e trechos em volta de "lote". Não grava nada. Env: URLS (separadas por espaço).
 */
import { lerTexto, ehDocMultiLote, isolarBlocoDoLote } from '../api/_edital-extrato.js';

for (const url of String(process.env.URLS || '').split(/\s+/).filter(Boolean)) {
  const t = await lerTexto(url, Date.now() + 60000);
  console.log(`\n===== ${url}\ntexto: ${t ? t.length : 'NULO'} chars · ehDocMultiLote=${t ? ehDocMultiLote(t) : '-'}`);
  if (!t) continue;
  const marcas = [...t.matchAll(/\b(lotes?|im[oó]ve(?:l|is)|item|bem)\s*(?:n[ºo°.]?\s*)?:?\s*\d{1,3}\b.{0,40}/gi)].slice(0, 25).map((m) => JSON.stringify(m[0]));
  console.log('marcas:', marcas.join('\n  '));
  console.log('isolar (sem valores):', isolarBlocoDoLote(t, {}) ? 'isolou' : 'nulo');
  console.log('--- início ---\n' + t.slice(0, 2500));
}
