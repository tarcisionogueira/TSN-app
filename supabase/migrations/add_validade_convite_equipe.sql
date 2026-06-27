-- Convite de equipe: validade padrão de 7 dias
-- Uso único e expiração-ao-concluir já são garantidos por usar_convite_equipe()
-- (filtra usado_em IS NULL + expira_em > now(); ao usar, seta usado_em/usado_por/ativo=false).
-- Faltava apenas a validade por data: expira_em ficava NULL (nunca expirava).
alter table public.convites_equipe
  alter column expira_em set default (now() + interval '7 days');
