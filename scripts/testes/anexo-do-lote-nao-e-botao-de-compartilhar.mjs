/**
 * npm run testar:anexo-lixo — o que entra como "documento do lote" tem de ser documento do lote.
 *
 * Print do dono (10/09), lote 97989/210252 da LJUD (galpão em ruína, Feira de Santana/BA): a
 * ficha mostrava como anexo o "Relatório de Transparência e Igualdade Salarial de Mulheres e
 * Homens" do Ministério do Trabalho — documento institucional do RODAPÉ do leiloeiro, que toda
 * empresa com 100+ empregados publica. E, ao lado dele, um anexo cuja URL tem 1.728 caracteres:
 * a DESCRIÇÃO INTEIRA do imóvel colada como caminho.
 *
 * As duas escaparam por motivos DIFERENTES, e é por isso que as duas estão aqui:
 *
 *  (a) O filtro institucional já existia — nasceu quando o mesmo relatório vazou do SUPERBID
 *      para centenas de lotes — mas casava "igualdade salarial" GRUDADO. Na LJUD a pasta é
 *      `relatorio-diferencial-salarial` e o arquivo `Relatório+de+Igualdade+01º+ciclo`: as
 *      palavras existem, e não são vizinhas. Filtro escrito para UM leiloeiro, furado no outro.
 *
 *  (b) A URL forjada a partir da descrição passou pelo portão final por PALAVRA-CHAVE: a
 *      descrição diz "matrícula nº 18.486", `RE_MATRICULA` casou, e o lixo entrou vestido de
 *      matrícula. A defesa nova não depende de qual palavra o texto contém — nome de ARQUIVO
 *      não é PROSA: caminho decodificado longo e cheio de espaços é frase, não arquivo.
 *
 * O mesmo padrão apareceu em 3 lotes da SUPORTE (href do botão "compartilhar no Twitter", cujo
 * `?text=` carrega a descrição) e em 2 da SUPERBID ("Confira a oferta: …").
 *
 * A metade de baixo do teste é a que importa mais: nenhum documento de verdade pode cair junto.
 */
import { ehDocumento, ehDocInstitucional } from '../../api/_doc-scan.js';
import { readFileSync } from 'node:fs';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};
const BASE = 'https://www.leiloesjudiciais.com.br/lote/97989/210252';
const recusa = (nome, url, label = '') => checa(nome, ehDocumento(url, label, BASE) === false, 'ACEITO — deveria recusar');
const aceita = (nome, url, label = '') => checa(nome, ehDocumento(url, label, BASE) === true, 'RECUSADO — deveria aceitar');

console.log('\nO LIXO DO PRINT (URLs reais, copiadas do banco)');
recusa('relatório de igualdade salarial da LJUD — palavras NÃO vizinhas',
  'https://906de634c48fb7d34136160b4c353ae4.s3.sa-east-1.amazonaws.com/public/leiloesjudiciais/relatorio-diferencial-salarial/Relat%C3%B3rio+de+Igualdade+01%C2%BA+ciclo+de+2026.pdf', 'Primeiro semestre de 2026');
recusa('a descrição do lote virada em URL (1.728 caracteres, cita "matrícula nº")',
  'https://www.leiloesjudiciais.com.br/lote/97989/Terreno%20c/%206.335,59m%C2%B2%20-%20Galp%C3%A3o%20em%20ru%C3%ADna%20-Feira%20de%20Santana/BA%20-%20Um%20galp%C3%A3o%20industrial%20com%20%C3%A1rea%20constru%C3%ADda%20de%202.500,00m%C2%B2,%20sem%20divis%C3%A3o,%20no%20centro%20Industrial%20do%20Suba%C3%A9,%20matr%C3%ADcula%20n%C2%BA%2018.486',
  'Obs.: 1. O galpão descrito na certidão de matrícula');
recusa('botão de compartilhar no Twitter (SUPORTE, 3 lotes)',
  'https://twitter.com/intent/tweet?text=Natureza:%20Urbano%20/%20Tipo%20de%20im%C3%B3vel:%20Casa%20/%20Matr%C3%ADcula:%206');
