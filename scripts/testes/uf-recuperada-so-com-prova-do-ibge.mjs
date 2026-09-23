/**
 * scripts/testes/uf-recuperada-so-com-prova-do-ibge.mjs — `inferirUF` recupera a UF perdida
 * na extração SÓ quando o par (UF, cidade) existe no IBGE, e nunca chuta.
 *
 * POR QUE EXISTE (23/09). O invariante `estado_fora_do_padrao` acusou 96 lotes ativos sem UF
 * (lote sem UF some de /leiloes). 50 eram da SUPERBID em modo loja — `product.location` vem
 * como objeto sem `state` — com a UF escrita no título de TODOS ("Campinas-SP"). Os casos
 * abaixo são títulos reais daquele dia. Os negativos importam tanto quanto: cidade ambígua
 * (Campo Grande é AL e MS) e texto sem localização têm de continuar SEM UF.
 */
import assert from 'node:assert/strict';
import { inferirUF } from '../lib/inferir-uf.mjs';

const casos = [
  // [entrada, uf esperada (null = não resolve), cidade preenchida esperada]
  [{ cidade: 'Campo Grande', titulo: 'Casa 204,29m² com Terreno 268,85m² | Campo Grande-MS | Núcleo Habitacional Buriti - 3 Dorm' }, 'MS'],
  [{ cidade: 'Rio De Janeiro', titulo: 'Apto 68m² c/ 1 Vaga | DESOCUPADO | Rio de Janeiro-RJ | Pechincha' }, 'RJ'],
  [{ cidade: 'São Paulo', titulo: 'Apto 72m² | São Paulo-SP | Ed. Carnaúba | Brás/Belenzinho' }, 'SP'],
  [{ cidade: '', titulo: 'Sala Comercial no "Edifício Honório Líbero" - Brás - São Paulo/SP (Sala n° 84)' }, 'SP', 'São Paulo'],
  [{ cidade: '', titulo: 'Leilão Judicial: Imóvel comercial. A.T. 160.765m² em São Manuel/SP' }, 'SP', 'São Manuel'],
  // cidade única no IBGE, sem UF no texto
  [{ cidade: 'Piracicaba', titulo: 'Apartamento em Piracicaba' }, 'SP'],
  // NEGATIVOS — não pode chutar
  [{ cidade: 'Campo Grande', titulo: 'Casa em Campo Grande' }, null],              // AL e MS
  [{ cidade: null, titulo: 'Imóvel Hasta Leilões 10730' }, null],
  [{ cidade: null, titulo: 'Area Rural Rodovia Ba 512' }, null],                    // "Ba" não é UF escrita como sufixo de cidade
];

let n = 0;
for (const [ent, uf, cidade] of casos) {
  const r = inferirUF(ent);
  assert.equal(r?.uf ?? null, uf, `${JSON.stringify(ent)} → ${JSON.stringify(r)}`);
  if (cidade) assert.equal(r.cidade, cidade, `cidade de ${ent.titulo}`);
  n++;
}
// Texto sobre OUTRA cidade não serve de prova: cai no fallback de cidade única (Campinas só SP)
assert.equal(inferirUF({ cidade: 'Campinas', titulo: 'Apto | Santos-RJ' })?.via, 'cidade_unica');
// UF que não é sigla brasileira nunca passa, mesmo com cara de "Cidade-XX"
assert.equal(inferirUF({ titulo: 'Depto | San Martín De Porres - PR' }), null);
console.log(`ok — ${n + 2} casos`);
