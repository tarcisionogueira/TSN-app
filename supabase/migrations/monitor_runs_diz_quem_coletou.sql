-- 29/08 — O RADAR PASSOU A TER DOIS CAMINHOS, E O LOG NÃO SABIA DIZER QUAL RODOU
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- A captura do DJEN saiu do Bright Data e foi para o runner RESIDENCIAL (decisão do dono,
-- 29/08: "vou rodar diariamente, migra o radar; caso fique 7 dias sem rodar no residencial,
-- pode rodar pelo Bright Data"). Os dois caminhos gravam em `monitor_runs` sob a MESMA
-- `fonte` — e isso é de propósito: o freio do caminho pago lê exatamente essa linha para
-- decidir se já há pull bem-sucedido recente, e um nome diferente por caminho quebraria o
-- freio (ele deixaria de enxergar o sucesso do residencial e pagaria por cima).
--
-- Mas então "quem coletou?" vira dedução a partir do horário — e dedução é o começo da
-- forma nº 10: um número plausível descrevendo outra coisa. Se amanhã o custo do radar
-- não cair, a primeira pergunta é "o residencial rodou?", e ela precisa de resposta no
-- dado, não de inferência.
--
-- Coluna ADITIVA e opcional: linha antiga fica com `null` (= não sabemos, e é honesto
-- dizer isso) e nenhuma consulta existente quebra.
alter table public.monitor_runs
  add column if not exists origem text;

comment on column public.monitor_runs.origem is
  'Quem executou este run: residencial (runner de casa, gratis) ou vercel (cron pago via '
  'Bright Data). Null = anterior a 29/08, quando so havia um caminho. Existe para que '
  '"o residencial rodou?" seja dado e nao deducao pelo horario.';
