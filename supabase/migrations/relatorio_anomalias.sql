-- Anomalias detectadas ao GERAR relatórios (o agente que aprende com os relatórios
-- sinaliza aqui o que encontrou de errado — ex.: avaliação ausente no leiloeiro, CNJ
-- sem retorno no documental). A verificação de saúde do sistema lê isto e alerta para
-- revisão humana, sem gerar relatório nenhum (custo zero).
create table if not exists public.relatorio_anomalias (
  id           bigserial primary key,
  tipo         text not null,               -- 'avaliacao_ausente' | 'cnj_vazio' | ...
  fonte        text,                         -- leiloeiro
  imovel_id    text not null default '',
  campo        text,                         -- campo afetado
  detalhe      text,
  ocorrencias  int  not null default 1,
  resolvido    boolean not null default false,
  criado_em    timestamptz default now(),
  atualizado_em timestamptz default now()
);
create unique index if not exists uq_relatorio_anomalia on public.relatorio_anomalias (tipo, imovel_id);
alter table public.relatorio_anomalias enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='relatorio_anomalias' and policyname='anomalias_admin') then
    execute 'create policy anomalias_admin on public.relatorio_anomalias for all using (public.app_role() = ''admin'')';
  end if;
end $$;

-- Registro idempotente (incrementa ocorrências se repetir). Chamado pelos geradores de
-- relatório (service_role). Reabre a anomalia (resolvido=false) se voltar a acontecer.
create or replace function public.registrar_anomalia_relatorio(p_tipo text, p_fonte text, p_imovel_id text, p_campo text, p_detalhe text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into relatorio_anomalias (tipo, fonte, imovel_id, campo, detalhe)
  values (p_tipo, nullif(p_fonte,''), coalesce(p_imovel_id,''), nullif(p_campo,''), left(coalesce(p_detalhe,''),500))
  on conflict (tipo, imovel_id) do update
    set ocorrencias = relatorio_anomalias.ocorrencias + 1,
        detalhe = excluded.detalhe, fonte = excluded.fonte, campo = excluded.campo,
        resolvido = false, atualizado_em = now();
end $$;
revoke all on function public.registrar_anomalia_relatorio(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.registrar_anomalia_relatorio(text,text,text,text,text) to service_role;
