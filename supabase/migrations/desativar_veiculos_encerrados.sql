-- VEÍCULO ENCERRADO NUNCA SAÍA DA VITRINE (25/09, achado investigando o invariante
-- `resultado_leilao_atrasado`). `desativar_leiloes_encerrados()` só tocava imoveis_leilao: nenhum
-- objeto do banco desligava veículo. Medido: 512 veículos SUPERBID com resultado 'vendido'
-- seguiam ativos (o cliente via carro já vendido como disponível), e SODRE/MEGA que sumiram da
-- fonte em 11–13/09 continuavam ativos para sempre.
--
-- Mesma retenção dos imóveis, com uma diferença deliberada: imóvel é desligado no fim da praça e
-- a apuração (apurar-resultado-leilao-cron) pega também os desligados por praça vencida; a passada
-- de VEÍCULOS desse cron só lê `ativo=true`. Por isso veículo sem resultado espera a JANELA de
-- apuração (10 dias) antes de sair. Vendido/cancelado saem 2 dias depois do leilão. Sem lance /
-- indeterminado apurado há < 15 dias fica (é o que o cliente procura para propor compra).
-- A apuração SUPERBID do runner residencial não filtra `ativo` e religa quem não vendeu.
CREATE OR REPLACE FUNCTION public.desativar_leiloes_encerrados()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n integer; v_v integer;
begin
  update public.imoveis_leilao
     set ativo = false, suprimido_motivo = 'praca_vencida'
   where ativo
     and public.leilao_ja_encerrado(data_leilao, data_leilao_2, data_fim, modalidade)
     and not coalesce(resultado_leilao in ('sem_lance', 'indeterminado')
                      and resultado_apurado_em > now() - interval '15 days', false);
  get diagnostics v_n = row_count;

  update public.veiculos_leilao
     set ativo = false
   where ativo
     and data_leilao is not null
     and ( (resultado_leilao in ('vendido', 'cancelado') and data_leilao < now() - interval '2 days')
        or (data_leilao < now() - interval '10 days'
            and not coalesce(resultado_leilao in ('sem_lance', 'indeterminado')
                             and resultado_apurado_em > now() - interval '15 days', false)) );
  get diagnostics v_v = row_count;

  return v_n + v_v; -- total desligado (imóveis + veículos)
end;
$function$;
