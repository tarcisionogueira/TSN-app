/**
 * Ficha do lote do LEILÃO VIP a partir do innerText da página do anúncio (#141, 07/10).
 *
 * Medido na página viva (recon-vip-descricao.mjs, 3 lotes): o extrator genérico
 * `extrairDescricaoDoCorpo` devolve NULL nos três, e a página tem um painel "Descrição" com o
 * que o relatório mais precisa — endereço com CEP, matrícula, "Ocupado", débitos de IPTU e
 * condomínio por conta do comprador, penhoras. Era por isso que 0 de 144 lotes VIP ativos
 * tinham descrição: o texto existia, quem lia não o achava.
 *
 * O painel tem âncoras fixas no innerText:
 *   …"Situação\nOcupado"…"Descrição\nEndereço: <logradouro>\nCidade: X Estado: UF CEP: 00000-000\n
 *   [Processo: …\n]Leiloeiro: …\n<texto do lote>"… até "Notas" / "ATENÇÃO!" / "Navegue Pelo Site".
 * Só "Descrição" SEGUIDA de "Endereço:" abre o painel — a palavra também aparece sozinha na
 * lista de abas e de arquivos, e ancorar só nela pegaria o menu.
 */
const FIM_PAINEL = /\n\s*(?:Notas|ATEN[ÇC][ÃA]O!|Navegue Pelo Site|Nossa Newsletter|Lotes? (?:relacionados|semelhantes))\s*\n/i;

export function fichaVip(innerText) {
  const t = String(innerText || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const out = { descricao: null, endereco: null, cep: null, ocupacao: null };

  const ini = t.search(/\nDescri[çc][ãa]o\s*\n\s*Endere[çc]o:/i);
  if (ini >= 0) {
    let painel = t.slice(ini).replace(/^\s*\nDescri[çc][ãa]o\s*\n/i, '');
    const fim = painel.search(FIM_PAINEL);
    if (fim > 0) painel = painel.slice(0, fim);
    painel = painel.replace(/\n{3,}/g, '\n\n').trim();
    if (painel.length >= 60) out.descricao = painel.slice(0, 8000);

    const me = painel.match(/^Endere[çc]o:\s*(.+)$/im);
    if (me) out.endereco = me[1].trim().slice(0, 300) || null;
    const mc = painel.match(/\bCEP:\s*(\d{5})-?(\d{3})\b/i);
    // 8 DÍGITOS, sem hífen: a coluna é varchar(8) e os 3.683 CEPs do acervo estão assim. Com o
    // hífen (9 caracteres), a 1ª coleta real de 07/10 teve o lote INTEIRO do VIP recusado.
    if (mc) out.cep = `${mc[1]}${mc[2]}`;
  }

  // "Situação\nOcupado" no bloco de detalhes (fora do painel). Só os dois valores que o acervo
  // usa; qualquer outro ("Não informado") fica nulo — ausência honesta, não palpite.
  const ms = t.match(/\nSitua[çc][ãa]o\s*\n\s*(Ocupado|Desocupado)\s*\n/i);
  if (ms) out.ocupacao = /^des/i.test(ms[1]) ? 'Desocupado' : 'Ocupado';
  return out;
}
