-- 05/11 (decisão do dono): sub-cota de documentos do Bright Data 25→60/dia e 150→400/semana, para recuperar
-- ~800 lotes com edital/matrícula barrados por anti-bot (409 requalificados de 'sem_documento' + pendentes da
-- plataforma Degrau). Estimativa: 1.600–2.400 pedidos ≈ R$ 13–40 no total (US$ 1,50–3,00 por mil). O teto
-- global semanal (720) não muda. Voltar a 25/150 quando o atraso zerar (documentos_fila status 'bloqueado').
update public.brightdata_reserva
   set teto_dia = 60, teto = 400, atualizado_em = now(),
       descricao = 'Captura de documentos de leiloeiros anti-bot. 05/11 (dono): 25→60/dia e 150→400/semana para recuperar ~800 lotes bloqueados (estimativa R$ 13–40 no total).'
 where proposito = 'docs';
