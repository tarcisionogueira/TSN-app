-- Aplicado via MCP em 21/07/2026 (com OK do dono). Limpeza das "matrículas fantasma" do
-- Grupo Lance: ~151 imóveis tinham link_matricula AUTO-DERIVADO (matricula_grupolance_auto.pdf,
-- gerado por substituição de string a partir da URL do edital); alguns CDNs devolvem o PRÓPRIO
-- edital nessa URL → botão "Matrícula" falso (caso de Bertioga reportado pelo dono). O scraper
-- já foi endurecido (hash edital×matrícula) p/ não gravar mais isso.
--
-- REVERSÍVEL: os ARQUIVOS permanecem no Storage; guardamos os vínculos em tabelas de backup
-- (_bkp_gl_*), então dá p/ restaurar. Resultado: 151 imóveis nullados + 372 anexos removidos.

-- Backup (RLS on, sem policy → só service_role; sem PII).
create table if not exists public._bkp_gl_matricula_fantasma as
  select id, fonte, link_matricula, now() as bkp_em
  from imoveis_leilao
  where fonte='GRUPOLANCE' and link_matricula ilike '%grupolance_auto.pdf%';
alter table public._bkp_gl_matricula_fantasma enable row level security;

create table if not exists public._bkp_gl_anexos_fantasma as
  select a.*, now() as bkp_em from imovel_anexos a
  where a.tipo='matricula' and a.storage_path ilike '%grupolance_auto.pdf%';
alter table public._bkp_gl_anexos_fantasma enable row level security;

-- Limpeza (só o vínculo; arquivos ficam no Storage).
update imoveis_leilao set link_matricula = null
where fonte='GRUPOLANCE' and link_matricula ilike '%grupolance_auto.pdf%';

delete from imovel_anexos
where tipo='matricula' and storage_path ilike '%grupolance_auto.pdf%';

-- Reversão (se preciso):
--   update imoveis_leilao i set link_matricula = b.link_matricula
--     from public._bkp_gl_matricula_fantasma b where b.id = i.id;
--   insert into imovel_anexos select ... from public._bkp_gl_anexos_fantasma;  (menos bkp_em)
