// Nº da MATRÍCULA lido do texto do lote (11/10, #196).
// O regex antigo pegava o 1º número depois de "matrícula" na página inteira — e a 1ª ocorrência
// costuma ser o RÓTULO do documento ("Matrícula atualizada em 22/10/2020"): 51 lotes da CALIL
// gravaram uma DATA como matrícula com "Matrícula nº 15603" logo abaixo na descrição. Matrícula com
// cara de data quebra a dedup por bem (gêmeos, cópia COMPREI) e o pedido de certidão ao cartório.
// Regras: data (dd/mm/aaaa) nunca é matrícula; ano solto (19xx/20xx) só vale quando vem colado ao
// rótulo ("Matrícula nº 2026" existe) — com palavra no meio ("matrícula atualizada em 2026") é data.
const RE = /matr[íi]cula(s)?([^\d]{0,20}?)(\d[\d.\-/]*\d|\d)/gi;
const ROTULO_LIMPO = /^[\s:.\-–]*(?:(?:imobili[áa]ria|do\s+im[óo]vel)\s*)?(?:n[º°o.]*|n[úu]mero|sob\s+(?:o\s+)?n[º°o.]*)?[\s:.\-–]*$/i;

export function matriculaDoTexto(...textos) {
  for (const t of textos) {
    for (const m of String(t || '').matchAll(RE)) {
      const v = m[3], gap = m[2];
      if (/^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/.test(v)) continue;          // data
      if (/^\d{1,2}[/.\-]\d{4}$/.test(v)) continue;                         // mês/ano
      if (/^(19|20)\d{2}$/.test(v) && !ROTULO_LIMPO.test(gap)) continue;    // "atualizada em 2026"
      return v.replace(/[.\-/]+$/, '');
    }
  }
  return null;
}
