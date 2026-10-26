/**
 * ACENTO PERDIDO NA VIA BANCO (26/10). O pg_net guarda a resposta como TEXTO UTF-8: página servida em ISO-8859-1
 * (back-office "Gestão de Leilões": Fidalgo, Granado, Lance no Leilão…) chega com cada letra acentuada trocada
 * por U+FFFD — "IM�VEL: Matr�cula … S�o Paulo/SP". O byte original não existe mais; o que dá para fazer é
 * reconstruir a palavra pelo ESQUELETO (a palavra com cada acentuada trocada por U+FFFD), num léxico tirado do
 * PRÓPRIO acervo (palavras acentuadas mais frequentes de imoveis_leilao, medido em 26/10), e por regras de
 * sufixo que não têm ambiguidade em português ("…��o" → "…ção", "…�es" → "…ões").
 *
 * Contrato: texto sem U+FFFD sai IDÊNTICO; palavra que o léxico/as regras não resolvem fica como veio (com o
 * U+FFFD) — nunca chuta uma letra. Caixa preservada (MAIÚSCULA, Título, minúscula).
 */
const FFFD = '�';
// Ordem = frequência no acervo (a 1ª palavra de um esqueleto é a que vence).
const PALAVRAS = `área econômica imóvel nº leilão único matrícula são imóveis não até ofício prédio leilões cartório construída
condomínio construção inscrição descrição endereço há josé município localização informações avaliação débitos condições poderá
características execução está ocupação serviço estão edifício serão região mínimo padrão álvaro sérgio aprovação três desocupação
necessárias visitação fração paraná ribeirão edificação conservação serviços regularização edificações providências ação justiça joão
imobiliária suíte públicos áreas será dívida chácara galpão pública água balneário dormitórios dossiê vegetação praça órgãos júnior
juízo antônio documentação elétrica confrontações composição distância considerações caráter extensão deverá sebastião útil ônus
cristóvão através próximo cônjuge comércio ficarão cível coproprietário dispõe guarujá porém arrematação só adjudicação sítio
observações constituído jerônimo intimação êxito andré depósito código razão denominação pavimentação brasília edícula térreo caberá
às já goiás além restrições módulo número aço itanhaém tributários suítes dúvidas alienação imobiliário manutenção goiânia cerâmica
ausência possíveis contínua capitão guimarães existência itália espírito divisão construções delimitação agropecuária indisponível
portão perímetro necessário atenção fiduciária ângulo residência conceição técnica escritório débito gonçalo locação centímetros início
várzea meação situação república agência utilização estação iluminação distribuição iguaçu dimensões referência preferência circulação
saúde usuário ficará jacareí nºs ótima exercício histórico piauí máximo américa esperança belém público presença paraíso disponíveis
prestações construído identificação desistência médio possível inês irmãos jurídico relação construídas você aquisição também móveis
praças metrô circunscrição preservação cômodos ótimo autônoma responsável deságio prévia índice hidráulica águas espaço barracão
trâmite jundiaí independência parágrafo estância doação contém tributária galpões realização recepção única potável mairiporã certidão
preço último chácaras união matrículas niterói salão consultórios prévio posição nível maringá transcrição domínio observação rosário
florianópolis corrêa jaboatão imissão veículos poderão funcionários casarão proprietários atualização órgão atlântica análise vitória
araucária fácil automóveis prejuízo instalação móvel escritórios cabível onça mansão carapicuíba tubarão proprietário conveniência
sanitário gonçalves açude exigências hortolândia urbanística camaçari mongaguá peças luziânia resolução jurídica caução contrário mês
alumínio portões jacarepaguá tatuapé urgência operações criação conexão expansão período tributário mãe título tramandaí calçamento
após alvará quilômetros glória usucapião metálico automóvel força milhão chão petrópolis calçada próprio segurança averbação ônibus
demolição constituída averbações paraíba invasão decisão representação dependência pátio córrego araújo armários milhões terraços
disponível camboriú butantã pavimento alienações judiciário judiciária extrajudicial ação crédito econômico cível penhora comarca
`.split(/\s+/).filter(Boolean);

const esqueleto = (w) => w.replace(/[áàâãéêíóôõúüçºª]/g, FFFD);
const LEXICO = new Map();
for (const w of PALAVRAS) { const k = esqueleto(w); if (!LEXICO.has(k)) LEXICO.set(k, w); }

// Sufixos sem ambiguidade em português (aplicados só quando o léxico não resolveu).
const SUFIXOS = [
  [new RegExp(`${FFFD}${FFFD}o$`), 'ção'], [new RegExp(`${FFFD}${FFFD}es$`), 'ções'],
  [new RegExp(`([^${FFFD}])${FFFD}es$`), '$1ões'], [new RegExp(`([bcdfghjlmnprstvz])${FFFD}o$`), '$1ão'],
  [new RegExp(`${FFFD}ncia$`), 'ência'], [new RegExp(`${FFFD}rio$`), 'ário'], [new RegExp(`${FFFD}vel$`), 'ável'],
];

function comCaixa(orig, nova) {
  const letras = orig.replace(new RegExp(FFFD, 'g'), '');
  if (letras && letras === letras.toUpperCase() && letras !== letras.toLowerCase()) return nova.toUpperCase();
  if (/^[A-ZÀ-Ý]/.test(orig)) return nova.charAt(0).toUpperCase() + nova.slice(1);
  return nova;
}

export function repararLatin1Perdido(texto) {
  const s = String(texto ?? '');
  if (!s.includes(FFFD)) return s;
  return s
    // "1� Praça", "2� Vara" → ª; "19� pavimento", "11� Cartório" → º.
    .replace(new RegExp(`(\\d)${FFFD}(?=\\s*(?:pra[çc${FFFD}]a|vara|regi|zona|se[çc${FFFD}][ãa${FFFD}]o|turma|c[âa${FFFD}]mara))`, 'gi'), '$1ª')
    .replace(new RegExp(`(\\d)${FFFD}`, 'g'), '$1º')
    .replace(new RegExp(`[\\p{L}${FFFD}]*${FFFD}[\\p{L}${FFFD}]*`, 'gu'), (tok) => {
      const low = tok.toLowerCase();
      const lx = LEXICO.get(low);
      if (lx) return comCaixa(tok, lx);
      for (const [re, rep] of SUFIXOS) if (re.test(low)) { const nova = low.replace(re, rep); if (!nova.includes(FFFD)) return comCaixa(tok, nova); }
      return tok;
    });
}
