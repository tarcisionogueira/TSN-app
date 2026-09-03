/**
 * A EDIÇÃO DE UMA AULA RECORRENTE — a ÚNICA definição no sistema.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * A aula é semanal e o evento recorrente REUSA O MESMO `eventos_live.id`. Então "qual aula"
 * não é o id: é a DATA LOCAL da ocorrência — 2026-09-02, 2026-09-09. É essa unidade que
 * `live_convite_envio.edicao`, `live_reforco_envio.edicao`, `whatsapp_disparo_log.edicao` e
 * (desde 03/09) `live_inscricoes.edicao` e `live_lembretes.edicao` guardam.
 *
 * POR QUE UM ARQUIVO SÓ PARA DUAS LINHAS. Porque a regra já existia em TRÊS cópias —
 * `edicaoDe` em `_convite-live.js`, `diaNoFuso` em `admin-whatsapp-fila.js`, e o formato de
 * data solto em `live-inscrever.js` — e regra copiada só funciona enquanto as cópias forem
 * idênticas. Foi uma divergência exatamente desse tipo que produziu o defeito de 03/09: a
 * landing lia a data por `live_proxima` e a rota de inscrição lia a coluna crua, e o produto
 * passou quatro dias afirmando duas datas diferentes para a mesma aula.
 *
 * ⚠️ O FUSO NÃO É DETALHE. `data_hora` é `timestamptz`: a aula das 19h de Salvador é
 * 22:00Z. Formatar em UTC jogaria a edição para o dia SEGUINTE em qualquer aula depois das
 * 21h local — e a chave de dedup do dia errado libera um segundo envio para a mesma pessoa.
 * `America/Bahia` é o mesmo fuso que `live_proxima` usa no banco e que `LiveInscricao.jsx`
 * usa na tela.
 */

/** O fuso da AULA. Mesmo valor no SQL (`live_proxima`, `live_edicao_preencher`). */
export const FUSO_AULA = 'America/Bahia';

/**
 * A edição a que um instante pertence, no formato `YYYY-MM-DD` (o mesmo que o Postgres
 * aceita em `date`). `en-CA` é escolhido por produzir exatamente esse formato — não é
 * preferência de idioma, é o formato ISO saindo de um formatador de local.
 *
 * Recebe a data da OCORRÊNCIA (o que `live_proxima` devolve), nunca `eventos_live.data_hora`
 * cru: a coluna guarda a ocorrência anterior até `live_rolar_recorrentes()` avançá-la.
 */
export const edicaoDe = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: FUSO_AULA });