recusa('texto de compartilhamento da SUPERBID (2 lotes)',
  'https://www.superbid.net/oferta/Confira%20a%20oferta:%20Ch%C3%A1cara%20de%20alto%20padr%C3%A3o%20com%205%20su%C3%ADtes%20e%20matr%C3%ADcula%2012345%20no%20munic%C3%ADpio%20de%20Atibaia%20SP%20por%20apenas%20hoje');

console.log('\nAS VARIAÇÕES DO MESMO DOCUMENTO INSTITUCIONAL');
for (const t of [
  'relatorio-diferencial-salarial/Relatorio de Igualdade 2026.pdf',
  'transparencia-e-igualdade-salarial.pdf',
  'igualdade_salarial_2026.pdf',
  'relatorio-de-transparencia-salarial.pdf',
  'politica-de-privacidade.pdf',
]) checa(`institucional reconhecido: ${t.slice(0, 44)}`, ehDocInstitucional(t));
checa('e um EDITAL não é confundido com institucional', !ehDocInstitucional('edital-de-leilao-2a-praca.pdf'));
checa('nem uma matrícula', !ehDocInstitucional('matricula-18486.pdf'));

console.log('\nO QUE PRECISA CONTINUAR PASSANDO — é aqui que um filtro exagerado apareceria');
aceita('matrícula real da LJUD (S3, nome só numérico)',
  'https://s3-sa-east-1.amazonaws.com/906de634c48fb7d34136160b4c353ae4/public/anexo/4165681786458307.pdf', 'MATRÍCULA');
aceita('edital real da LJUD',
  'https://s3-sa-east-1.amazonaws.com/906de634c48fb7d34136160b4c353ae4/public/anexo/4165671786458292.pdf', 'EDITAL');
aceita('edital com nome longo, acentos e espaços — prosa curta ainda é nome de arquivo',
  'https://s3.us-east-2.amazonaws.com/alfa/editais/Edital%20de%20Leil%C3%A3o%20-%202%C2%AA%20Pra%C3%A7a%20-%20Comarca%20de%20S%C3%A3o%20Paulo.pdf', 'Edital');
aceita('matrícula servida por endpoint de API, SEM extensão',
  'https://www.pestana.com.br/lotes/424396/matricula/6863598', 'Matrícula');
aceita('laudo/matrícula da MEGA', 'https://cdn1.megaleiloes.com.br/batches/128827/megaleiloes_matricula_X128827_260831-103518.pdf', 'Matrícula');
aceita('URL assinada e longuíssima (token), sem espaços — não é prosa',
  'https://documentacao.portalzuk.com.br/I37251lote002edital2.pdf?Expires=1794235331&Signature=xcOEnN95bXTVzHR0pM45P78VevO9aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcdefghijklmnopqrstuvwxyz&Key-Pair-Id=APKAJ', 'Edital');

console.log('\nO CONSERTO PRECISA ALCANÇAR O PASSADO');
{
  // A união de anexos do `enriquecer-lote` preservava TUDO o que já estava gravado sem
  // reexaminar — então lixo que entrou por um filtro furado ficava imune a qualquer conserto
  // posterior: o scan novo era UNIDO ao lixo velho. Era por isso que 161 anexos-lixo em 67
  // lotes seguiam na ficha do cliente mesmo depois de o filtro ser corrigido.
  const src = readFileSync(new URL('../../api/enriquecer-lote.js', import.meta.url), 'utf8');
  checa('enriquecer-lote importa o portão', /ehDocumento[^;]*from '\.\/_doc-scan\.js'/.test(src));
  checa('e reexamina o que JÁ estava gravado antes de preservar',
    /for \(const a of atuais\)[\s\S]{0,320}?ehDocumento\(a\?\.url/.test(src));
}

console.log(`\n${falhas ? '✗' : '✓'} ${ok} passaram, ${falhas} falharam\n`);
process.exit(falhas ? 1 : 0);
