// DESCRIÇÃO DO LEILOEIRO ORGANIZADA (10/10, pedido do dono: "não ficar amontoada a informação").
//
// O leiloeiro manda um bloco corrido: ficha (Marca: … Modelo: … Placa: …), checklist de acessórios
// ("- AIR-BAG : Sim - ABS : Não"), observações separadas por "/" e o texto jurídico, tudo colado — e o
// coletor ainda pendura no fim "<nº> <leiloeiro> — <título>". Esta função quebra isso em BLOCOS, sem
// inventar nada: todo texto que entra sai em algum bloco (nada é descartado, exceto o resumo
// repetido do fim). Descrição de texto livre (sem ficha) vira só parágrafos.
//
// Blocos: { tipo: 'intro', texto } · { tipo: 'campos', itens: [[rotulo, valor]] } ·
//         { tipo: 'checklist', tem: [], naoTem: [] } · { tipo: 'lista', titulo, itens } ·
//         { tipo: 'paragrafos', itens: [] }
// Teste: scripts/testes/descricao-organizada.mjs (npm run testar:descricao-organizada).

// Rótulos que o leiloeiro usa como "Campo:" — lista FECHADA de propósito: rótulo genérico
// ("qualquer Coisa:") quebraria frases ("O comprador declara: …") em campos falsos.
const ROTULOS = [
  // veículo
  'Marca', 'Modelo', 'Ano Fab/Modelo', 'Ano Fabricação/Modelo', 'Ano/Modelo', 'Ano', 'Placa', 'Quilometragem acima de',
  'Quilometragem', 'KM', 'Cor', 'Combustível', 'Chassi', 'Renavam', 'Nº de Portas', 'N° de Portas', 'Portas',
  'Ar condicionado', 'Câmbio', 'Motor', 'Direção', 'Chave', 'Pátio', 'Localização', 'Situação', 'Débitos em aberto',
  'Débitos', 'Observações', 'Observação', 'Obs', 'Categoria', 'Espécie', 'Tipo',
  // imóvel
  'Matrícula', 'Cartório', 'Inscrição Imobiliária', 'Inscrição Municipal', 'Inscrição', 'Área Total', 'Área Privativa',
  'Área Construída', 'Área Útil', 'Área do Terreno', 'Área', 'Endereço', 'Ocupação', 'Condomínio', 'IPTU', 'Comarca',
  'Processo', 'Vara', 'Exequente', 'Executado', 'Avaliação', 'Lance Mínimo', 'Descrição', 'Cidade',
  'Inscrição da Prefeitura', 'Inscrição na Prefeitura', 'Cadastro Municipal', 'Cadastro Imobiliário', 'Tipo do Imóvel',
  'Status da Ocupação', 'Aceita Visitação', 'Área Comum', 'Vagas de garagem', 'IPTU Anual', 'Cartório de Registro',
  'Matrícula(s)', 'Área(s)', 'Dossiê', 'Bem', 'Bens', 'Bem(ns)', 'Ônus', 'Valor da avaliação', 'Local para vistoria',
  'Local para Visitação', 'Localização do Bem', 'Depositário', 'Vistoria', 'Incremento', 'Comissão do Leiloeiro',
  'Benfeitorias', 'Características',
];
// Cabeçalhos de seção que vêm SEM dois-pontos e grudam no fim do valor anterior.
const CABECALHOS = ['Condições Gerais', 'Acessórios', 'Opcionais', 'Itens'];
// Campos cujo valor é texto/lista e pode ser longo (os demais são curtos: placa, cor, ano…).
const LONGOS = new Set(['observações', 'observação', 'obs', 'descrição', 'localização', 'endereço', 'bem', 'bens', 'bem(ns)',
  'ônus', 'benfeitorias', 'características', 'local para vistoria', 'local para visitação', 'localização do bem', 'avaliação']);
// Valor de campo longo não cabe numa célula de ficha: vira parágrafo com o rótulo na frente.
const MAX_CELULA = 140;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const RE_ROTULO = new RegExp(`(^|[\\s.;,])(${[...ROTULOS].sort((a, b) => b.length - a.length).map(esc).join('|')})\\s*:`, 'gi');
const RE_ROTULO_SOLTO = new RegExp(`\\s(${['Placa', 'Chassi', 'Renavam', 'Cor', 'Combustível', 'Motor', 'Câmbio', 'Quilometragem', 'Matrícula', 'Cartório'].map(esc).join('|')})\\s+(\\S.*)$`, 'i');
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const ehRotulo = (v) => ROTULOS.concat(CABECALHOS).some((r) => r.toLowerCase() === v.toLowerCase());

