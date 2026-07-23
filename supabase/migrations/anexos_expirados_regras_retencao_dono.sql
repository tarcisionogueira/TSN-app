-- Retenção revisada (regras do dono, 22/07). Mantém o teto de tempo de 60s (destravamento).
-- Regras implementadas AGORA (seguras, sem novo mecanismo):
--   • MANTÉM permanente: arrematado, e imóvel com os 3 relatórios COMPLETOS (mercado+documental
--     +laudo). Relatório INCOMPLETO (falta algum dos 3) não segura mais os docs.
--   • REGRA 4 (venda direta): mantém enquanto o scraper traz (ativo); apaga quando some.
--   • REGRA 3 (leilão com praça): apaga 24h após a ÚLTIMA praça (data_leilao vencida), mesmo
--     ativo; OU quando a fonte tira o imóvel do acervo (ativo=false = leilão acabou). Sem data
--     parseável e ainda ativo, não apaga (seguro).
--   • Anexo órfão (imóvel saiu da base): apaga 5 dias após criado.
-- Rules 1 e 2 do dono (arrematado→30d após parar de pagar; 3-relatórios→15d + sinalização de
-- arremate) EXIGEM o botão "arrematei" + notificação (Etapa 2) e NÃO estão aqui — por isso o
-- "tem os 3 relatórios" segue como MANTÉM permanente por ora (nunca apaga doc de arremate).
-- Mitigação: o cron zera storage_path mas mantém a linha; doc apagado é RE-CAPTURÁVEL on-demand.
CREATE OR REPLACE FUNCTION public.anexos_expirados(p_limite integer DEFAULT 100)
 RETURNS TABLE(id uuid, storage_path text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
  select a.id, a.storage_path
  from public.imovel_anexos a
  where a.storage_path is not null
    and a.arrematado = false
    and not (
          exists (select 1 from public.analises_mercado    m where m.imovel_id::text = a.imovel_id::text)
      and exists (select 1 from public.analises_documental d where d.imovel_id::text = a.imovel_id::text)
      and exists (select 1 from public.analises_laudo      l where l.imovel_id::text = a.imovel_id::text)
    )
    and case
      when exists (select 1 from public.imoveis_leilao i where i.id = a.imovel_id) then
        case
          when exists (select 1 from public.imoveis_leilao i where i.id = a.imovel_id and i.modalidade = 'venda_direta')
            then exists (select 1 from public.imoveis_leilao i where i.id = a.imovel_id and coalesce(i.ativo, true) = false)
          else exists (
            select 1 from public.imoveis_leilao i
            where i.id = a.imovel_id
              and (
                (i.data_leilao ~ '^\d{4}-\d{2}-\d{2}' and substring(i.data_leilao, 1, 10)::date < (current_date - 1))
                or coalesce(i.ativo, true) = false
              )
          )
        end
      else a.criado_em::date <= (current_date - 5)
    end
  limit greatest(1, least(coalesce(p_limite, 100), 500))
$function$;
