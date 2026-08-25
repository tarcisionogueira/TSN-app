-- ─────────────────────────────────────────────────────────────────────────────────────────
-- O E-MAIL MANDAVA IMÓVEL ACIMA DO CAPITAL QUE O CLIENTE DECLAROU — 25/08/2026
--
-- ACHADO A PARTIR DE UM CLIENTE REAL. Um usuário perguntou no WhatsApp do dono por que fez
-- 4 filtros e "não recebe e-mail". Fui verificar a conta dele e o alerta estava funcionando —
-- mas o e-mail que ele recebeu em 18/08 continha:
--     12 lotes · 7 acima de R$ 150 mil · 4 acima de R$ 200 mil · 1 acima de R$ 1 milhão
--     maior: R$ 2.045.762 · ticket médio: R$ 384 mil
-- Ele declarou na triagem faixa de capital **até R$ 150 mil**.
--
-- O cabeçalho de `api/enviar-alertas-cron.js` diz, com todas as letras:
--     "mantém o teto — acima do capital do cliente NÃO ENTRA NUNCA"
-- Mas `tetoPerfil` só era aplicado nos caminhos de cidade-do-cadastro (raio crescente,
-- similares, país — linhas 492/502/521/531). O caminho do PASSO 1, os FILTROS SALVOS,
-- aplicava apenas `f.valorMax` — o campo que o cliente digita na Busca. Quem deixou esse
-- campo em branco ficava **sem teto nenhum**.
--
-- E a razão é ordem de declaração, não lógica: `TETO_FAIXA` e `tetoFaixa` nasciam DENTRO do
-- laço por usuário, na linha 466 — DEPOIS do passo 1, que roda na linha 443. O passo 1 não
-- tinha como enxergar um valor que ainda não existia.
--
-- ALCANCE MEDIDO ANTES DE CONSERTAR (não é amostra):
--     36 envios acima do teto da própria faixa · 12 clientes atingidos
--     maior lote enviado: R$ 6.148.488
--     8 usuários têm faixa declarada e filtro salvo sem valorMax → hoje sem teto algum
--
-- O CONSERTO está em `api/enviar-alertas-cron.js` (mesmo commit): `TETO_FAIXA` sobe para
-- escopo de módulo, `tetoFaixa` passa a ser calculado ANTES do passo 1, e um helper único
-- `tetoEfetivo(filtro, tetoFaixa)` — o MENOR entre o que o cliente digitou naquele filtro e
-- o teto da faixa — passa a valer nos dois caminhos (PostgREST e RPC de raio).
--
-- VERIFICADO:
--   • 9 casos de aceitação do helper, 9 passam (inclusive faixa `acima_1mi` = sem teto, que
--     não pode ganhar teto por engano, e valorMax mascarado "R$ 250.000").
--   • Dos 12 lotes que o cliente recebeu, 8 sobrevivem e 4 passam a ser barrados.
--   • Ninguém fica sem oferta: 203 imóveis elegíveis sob o teto no raio de 25 km dele, e
--     17.188 no acervo inteiro sob o teto mais apertado (R$ 200 mil, desconto ≥ 40%).
--
-- ESTA MIGRAÇÃO acrescenta a trava que impede o retorno — inclusive por um caminho de envio
-- que ainda não existe. Ela olha o RASTRO (`alertas_enviados`), não o código: qualquer rota
-- futura que mande lote acima do teto declarado aparece aqui.
-- Janela de 7 dias de propósito: hoje ela marca 4 (o dano desta semana) e zera sozinha
-- quando o conserto estiver no ar — em vez de acusar os 36 históricos para sempre.
-- ─────────────────────────────────────────────────────────────────────────────────────────

do $do$
declare def text; ancora text := '     (''sem_foto'','; novo text;
begin
  select pg_get_functiondef(oid) into def from pg_proc where proname='qa_invariantes';
  if def is null then raise exception 'qa_invariantes nao existe'; end if;
  if position('alerta_acima_do_capital' in def) > 0 then
    raise notice 'ja aplicado — nada a fazer'; return;
  end if;
  if position(ancora in def) = 0 then
    raise exception 'ancora nao encontrada — revise antes de aplicar';
  end if;

  novo :=
'     (''alerta_acima_do_capital'',''Lote enviado por e-mail acima do teto de capital que o cliente declarou na triagem'',''Atendimento'',''bug'',
       (select count(*) from alertas_enviados ae
          join perfis p on p.id = ae.user_id
          join imoveis_leilao i on i.id = ae.imovel_id
          join (values (''ate_150k'',200000),(''150_400k'',520000),(''400k_1mi'',1300000)) t(f,v)
            on t.f = p.faixa_capital
         where ae.enviado_em > now() - interval ''7 days''
           and i.valor_minimo > t.v), 0),
' || ancora;

  execute replace(def, ancora, novo);
  raise notice 'trava alerta_acima_do_capital adicionada';
end $do$;
