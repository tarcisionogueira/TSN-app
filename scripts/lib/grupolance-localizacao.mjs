/**
 * Endereço do GRUPOLANCE pela seção "Localização" da página do lote (08/10, #88).
 *
 * Recon na página viva (pg_net, 4 lotes): a descrição é texto de matrícula — pegar a 1ª rua dali
 * daria o CONFRONTANTE —, mas a página tem um bloco próprio:
 *   <h2 class="section-title mt-5">Localização</h2>
 *   <div class="mb-3"> Rua Brasília, Jardim Santa Eliza V, Barra Bonita, SP </div>
 * Formato: "[logradouro, ][bairro, ]Cidade, UF". Só com "Cidade, UF" não há rua — devolve null
 * (não inventa endereço). O 1º segmento só vira logradouro se começar por tipo de via.
 */
const RE_BLOCO = /Localiza[çc][ãa]o<\/h2>\s*<div class="mb-3">([^<]*)<\/div>/i;
const RE_VIA = /^(Rua|R\.|Avenida|Av\.|Rodovia|Rod\.|Estrada|Travessa|Alameda|Praça|Acesso|Via|Largo|Servidão|Linha|Ladeira|Beco|Viela|Vila|Quadra|Loteamento|Condom[íi]nio|Fazenda|S[íi]tio|Ch[áa]cara)\b/i;

const limpa = (s) => String(s || '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export function localizacaoGrupoLance(html) {
  const m = String(html || '').match(RE_BLOCO);
  if (!m) return null;
  const partes = limpa(m[1]).split(',').map(limpa).filter(Boolean);
  // Último = UF, penúltimo = cidade. Sem pelo menos um segmento antes deles, não há rua.
  if (partes.length < 3 || !/^[A-Z]{2}$/.test(partes[partes.length - 1])) return null;
  const antes = partes.slice(0, -2);
  if (!RE_VIA.test(antes[0])) return null;
  // "Rua X, 233, Ed. Y, Apto 73, Enseada": número e complemento são do ENDEREÇO; o bairro é o último
  // segmento — e só existe se esse último não for o próprio número (seco de 08/10: "233, Vila…").
  const ehNumero = (t) => /^(\d+[A-Za-z]?|s\/?n)$/i.test(t);
  let bairro = '';
  let resto = antes.slice(1);
  if (resto.length && !ehNumero(resto[resto.length - 1])) { bairro = resto[resto.length - 1]; resto = resto.slice(0, -1); }
  return { endereco: [antes[0], ...resto].join(', ').slice(0, 150), bairro: bairro.slice(0, 80) };
}
