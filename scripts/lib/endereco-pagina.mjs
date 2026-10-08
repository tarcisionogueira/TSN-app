/**
 * Endereço lido de bloco PRÓPRIO da página do lote (08/10, #88) — nunca da descrição, que nessas
 * fontes é texto de matrícula (a 1ª rua achada ali seria o CONFRONTANTE). Recon na página viva.
 *
 * HASTAPUBLICA (e Valland, mesma plataforma): um script da página traz
 *   endereco=new Array("Rua Sergipe, 285 -  Parque Varotti -  - Santa Cruz das Palmeiras/SP - Brasil","0.00","0.00")
 *   = "{logradouro} - {bairro} - {complemento} - {Cidade}/{UF} - Brasil".
 * SOLEON (FERREIRALEIL e demais tenants): bloco "Localização do Imóvel" com
 *   <b>Endereço:</b> Avenida Picadilly - Alphaville - Lagoa dos Ingleses <br><b>Cidade:</b> Nova Lima / MG - <b>CEP:</b> 34018-004
 *   Sem rua, vem "- Area Rural De Santa Rita" (começa por hífen).
 * Devolve { endereco, bairro, cep? } ou null. Só cidade/zona rural não vira endereço.
 */
const limpa = (s) => String(s || '')
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ').trim();

export function enderecoHastaPublica(html) {
  const m = String(html || '').match(/endereco\s*=\s*new Array\(\s*"([^"]*)"/);
  if (!m) return null;
  const partes = m[1].split(/\s-\s/).map(limpa);
  if (partes.length && /^brasil$/i.test(partes[partes.length - 1])) partes.pop();
  if (partes.length && /\/[A-Z]{2}$/.test(partes[partes.length - 1])) partes.pop(); // Cidade/UF
  const campos = partes.filter(Boolean);
  if (!campos.length || !/[A-Za-zÀ-ÿ]{3}/.test(campos[0])) return null;
  // Dois campos = logradouro + bairro (o caso comum). Mais que isso, o próprio logradouro tem " - "
  // ("Quadra SCLN 204 - Bloco D - Loja 55 – ASA NORTE"): não dá para saber onde o bairro começa,
  // então vai tudo como endereço e o bairro fica vazio — melhor que um bairro errado.
  if (campos.length === 2) return { endereco: campos[0].slice(0, 150), bairro: campos[1].slice(0, 80) };
  return { endereco: campos.join(' - ').slice(0, 150), bairro: '' };
}

export function enderecoSoleon(html) {
  const t = String(html || '');
  const i = t.search(/Localiza[çc][ãa]o do Im[óo]vel/i);
  if (i < 0) return null;
  const bloco = t.slice(i, i + 1500);
  const end = bloco.match(/<b>\s*Endere[çc]o:\s*<\/b>([^<]*)<br/i);
  const cep = (bloco.match(/CEP:\s*<\/b>\s*(\d{5}-?\d{3})/i) || [])[1] || null;
  const txt = limpa(end && end[1]);
  if (!txt || txt.startsWith('-')) return cep ? { endereco: '', bairro: limpa(txt.replace(/^-\s*/, '')).slice(0, 80), cep } : null;
  const [logradouro, ...resto] = txt.split(/\s-\s/).map(limpa).filter(Boolean);
  if (!logradouro || !/[A-Za-zÀ-ÿ]{3}/.test(logradouro)) return null;
  // "A. Rural - Área Rural De Igarassu": zona rural no lugar da rua não é endereço.
  if (/^(a\.?\s*rural|[áa]rea\s+rural|zona\s+rural)\b/i.test(logradouro)) return cep ? { endereco: '', bairro: resto.join(' - ').slice(0, 80), cep } : null;
  return { endereco: logradouro.slice(0, 150), bairro: resto.join(' - ').slice(0, 80), ...(cep ? { cep } : {}) };
}
