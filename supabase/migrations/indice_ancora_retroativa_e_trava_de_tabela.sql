-- LIMPEZA RETROATIVA + TRAVA DE TABELA (regra do dono, 07/08).
-- "rode uma atualização para os dados já registrados não puxarem esses dados poluídos no índice
--  ou relatório. Confirme para que estes erros não se repitam."
--
-- Medido antes: 1.216 das 2.490 linhas do corpus de CONSULTA (49%) sem nenhuma referência de
-- lugar — sem bairro, sem endereço, sem condomínio —, todas do caminho do MERCADOLÓGICO
-- (origem 'relatorio' 1.140 e 'relatorio_regiao' 76); e 484 no histórico do Índice, sem nem URL.
-- Elas afirmam só "nesta cidade" e mesmo assim pesavam como se fossem da região consultada.
--
-- Resultado: consulta 2.490 -> 1.274 (locação 259 -> 181), histórico 1.406 -> 922, zero sem
-- âncora, e as 23 amostras de Morada dos Lagos intactas.
--
-- BACKUP antes de remover (padrão já usado em analises_removidas_roi_invalido_20260807):
-- metade de um corpus não se apaga sem rede, e a decisão é reversível.
create table if not exists public.indice_amostra_sem_ancora_20260807 as
select * from public.indice_amostra
where coalesce(btrim(bairro_norm),'') = '' and endereco is null and condominio is null;

create table if not exists public.indice_amostras_sem_ancora_20260807 as
select * from public.indice_amostras
where coalesce(btrim(bairro_norm),'') = '' and endereco is null and condominio is null and cep is null;

delete from public.indice_amostra
where coalesce(btrim(bairro_norm),'') = '' and endereco is null and condominio is null;

delete from public.indice_amostras
where coalesce(btrim(bairro_norm),'') = '' and endereco is null and condominio is null and cep is null;

-- TRAVA NO NÍVEL DA TABELA — é isto que faz o erro não se repetir.
-- Há VÁRIOS escritores (gerar-analise em 2 pontos, ingerir_amostras_indice, backfills futuros,
-- eventual insert manual). Validar em cada um é a mesma aposta que já falhou nesta base: basta
-- um caminho novo esquecer a regra. O CHECK vale para todos, inclusive para código que ainda
-- não existe, e falha ALTO (insert rejeitado) em vez de poluir em silêncio.
-- Testado: insert sem âncora é bloqueado por check_violation, sem deixar resíduo.
alter table public.indice_amostra
  add constraint indice_amostra_ancora_check
  check (coalesce(btrim(bairro_norm),'') <> '' or endereco is not null or condominio is not null);

alter table public.indice_amostras
  add constraint indice_amostras_ancora_check
  check (coalesce(btrim(bairro_norm),'') <> '' or endereco is not null or condominio is not null or cep is not null);

comment on constraint indice_amostra_ancora_check on public.indice_amostra is
  'Regra do dono (07/08): amostra sem referência de lugar (bairro, endereço ou condomínio) é poluição — pode ser de outra localidade. Vale para TODO escritor, presente e futuro.';
