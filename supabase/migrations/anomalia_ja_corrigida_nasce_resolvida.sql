-- 29/08 — "CORRIGIDO PELO DOCUMENTO" ESTAVA CONTANDO COMO DIVERGÊNCIA EM ABERTO
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- O invariante `data_edital_recuou_prazo` acusava 3. Investigados um a um: os três são MEGA,
-- vistos hoje, e o detalhe de todos diz **"corrigido pelo documento"** — ou seja, o sistema
-- leu o edital, viu que o acervo estava errado e ARRUMOU na hora. Conferido no acervo: os
-- lotes ficaram coerentes (abertura da 1ª praça em agosto, `praca2_fim` em 16/09, `data_fim`
-- correto, e o lote segue ativo porque a 2ª praça de fato não terminou).
--
-- Ou seja: a linha era o RASTRO de um conserto bem-sucedido, e o invariante a lia como problema
-- pendente. **Um painel que acusa o próprio conserto treina o dono a ignorar o painel** — e o
-- custo real é esse, não a linha.
--
-- A distinção já existia no código, só não chegava ao banco. `gerar-analise.js` decide entre:
--   • `recuaSemProva = false` → CORRIGE o acervo pelo edital → nada pendente
--   • `recuaSemProva = true`  → MANTÉM o acervo (o edital recuaria o prazo sem dizer que é
--     encerramento) → **isso sim** é divergência em aberto, e precisa de olho humano
-- Os dois gravavam `resolvido = false`. Agora o chamador diz qual é qual.
--
-- ⚠️ O `on conflict` continua forçando `resolvido = false` quando o parâmetro for false: uma
-- anomalia que REAPARECE depois de resolvida tem de voltar a acusar. Só o caso já resolvido na
-- origem nasce (e permanece) resolvido.
create or replace function public.registrar_anomalia_relatorio(
  p_tipo text, p_fonte text, p_imovel_id text, p_campo text, p_detalhe text,
  p_resolvido boolean default false)
returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
begin
  insert into relatorio_anomalias (tipo, fonte, imovel_id, campo, detalhe, resolvido)
  values (p_tipo, nullif(p_fonte,''), coalesce(p_imovel_id,''), nullif(p_campo,''),
          left(coalesce(p_detalhe,''),500), coalesce(p_resolvido,false))
  on conflict (tipo, imovel_id) do update
    set ocorrencias = relatorio_anomalias.ocorrencias + 1,
        detalhe = excluded.detalhe, fonte = excluded.fonte, campo = excluded.campo,
        resolvido = excluded.resolvido, atualizado_em = now();
end $function$;

-- As 3 linhas de hoje são exatamente esse caso: fecha o que já estava consertado, sem apagar
-- (o rastro fica, com ocorrências e detalhe, para quem quiser auditar a correção).
update relatorio_anomalias
   set resolvido = true, atualizado_em = now()
 where tipo = 'data_divergente_edital' and not resolvido
   and detalhe like '%corrigido pelo documento%';
