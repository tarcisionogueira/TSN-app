-- ═══════════════════════════════════════════════════════════════════════════════════════
-- BARRA DE EVOLUÇÃO NOS TRÊS RELATÓRIOS (13/08, pedido do dono)
--
-- PEDIDO: "ao gerar o relatório documental ele vai para uma tela à parte e não fica como
-- quando clico no mercadológico, na mesma tela e mostrando a evolução da elaboração do
-- relatório embaixo. Poderia organizar o fluxo para ser o mesmo nos 3 relatórios?"
--
-- O QUE FOI MEDIDO: não era escolha de design, era assimetria de implementação. Só
-- `analises_mercado` tinha a coluna `progresso`, e só `api/gerar-analise.js` emitia etapas
-- (7 pontos). O documental e o laudo não tinham NADA para mostrar no hub — por isso a tela
-- separada era o único lugar com um sinal de vida (um spinner).
--
-- ESTA MIGRAÇÃO dá às outras duas tabelas a mesma coluna, com o mesmo formato:
--   { "etapas": [ { "key": ..., "label": ..., "status": "pendente|gerando|concluido|pulado|erro",
--                   "n": <contagem opcional> } ],
--     "atualizadoEm": "<iso>" }
--
-- O front lê `entry.progresso.etapas` durante o polling e preenche a barra. O mesmo
-- componente serve os três — ver `src/pages/Analise.jsx`, onde o render deixou de ser
-- travado em `c.k==='mercado'` e passou a usar a entrada do próprio card.
--
-- É jsonb anulável e sem default: linha antiga fica com NULL e o front simplesmente não
-- desenha a barra, como já fazia para o mercadológico antes da primeira geração.
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════════════════

alter table public.analises_documental add column if not exists progresso jsonb;
alter table public.analises_laudo      add column if not exists progresso jsonb;
