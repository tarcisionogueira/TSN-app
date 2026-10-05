/**
 * #50 (05/10): tira de `doc_fatos` a IDENTIDADE que não é do lote — o mesmo logradouro+bairro "do
 * documento" em lotes ativos de 3+ cidades da mesma fonte (endereço do leiloeiro no cabeçalho do
 * edital, ou de um lote de edital com vários bens). A ficha mostrava isso ao cliente como
 * "Endereço na documentação". Mesma régua da trava em `publicarDocFatos` (api/_edital-extrato.js).
 * EM SECO por padrão. IDENT_APLICAR=1 grava (o resto do doc_fatos fica intacto).
 */
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const APLICAR = process.env.IDENT_APLICAR === '1';
const lotes = [];
for (let de = 0; ; de += 1000) {
  const { data, error } = await sb.from('imoveis_leilao').select('id,fonte,cidade_norm,doc_fatos')
    .eq('ativo', true).not('doc_fatos->identidade->>logradouro', 'is', null).order('id').range(de, de + 999);
  if (error) { console.error('leitura:', error.message); process.exit(1); }
  lotes.push(...data);
  if (data.length < 1000) break;
}
const grupos = new Map();
for (const l of lotes) {
  const idt = l.doc_fatos?.identidade || {};
  const k = `${l.fonte}|${idt.logradouro}|${idt.bairro || ''}`;
  (grupos.get(k) || grupos.set(k, []).get(k)).push(l);
}
const alvo = [...grupos.entries()].filter(([, ls]) => new Set(ls.map((l) => l.cidade_norm)).size >= 3);
console.log(`${lotes.length} lotes com identidade · ${alvo.length} grupos contaminados · ${alvo.reduce((s, [, ls]) => s + ls.length, 0)} lotes · ${APLICAR ? 'APLICANDO' : 'EM SECO'}`);
for (const [k, ls] of alvo) console.log(`  ${k} → ${ls.length} lotes em ${new Set(ls.map((l) => l.cidade_norm)).size} cidades`);
let ok = 0, falhas = 0;
if (APLICAR) {
  for (const [, ls] of alvo) for (const l of ls) {
    const { identidade, ...resto } = l.doc_fatos; // eslint-disable-line no-unused-vars
    const { data, error } = await sb.from('imoveis_leilao').update({ doc_fatos: resto }).eq('id', l.id).select('id');
    if (error || !data?.length) { falhas++; console.error('falhou', l.id, error?.message || 'nenhuma linha'); } else ok++;
  }
}
console.log(`limpos ${ok}, falhas ${falhas}`);
if (falhas) process.exit(1);
