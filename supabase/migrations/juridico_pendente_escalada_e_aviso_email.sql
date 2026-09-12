-- Pedido do dono (12/09): quando o processo judicial fica pendente por indisponibilidade
-- de fonte pública (CNJ/DataJud, DJEN/Comunica CNJ — vício `cnj_nao_consultado`), o sistema
-- passa a reter com uma ESCALADA de tentativas em vez do cron genérico de 6h/3 tentativas
-- (esse continua servindo os outros vícios: matrícula não lida, edital não lido etc.).
--
-- Escala: 30min → 1h → 2h → 4h → 6h → mantém a cada 6h dali em diante, sem teto (é
-- indisponibilidade de fonte pública, não dado permanentemente ausente — medido em 12/09:
-- o nosso DataJud/DJEN teve sucesso tão recente quanto 11/09, não é uma queda contínua).
--
-- Aviso por e-mail ao cliente: só a partir de quando a escalada ALCANÇA o degrau de 2h
-- (a 3ª tentativa) — antes disso é considerado "instabilidade rápida, se resolve sozinha"
-- e não vale incomodar. Dali em diante, fica marcado para avisar assim que resolver.

alter table public.analises_documental
  add column if not exists juridico_tentativas integer not null default 0,
  add column if not exists juridico_avisar_email boolean not null default false;
