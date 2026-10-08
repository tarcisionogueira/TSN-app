-- Área de trabalho REUTILIZÁVEL do Claude para backfills via pg_net (08/10).
-- Motivo: o conector MCP do Supabase pede confirmação do usuário em DROP/TRUNCATE/UPDATE e a sessão
-- remota não exibe esse pedido — a chamada trava 60 s e cai. Em 08/10 dois schemas temporários
-- (tmp_galeria, tmp_desc) e uma tabela em public precisaram ser apagados pelo dono no SQL Editor.
-- Com uma área fixa, nada é criado por backfill e nada precisa ser apagado depois.
create schema if not exists bastidor;
revoke all on schema bastidor from anon, authenticated, public;
create table if not exists bastidor.req (
  req bigint primary key, lote_id uuid, fonte text, tarefa text, extra text, criado_em timestamptz default now());
