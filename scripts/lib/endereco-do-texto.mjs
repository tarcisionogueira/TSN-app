// Endereço do lote a partir do TEXTO de anúncio (título+descrição). Ver scripts/endereco-da-descricao.mjs.
//
// Por que não o extrator de matrícula (`extrairEnderecoMatricula`): ele exige "situado/localizado"
// antes do logradouro — texto de cartório. Anúncio diz "Terreno na Rua X, 120 – Bairro" e o 1º seco
// (29/09) achou 91 de 1.631. E o que achou vinha com cauda ("Rua João Pans em trecho plano e
// estruturado do condomínio"), frase comum ("avenida com pavimentação") ou cortado na abreviação
// ("Rua Dr"). Aqui o NOME é uma sequência de palavras Capitalizadas (ou em CAIXA ALTA), com
// conectivos e abreviações de título — a primeira palavra minúscula que não é conectivo encerra.
const TIPO = '(?:rua|avenida|av\\.|travessa|alameda|estrada|rodovia|pra[çc]a|largo|ladeira)';
const CONECTIVO = /^(de|da|do|das|dos|e|d'|del)$/i;
const ABREV = /^(dr|dra|prof|profa|cel|cap|ten|sgt|gen|mal|pe|sen|dep|des|eng|gov|pres|min|vig|sta|sto|s|são|n\.?\s*s(ra)?)\.?$/i;
const GENERICO = /^(?:(?:projetada|sem\s+(?:nome|denomina)|geral|particular|principal|interna|vicinal)\b|[A-Za-z](?:\s+[A-Za-z0-9]{1,2})?$)/i; // "Rua A", "Rua B 2" = sem nome
const CONFRONTACAO = /(confront|divis|fundos|lateral|lado\s+(direito|esquerdo)|esquina|limit|faz\s+frente\s+para\s+a?\s*$)/i;
// Palavra Capitalizada que NÃO é nome de rua: encerra o nome ("Rodovia SC-157 Inscrição…").
const PARADA = /^(inscri[çc][ãa]o|matr[íi]cula|lote|quadra|cep|bairro|setor|[áa]rea|terreno|im[óo]vel|cidade|munic[íi]pio|comarca|cart[óo]rio|registro|zona|loteamento|condom[íi]nio|residencial|jardim|vila|centro)$/i;
const RE_TIPO = new RegExp(`\\b(${TIPO})\\s+`, 'gi');

const norm = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// A partir de `pos` (logo após "Rua "), junta as palavras do nome.
function nomeApos(t, pos) {
  const palavras = [];
  const re = /\s*([A-Za-zÀ-ú0-9'’\-]+\.?)/y;
  re.lastIndex = pos;
  let m;
  while ((m = re.exec(t)) && palavras.length < 8) {
    const w = m[1];
    const limpa = w.replace(/\.$/, '');
    const maiuscula = /^[A-ZÀ-Ú0-9]/.test(w);
    // Conectivo pode abrir o nome ("Rua das Flores") ou ligar palavras ("Rua Edson de Lima").
    if (CONECTIVO.test(limpa)) { palavras.push(limpa); continue; }
    if (!maiuscula) break;
    if (PARADA.test(limpa) && palavras.some((p) => !CONECTIVO.test(p))) { re.lastIndex -= m[0].length; break; }
    // Número puro encerra o nome ("Avenida Brasil 300 m²", "Rua X 120"), salvo quando É o nome
    // ("Rua 15", "Rua 7 de Setembro").
    if (/^\d+$/.test(limpa) && palavras.some((p) => !CONECTIVO.test(p)) && !/^\s+de\s/i.test(t.slice(re.lastIndex, re.lastIndex + 5))) { re.lastIndex -= m[0].length; break; }
    palavras.push(w.endsWith('.') && ABREV.test(limpa) ? `${limpa}.` : limpa);
    // "." fora de abreviação encerra a frase; "," encerra o nome.
    if (w.endsWith('.') && !ABREV.test(limpa)) break;
    if (t[re.lastIndex] === ',' || t[re.lastIndex] === ';') break;
  }
  // Texto truncado ("Estrada do Po…"): última palavra de 1–2 letras não é nome.
  if (palavras.length > 1 && /^[A-Za-zÀ-ú]{1,2}$/.test(palavras[palavras.length - 1]) && !CONECTIVO.test(palavras[palavras.length - 1])) palavras.pop();
  while (palavras.length && CONECTIVO.test(palavras[palavras.length - 1])) palavras.pop();
  while (palavras.length && CONECTIVO.test(palavras[0]) && palavras.length === 1) palavras.pop();
  return { nome: palavras.join(' '), fim: re.lastIndex };
}

export function enderecoDoTexto(texto, cidade) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  const achados = [];
  for (const m of t.matchAll(RE_TIPO)) {
    const antes = t.slice(Math.max(0, m.index - 40), m.index);
    if (CONFRONTACAO.test(antes)) continue;                                   // rua vizinha, não a do lote
    if (/leiloeir|escrit[óo]rio|audit[óo]rio|\bsede\b/i.test(t.slice(Math.max(0, m.index - 120), m.index + 60))) return { motivo: 'endereco_do_leiloeiro' };
    const { nome, fim } = nomeApos(t, m.index + m[0].length);
    if (!nome || (nome.replace(/[^A-Za-zÀ-ú]/g, '').length < 3 && !/\d/.test(nome)) || GENERICO.test(nome)) continue;
    const tipo = m[1].replace(/^av\.$/i, 'Avenida');
    const num = (t.slice(fim, fim + 20).match(/^\s*,?\s*(?:n[º°o.]*\s*)?(\d{1,5})\b(?!\s*(?:m[²2]|ha|metros|%|\/))/i) || [])[1];
    achados.push({ endereco: `${tipo[0].toUpperCase()}${tipo.slice(1).toLowerCase()} ${nome}${num ? `, ${num}` : ''}`, chave: norm(nome) });
  }
  if (!achados.length) return { motivo: 'sem_logradouro' };
  if (new Set(achados.map((a) => a.chave)).size > 1) return { motivo: 'varios_logradouros' };
  // Município citado no texto tem de ser o do lote (senão é o fórum/cartório/outro imóvel).
  const mun = (t.match(/\bmunic[íi]pio\s+(?:e\s+comarca\s+)?de\s+([A-ZÀ-Ú][A-Za-zÀ-ú'’\- ]{2,40}?)(?=\s*[,;./-]|\s+comarca|$)/i) || [])[1];
  if (mun && cidade && norm(mun) !== norm(cidade)) return { motivo: 'outro_municipio' };
  const ceps = [...new Set([...t.matchAll(/\b(\d{5})-?(\d{3})\b/g)].map((m) => `${m[1]}${m[2]}`))];
  const melhor = achados.find((a) => /\d/.test(a.endereco)) || achados[0];
  return { endereco: melhor.endereco, cep: ceps.length === 1 ? ceps[0] : null };
}
