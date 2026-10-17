-- 17/10: os campos de ANDAMENTO AO JURÍDICO (destinatários, frequência, liga/desliga) só mudam por ADMIN.
-- A política casos_update_consolidada deixa o CLIENTE atualizar o próprio caso, e este trigger só travava a
-- atribuição: o cliente podia pôr qualquer e-mail em acompanhamento_para, ligar acompanhamento_liberado_em, e o
-- casos-acompanhamento-cron mandaria o caso — do endereço pessoal do dono — para quem ele quisesse.
-- Achado ao criar o painel de autonomia do dono (AcompanhamentoJuridicoCaso.jsx).
create or replace function public.casos_protege_atribuicao()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.role() = 'service_role' or public.app_role() = 'admin' then
    return new;
  end if;
  new.acompanhamento_para           := old.acompanhamento_para;
  new.acompanhamento_cc             := old.acompanhamento_cc;
  new.acompanhamento_liberado_em    := old.acompanhamento_liberado_em;
  new.acompanhamento_assunto        := old.acompanhamento_assunto;
  new.acompanhamento_intervalo_dias := old.acompanhamento_intervalo_dias;
  if public.app_role() in ('analista','advogado') then
    return new;
  end if;
  new.cliente_id  := old.cliente_id;
  new.analista_id := old.analista_id;
  new.advogado_id := old.advogado_id;
  return new;
end $function$;
