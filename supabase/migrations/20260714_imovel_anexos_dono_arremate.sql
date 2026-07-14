-- O dono do arrematado pode LER e APAGAR os anexos do imóvel que arrematou.
-- A policy pública só deixava ler matrícula/edital/regras — os documentos do ciclo
-- do arremate (auto/carta/contrato/escritura/matrícula registrada) ficavam
-- invisíveis para o próprio cliente na tela Meus Arrematados.
create policy imovel_anexos_meu_arremate_select on public.imovel_anexos for select
  using (exists (select 1 from public.arrematados a where a.imovel_id = imovel_anexos.imovel_id::text and a.user_id = auth.uid()));

create policy imovel_anexos_meu_arremate_delete on public.imovel_anexos for delete
  using (exists (select 1 from public.arrematados a where a.imovel_id = imovel_anexos.imovel_id::text and a.user_id = auth.uid()));

-- Resultado da validação da IA (o anexo é mesmo desta arrematação?).
alter table public.imovel_anexos add column if not exists validacao jsonb;