// TEXTO EM CAIXA ALTA → frase normal (só quando é quase tudo maiúsculo; sigla curta fica).
export function suavizarCaixaAlta(t, minimo = 12) {
  const letras = t.replace(/[^A-Za-zÀ-ú]/g, '');
  if (letras.length < minimo || /^[A-ZÀ-Ý0-9-]{1,4}$/.test(t.trim())) return t; // sigla (ABS, GNV, IPVA) fica
  const maius = letras.replace(/[^A-ZÀ-Ý]/g, '').length;
  if (maius / letras.length < 0.8) return t;
  const baixo = t.toLowerCase();
  return baixo.charAt(0).toUpperCase() + baixo.slice(1);
}

// "… 202602636 Cremer — FIAT FIORINO HD WK E, 2018/2018, …" no fim: o coletor repete o título.
function tirarResumoRepetido(s) {
  const i = s.lastIndexOf(' — ');
  if (i < 0) return s;
  const cauda = norm(s.slice(i + 3)).replace(/[,.\s]+$/, '');
  if (cauda.length < 10 || !s.slice(0, 80).toLowerCase().startsWith(cauda.slice(0, 20).toLowerCase())) return s;
  // Antes do " — " vem "<número> <leiloeiro>": corta desde o último fim de frase/valor.
  const antes = s.slice(0, i);
  const m = antes.match(/^(.*?)(\s+\d{5,}\s+[^\s.]{2,40})$/);
  return norm(m ? m[1] : antes);
}

// Fatia valor de campo CURTO que engoliu o texto seguinte: "Nada consta Sujeito a alterações…" →
// valor "Nada consta" + resto. Corte onde uma palavra minúscula é seguida de outra Capitalizada.
function cortarValorCurto(v) {
  if (v.length <= 60) return [v, ''];
  const m = v.match(/^(.{2,60}?[a-zà-ú0-9)])\s+([A-ZÀ-Ý][a-zà-ú].*)$/);
  return m ? [m[1], m[2]] : [v, ''];
}

const INICIOS_CLAUSULA = 'Será de responsabilidade|Sujeito a|Além das|O comprador|A venda|O arrematante|Os débitos|Débitos em aberto';
const RE_CLAUSULA = new RegExp(`^(?:${INICIOS_CLAUSULA})\\b`);
function frases(t) {
  const s = norm(t);
  if (!s) return [];
  // Fim de frase normal, mais os começos típicos de cláusula que vêm sem ponto antes.
  return s.split(new RegExp(`(?<=[.!?])\\s+(?=[A-ZÀ-Ý])|\\s+(?=(?:${INICIOS_CLAUSULA})\\b)`))
    .map(norm).filter(Boolean);
}
// Agrupa frases em parágrafos de até ~320 caracteres (parede de texto → blocos legíveis).
function paragrafos(t) {
  const out = []; let atual = '';
  for (const f of frases(t)) {
    if (atual && (atual.length + f.length > 320)) { out.push(atual); atual = f; } else atual = atual ? `${atual} ${f}` : f;
  }
  if (atual) out.push(atual);
  return out.map(suavizarCaixaAlta);
}

// Lixo de página que alguns coletores gravam (NORDESTE: payload RSC com HTML escapado).
export function limparTextoBruto(raw) {
  return String(raw || '')
    .replace(/\\u003c/gi, '<').replace(/\\u003e/gi, '>').replace(/\\u0026/gi, '&')
    .replace(/^\s*\(\[\d+,\s*"/, '').replace(/"\]\)\s*$/, '')
    .replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/\r/g, '');
}

