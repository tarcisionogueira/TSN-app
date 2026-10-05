// LOTE MANUAL (05/10, achado do dono: "não leu os documentos e está abrindo para preenchimento manual").
// Lote incluído à mão não tem linha em `imoveis_leilao` — os arquivos não têm onde morar (`imovel_anexos`
// tem FK para lá). O que o relatório precisa é o TEXTO lido de cada arquivo: ele fica no `inputs` da
// própria análise (`docsManuais`), e é dele que a regeração (cron ou reabertura) relê. Mesma composição
// da tela (Analise.jsx · recomporDocsManuais): edital antes dos complementares.
export const ID_ACERVO_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehLoteManual = (id) => !!id && !ID_ACERVO_RE.test(String(id));
const MAX_TEXTO = 60000;

// Só o que serve à análise, com teto — nada de arquivo, nada de campo desconhecido.
export function docsManuaisSaneados(lista) {
  if (!Array.isArray(lista)) return [];
  return lista.slice(0, 12).filter((x) => x && (x.texto || x.ext)).map((x) => ({
    nome: String(x.nome || 'documento').slice(0, 160),
    tipo: ['edital', 'matricula', 'outro'].includes(x.tipo) ? x.tipo : 'outro',
    texto: String(x.texto || '').slice(0, MAX_TEXTO),
    ext: x.ext && typeof x.ext === 'object' ? x.ext : null,
    aviso: x.aviso ? String(x.aviso).slice(0, 200) : null,
  }));
}

export function textosDosDocsManuais(lista) {
  const docs = docsManuaisSaneados(lista);
  const bloco = (tipos, rot) => docs.filter((x) => tipos.includes(x.tipo) && x.texto)
    .map((x) => `=== ${rot}: ${x.nome} ===\n${x.texto}`).join('\n\n');
  return {
    edital: [bloco(['edital'], 'EDITAL'), bloco(['outro'], 'DOCUMENTO COMPLEMENTAR')].filter(Boolean).join('\n\n'),
    matricula: bloco(['matricula'], 'MATRÍCULA'),
  };
}
