-- login-rate (19/10, bug bounty): `registrar_falha` é público, então qualquer um registrava 8 falhas no e-mail de
-- OUTRA pessoa e o Login.jsx a bloqueava por 15 min (em laço, para sempre). O bloqueio só existe no front — não
-- protege contra quem chama o GoTrue direto —, então contar por (e-mail, IP) não perde proteção real e acaba com
-- o bloqueio remoto da vítima.
alter table public.login_tentativas add column if not exists ip text;
create index if not exists idx_login_tentativas_email_ip on public.login_tentativas (email, ip, criado_em);