export function organizarDescricao(raw) {
  const limpo = limparTextoBruto(raw);
  // O leiloeiro JÁ estruturou em linhas (marcadores, "OBS:", um ônus por linha)? Respeita: cada linha
  // vira um item, marcador vira lista. Só o texto corrido passa pelo desmonte da ficha abaixo.
  const linhas = limpo.split('\n').map(norm).filter(Boolean);
  if (linhas.length >= 3) {
    const itens = linhas.map((l) => {
      const m = l.match(/^(\s*)[*•\-–]\s+(.*)$/);
      return m ? { texto: suavizarCaixaAlta(m[2]), marcador: true } : { texto: suavizarCaixaAlta(l), marcador: false };
    });
    return [{ tipo: 'linhas', itens }];
  }
  let s = tirarResumoRepetido(norm(limpo));
  if (!s) return [];
  const blocos = [];
  const sobras = [];

  // 1) Checklist de acessórios: "- ITEM : Sim/Não" em sequência (3+ itens).
  // Separador é " - " (com espaço): hífen DENTRO do nome ("AIR-BAG") não quebra o item.
  const itensCk = [...s.matchAll(/(?:^|\s)-\s+((?:(?!\s-\s)[^:]){2,60}?)\s*:\s*(Sim|Não|Nao|N\/A)(?![a-zà-ú])/gi)];
  if (itensCk.length >= 3) {
    const ini = itensCk[0].index, fim = itensCk[itensCk.length - 1].index + itensCk[itensCk.length - 1][0].length;
    const tem = [], naoTem = [];
    for (const m of itensCk) (/^sim$/i.test(m[2]) ? tem : naoTem).push(suavizarCaixaAlta(norm(m[1]), 3).replace(/^./, (c) => c.toUpperCase()));
    const resto = s.slice(fim);
    s = `${s.slice(0, ini).replace(/\s*Acess[óo]rios\s*:?\s*$/i, '')} ${resto}`.trim();
    blocos.push({ tipo: 'checklist', tem, naoTem, _pos: ini });
  }

  // 2) Ficha "Campo: valor" (só com 3+ rótulos conhecidos — senão é texto livre).
  const marcas = [...s.matchAll(RE_ROTULO)].map((m) => ({ ini: m.index + m[1].length, fimRotulo: m.index + m[0].length, rotulo: m[2] }));
  if (marcas.length >= 3) {
    const intro = norm(s.slice(0, marcas[0].ini)).replace(/[,;:\s]+$/, '');
    if (intro) blocos.push({ tipo: 'intro', texto: intro, _pos: -1 });
    const campos = [];
    marcas.forEach((m, k) => {
      let v = norm(s.slice(m.fimRotulo, k + 1 < marcas.length ? marcas[k + 1].ini : s.length)).replace(/\s*[;,/]\s*$/, '').trim();
      for (const c of CABECALHOS) v = v.replace(new RegExp(`\\s*${esc(c)}\\s*:?\\s*$`, 'i'), '');
      if (!v || ehRotulo(v)) return;
      const chave = m.rotulo.toLowerCase();
      if (/^obs/.test(chave) && v.split('/').filter((x) => norm(x)).length >= 2) {
        // Observações em "A/ B/ C" → lista própria.
        const partes = v.split('/').map(norm).filter(Boolean);
        // O último item costuma engolir o texto seguinte (cláusula jurídica sem ponto antes).
        const ult = frases(partes.pop() || '');
        if (ult.length && !RE_CLAUSULA.test(ult[0])) partes.push(ult.shift());
        if (ult.length) sobras.push(ult.join(' '));
        blocos.push({ tipo: 'lista', titulo: 'Observações', itens: partes.map(suavizarCaixaAlta), _pos: m.ini });
        return;
      }
      if (LONGOS.has(chave) && v.length > MAX_CELULA) { sobras.push(`${m.rotulo.replace(/^./, (c) => c.toUpperCase())}: ${v}`); return; }
      if (!LONGOS.has(chave)) { const [curto, resto] = cortarValorCurto(v); v = curto; if (resto) sobras.push(resto); }
      // Rótulo conhecido SEM dois-pontos no meio do valor ("2018/2018 Placa FINAL 4") → campo próprio.
      const dentro = !LONGOS.has(chave) && v.match(RE_ROTULO_SOLTO);
      if (dentro && dentro.index > 0) {
        campos.push([m.rotulo.replace(/^./, (c) => c.toUpperCase()), norm(v.slice(0, dentro.index))]);
        campos.push([dentro[1].replace(/^./, (c) => c.toUpperCase()), norm(dentro[2])]);
        return;
      }
      // Valor da ficha fica como o leiloeiro escreveu (modelo, placa e marca têm caixa própria).
      campos.push([m.rotulo.replace(/^./, (c) => c.toUpperCase()), v]);
    });
    if (campos.length) blocos.push({ tipo: 'campos', itens: campos, _pos: marcas[0].ini });
  } else {
    sobras.unshift(s);
  }

  const texto = sobras.join(' ');
  const paras = paragrafos(texto);
  if (paras.length) blocos.push({ tipo: 'paragrafos', itens: paras, _pos: 1e9 });
  // Ordem de leitura: título, ficha, acessórios, observações, texto (jurídico por último).
  const ordem = { intro: 0, campos: 1, checklist: 2, lista: 3, paragrafos: 4 };
  return blocos.sort((a, b) => ordem[a.tipo] - ordem[b.tipo]).map(({ _pos, ...b }) => b);
}
