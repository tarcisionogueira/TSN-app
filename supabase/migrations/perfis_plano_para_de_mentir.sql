-- `perfis.plano` DIZIA "gratuito" PARA TODO CLIENTE PAGANTE (28/08)
--
-- Achado ao conferir a pergunta do dono sobre o Erik. A coluna é escrita UMA vez, no cadastro,
-- com 'gratuito', e nunca mais: nenhum dos caminhos que mudam `role` — ativação
-- (`_webhook-core.js`), rebaixamento por inadimplência, chargeback, crons — toca nela. No banco
-- antes desta migração: Rafael (assessorado), Neuma, Marcelo, Antonio e Alessandra (top2) todos
-- com `plano = 'gratuito'`.
--
-- E não era só desatualização: o CHECK da coluna aceitava apenas ('gratuito','analista',
-- 'gestor') — vocabulário de um produto ANTERIOR. Os planos que a empresa vende hoje (top2,
-- assessorado, clube) não cabiam ali. A coluna estava fisicamente impedida de dizer a verdade,
-- e por isso a deriva não era um bug que apareceu: era o único estado possível.
--
-- Nenhuma tela ao vivo quebrou porque todas passaram a ler `role` (`minha_rede` devolve
-- `p.role as plano`; `admin_360_estatisticas` agrupa por `role`). Mas a coluna continua com
-- cara de fonte da verdade sobre o plano, e quem consultar o banco lê que o cliente que paga
-- R$ 99,80 é gratuito. Dado que mente é pior que dado ausente — parece resposta.
--
-- POR QUE TRIGGER, e não acrescentar `plano` ao update da ativação: `role` muda em pelo menos
-- cinco lugares (ativação, vencido, recusado, chargeback, reconciliação). Consertar um deixaria
-- os outros quatro divergindo, e a deriva voltaria calada — que é como ela nasceu. Aqui a
-- sincronia é estrutural: mudou o papel, o plano acompanha, venha de onde vier.
--
-- Papel de EQUIPE (admin/analista/advogado/consultor/leiloeiro) não é plano contratado e fica
-- 'gratuito' — é o que a tela de rede já faz ao pintar o selo.

alter table public.perfis drop constraint if exists perfis_plano_check;
alter table public.perfis add constraint perfis_plano_check
  check (plano = any (array[
    'gratuito','top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual',
    -- valores do produto antigo, mantidos para não invalidar linha histórica que ainda os use
    'analista','gestor'
  ]));

create or replace function public.perfis_sincronizar_plano()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.plano := case
    when new.role in ('top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual')
      then new.role
    else 'gratuito'
  end;
  return new;
end $$;

drop trigger if exists trg_perfis_sincronizar_plano on public.perfis;
create trigger trg_perfis_sincronizar_plano
  before insert or update of role on public.perfis
  for each row execute function public.perfis_sincronizar_plano();

update public.perfis
   set plano = case
     when role in ('top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual')
       then role else 'gratuito' end
 where plano is distinct from (case
     when role in ('top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual')
       then role else 'gratuito' end);
