-- ─────────────────────────────────────────────────────────────────────────────────────────
-- CORREÇÃO DA MIGRAÇÃO ANTERIOR (stale_exclui_fontes_acesso_complexo.sql, mesma sessão) —
-- 18/09/2026
--
-- A exceção de ZUK/GRUPOLANCE/SBID9/SOLD estava ERRADA — fiz a pergunta que o CLAUDE.md
-- pede ("este número mede o que o nome diz?") tarde demais, só depois de aplicar. Chequei
-- `leiloeiro_conhecimento.acesso` AGORA, e nenhuma das 4 é login-gated pra CATÁLOGO:
--   ZUK        acesso=puppeteer   anti_bot=nenhum  (SSR público, scroll infinito)
--   GRUPOLANCE acesso=puppeteer   anti_bot=nenhum
--   SBID9      acesso=api_json    anti_bot=nenhum  (API pública Superbid)
--   SOLD       acesso=puppeteer   anti_bot=nenhum
-- O que É login-gated nessas duas é só a MATRÍCULA (documento por lote — matricula-zuk.yml,
-- captura-docs-grupolance.yml, já rodam à parte, 4x/dia, sem depender do catálogo). O
-- catálogo em si roda no job diário GRÁTIS (`leiloeiros-puppeteer.yml`, ~80min, 0 Bright
-- Data) — a MESMA cadência que a margem de 36h do stale-purge já pressupõe. Excluí-las foi
-- fruto de aceitar a categoria "login-gated" que o dono usou pra descrever o conjunto (uma
-- lembrança de conversa antiga) sem validar contra o campo que existe exatamente pra isso.
-- Efeito do erro, se não corrigido: lote que sai de verdade do site dessas 4 fontes deixa de
-- ser detectado, e fica mostrado até a data do leilão vencer sozinha — regressão de
-- qualidade, não ganho nenhum (nenhuma delas tinha o problema de cadência que a exceção
-- resolve).
--
-- VENDASGOV, TORRES3 e HASTA CONTINUAM excluídas — essas sim têm `acesso` que não bate com
-- "recoleta ~diária": VENDASGOV saiu do job diário em 29/08 (WAF bloqueia o datacenter,
-- 0 lotes; só roda no runner residencial, cadência do dono); TORRES3 é
-- `gratis+brightdata`/`cloudflare_parcial` (paga por tentativa); HASTA é
-- `dom-puppeteer-residencial` (só roda de casa). Essas três genuinamente não seguem o
-- ritmo diário que a margem de 36h pressupõe.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.desativar_imoveis_leiloeiro_stale(margem interval default '36:00:00'::interval, teto_pct numeric default 0.40)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_desativados int := 0;
  v_puladas jsonb := '[]'::jsonb;
  r record;
  n int;
begin
  for r in
    select i.fonte, max(i.atualizado_em) as ultimo, count(*) as total
      from public.imoveis_leilao i
     where i.ativo and i.fonte is not null
       -- só as fontes cuja cadência de recoleta genuinamente foge do ritmo ~diário que a
       -- margem abaixo pressupõe: HASTA/VENDASGOV (só rodam no runner residencial do dono)
       -- e TORRES3 (Cloudflare + Bright Data pago). ZUK/GRUPOLANCE/SBID9/SOLD voltaram pra
       -- varredura normal — rodam no job diário grátis, sem anti-bot (ver comentário acima).
       and i.fonte not in ('CEF','SUPORTE','atribuido_manual','VENDASGOV','TORRES3','HASTA')
     group by i.fonte
    having max(i.atualizado_em) < now() - interval '2 hours'
       and max(i.atualizado_em) > now() - interval '10 days'
  loop
    declare
      v_piso int; v_tem boolean; v_ultima int;
    begin
      select b.ativos_piso, b.tem_baseline into v_piso, v_tem
        from public.fonte_baseline_aprendida() b where b.fonte = r.fonte;

      select s.total into v_ultima
        from public.fonte_saude s
       where s.fonte = r.fonte and s.status = 'ok'
       order by s.executado_em desc limit 1;

      if not coalesce(v_tem, false) then
        v_puladas := v_puladas || jsonb_build_object('fonte', r.fonte, 'motivo', 'sem_baseline_aprendida');
        continue;
      end if;
      if coalesce(v_ultima, 0) < coalesce(v_piso, 0) then
        v_puladas := v_puladas || jsonb_build_object('fonte', r.fonte, 'motivo', 'coleta_abaixo_do_piso',
                                                    'ultima', v_ultima, 'piso', v_piso);
        continue;
      end if;

      update public.imoveis_leilao i set ativo = false, suprimido_motivo = 'sumiu_da_fonte'
       where i.ativo and i.fonte = r.fonte and i.atualizado_em < (r.ultimo - margem);
      get diagnostics n = row_count;
      v_desativados := v_desativados + n;
    end;
  end loop;

  return jsonb_build_object('desativados', v_desativados, 'fontes_puladas', v_puladas, 'em', now());
end $function$;
