// Deixa a descrição do imóvel (vinda crua do scraper da Caixa) apresentável:
// remove áreas zeradas, coloca unidade m² e vírgula decimal, expande abreviações
// (qto(s)→quartos, a.serv→área de serviço, wc→banheiro…) e ajusta pontuação.
// É conservador: em descrições de texto livre (outros leiloeiros), só toca no que
// casa com padrões claros, então não estraga frases já escritas por humanos.

const num = (n) => String(n).replace('.', ',');

// Pluraliza "N base" (base no singular). suíte→suítes, quarto→quartos…
function plural(n, base) {
  const q = parseInt(n, 10) || 0;
  if (q <= 1) return `${n} ${base}`;
  const p = /[aeiouáéíóú]$/i.test(base) ? base + 's' : base + 's';
  return `${n} ${p}`;
}

export function formatarDescricaoImovel(raw) {
  if (!raw) return '';
  let s = ' ' + String(raw).replace(/\s+/g, ' ').trim() + ' ';

  // 1) Remove áreas ZERADAS (aceita "area"/"área", ponto/vírgula, com/sem tipo).
  s = s.replace(/\b0+[.,]0+\s+de\s+[aá]rea(\s+(total|privativa|[úu]til|constru[íi]da|do\s+terreno))?\s*[,;.]?/gi, ' ');

  // 2) Formata áreas com valor > 0: "52.61 de area privativa" → "área privativa de 52,61 m²".
  s = s.replace(/(\d+(?:[.,]\d+)?)\s+de\s+[aá]rea(?:\s+(total|privativa|[úu]til|constru[íi]da|do\s+terreno))?/gi,
    (_m, n, tipo) => {
      const t = (tipo || '').trim().toLowerCase();
      const label = t === 'do terreno' ? 'terreno' : t ? `área ${t}` : 'área';
      return `${label} de ${num(n)} m²`;
    });

  // 3) "N qto(s)" / "N sala(s)" / "N suíte(s)" / "N vaga(s)"… → plural correto.
  const baseDe = (w) => {
    const x = w.toLowerCase();
    if (/^q(uarto|to)$/.test(x)) return 'quarto';
    if (/^su[ií]te$/.test(x)) return 'suíte';
    if (/^sala$/.test(x)) return 'sala';
    if (/^vaga$/.test(x)) return 'vaga';
    if (/^dorm(it[óo]rio)?$/.test(x)) return 'dormitório';
    if (/^banheiro$/.test(x) || x === 'wc') return 'banheiro';
    return x;
  };
  s = s.replace(/(\d+)\s*(q(?:uarto|to)|su[ií]te|sala|vaga|dorm(?:it[óo]rio)?|banheiro|wc)\s*(?:\(s\)|s)?(?![a-zá-ú])/gi,
    (_m, n, w) => plural(n, baseDe(w)));

  // 4) Abreviações soltas (sem número). Word-boundary p/ não afetar texto livre.
  const abrev = [
    [/\ba\.?\s*serv(i[çc]o)?\b\.?/gi, 'área de serviço'],
    [/\b[áa]rea\s+de\s+servi[çc]o\b/gi, 'área de serviço'],
    [/\bwc\b/gi, 'banheiro'],
    [/\bcoz\.?\b/gi, 'cozinha'],
    [/\bdep\.?\b/gi, 'dependência'],
    [/\bchurr\.?\b/gi, 'churrasqueira'],
    [/\bgar\.?\b/gi, 'garagem'],
    [/\bqto\(s\)/gi, 'quartos'],
    [/\bsala\(s\)/gi, 'salas'],
  ];
  for (const [re, to] of abrev) s = s.replace(re, to);

  // 5) Limpa pontuação e espaços; capitaliza a 1ª letra; garante ponto final.
  s = s
    .replace(/\s*,\s*(?=,)/g, '')       // vírgulas duplicadas
    .replace(/\s+,/g, ',')
    .replace(/,\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;.]+|[\s,;]+$/g, '')
    .trim();
  if (!s) return '';
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (!/[.!?]$/.test(s)) s += '.';
  return s;
}
