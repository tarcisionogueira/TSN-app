-- 22/09, achado do dono ao testar o filtro "Sem lance" da Busca: "não trouxe nada" pros
-- leilões de ontem e hoje. Investigado: NÃO era o cron de apuração (rodou certo, gravou
-- resultado_leilao='sem_lance'/'indeterminado' em 27 lotes hoje) — era `desativar_leiloes_
-- encerrados()`, que roda de HORA em hora e desativa (ativo=false) TODO lote cujo leilão já
-- passou, sem olhar se o resultado acabou de ser apurado. O filtro "Sem lance" exige
-- `ativo=true` (Busca.jsx) — então o lote nasce apurado, e na PRÓXIMA rodada horária (no
-- máximo 1h depois) já está invisível pra sempre. Medido: os 67 lotes marcados sem_lance/
-- indeterminado em 20 e 21/09 estão TODOS ativo=false hoje; só os 27 de HOJE (apurados há
-- minutos) ainda apareciam — e sumiriam na próxima hora sem este fix.
--
-- A intenção já estava escrita no HANDOFF (retenção de 15 dias de documentos "pra montar
-- proposta de compra direta ao leiloeiro") — só faltava a MESMA janela valer pro `ativo`, que
-- é o que decide se o cliente consegue achar o lote pela Busca. Sem isso, a retenção de
-- documento é inútil: o cliente nunca chega no lote pra ver o documento retido.
create or replace function public.desativar_leiloes_encerrados()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_n integer;
begin
  update public.imoveis_leilao
     set ativo = false, suprimido_motivo = 'praca_vencida'
   where ativo
     and public.leilao_ja_encerrado(data_leilao, data_leilao_2, data_fim, modalidade)
     and not (
       resultado_leilao in ('sem_lance', 'indeterminado')
       and resultado_apurado_em > now() - interval '15 days'
     );
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
