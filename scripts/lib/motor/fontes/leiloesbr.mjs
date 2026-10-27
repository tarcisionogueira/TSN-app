/**
 * FONTE (config) — plataforma LEILÕESBR (44 leiloeiros da junta, triagem 26/10). Parser em lib/leiloesbr-parse.mjs;
 * transporte em motor/fetch-leiloesbr.mjs. Plataforma de arte/antiguidades: o leitor mede, por catálogo ativo, peças
 * declaradas × classificadas por tipo e só aceita tipo de imóvel/veículo como candidato (hoje, zero em todos). Uma
 * `fonte` por site (LBR_<nome>): a falha de um não toca a medição dos outros.
 */
import { TENANTS, CATALOGO, extrairUrlsDeEvento, extrairUrlsDeLote, totalDoEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../leiloesbr-parse.mjs';
import { criarMotorLeiloesBr } from '../fetch-leiloesbr.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'leiloesbr',
  criarMotor: criarMotorLeiloesBr,
  catalogo: CATALOGO,
  // A lista pagina os FINALIZADOS com `?pag=N` — parâmetro que nenhuma página deste leitor usa; um nome que não existe
  // na página impede que o "teto de páginas" leia esse link como lista cortada.
  paginaParam: 'lbr_sem_paginacao',
  maxPages: 1,
  maxPagesEvento: 1,
  maxEventos: 40,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeEvento, extrairUrlsDeLote, totalDoEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'LeilõesBR (ASP/IIS, "Powered by LeilõesBR") — arte, antiguidades e colecionismo', acesso: 'fetch-direto (sem cabeçalho: IIS dá 400 a UA de navegador)', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/listacatalogo.asp (V7: HTML até "Leilões finalizados"; V8: listacatalogoData) → catalogo.asp?Num=N (V7: find-numb + "Escolha pelo Tipo"; V8: catalogo-tiposload.asp + catalogocontentload.asp?iscalc=1)',
    url_lote: '/peca.asp?Id=<id>', scraper: 'scraper-leiloesbr.mjs',
  },
};
