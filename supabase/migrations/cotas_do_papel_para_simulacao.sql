-- COTA DO PAPEL SIMULADO (15/08, achado do dono no print da simulação).
--
-- O SINTOMA: o admin simulando "Explorador" via, no cartão de boas-vindas, **"Análises
-- ilimitadas"** — que é o que o ADMIN tem. Explorador tem 3 amostras vitalícias.
--
-- A CAUSA: a simulação trocava o PAPEL, mas a tela lê a cota com
-- `minhas_cotas(effectiveUserId)` — e na simulação de papel o usuário continua sendo o admin
-- (diferente do modo suporte, em que o id muda). O banco respondia com toda a razão sobre a
-- linha do admin: ilimitado. Papel simulado, dado real — e o dado ganha.
--
-- POR QUE UMA FUNÇÃO NO BANCO, e não uma tabelinha de limites no front: `src/utils/cotaAnalise.js`
-- documenta por que isso é proibido aqui. A tabela de limites já esteve copiada em QUATRO telas
-- e as quatro divergiram do servidor, cada uma para um lado — inclusive dando `limite: null` ao
-- consultor, o que pinta exatamente "Análises ilimitadas" para quem tem 5. Simular criando uma
-- quinta cópia seria repetir o defeito dentro da ferramenta feita para encontrá-lo. Esta função
-- chama `limite_ia(papel, tipo)`, a MESMA fonte de `limite_ia_efetivo`, então não há como
-- divergir do que o cliente de verdade recebe.
--
-- `usado = 0` e `bonus = 0` de propósito: a simulação mostra a tela de uma conta NOVA daquele
-- plano. Consumo é do indivíduo, não do papel — e emprestar o consumo do admin traria de volta,
-- por outra porta, o mesmo erro que esta função existe para corrigir. O campo `simulado: true`
-- viaja junto para que nenhuma tela confunda isto com cota de gente de verdade.
create or replace function public.cotas_do_papel(p_role text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_caller text; v_lm int; v_ld int; v_li int; v_amostra boolean; v_papel text;
begin
  if auth.uid() is null then return jsonb_build_object('erro','nao_autenticado'); end if;
  -- Só o ADMIN simula. Sem esta guarda a função viraria um jeito de qualquer autenticado
  -- descobrir (e a tela de exibir) a cota de planos que ele não assina.
  select role into v_caller from perfis where id = auth.uid();
  if v_caller is distinct from 'admin' then return jsonb_build_object('erro','sem_permissao'); end if;

  v_papel := regexp_replace(coalesce(p_role,'explorador'), '_anual$', '');
  if v_papel = 'admin' then
    v_lm := null; v_ld := null; v_li := null;
  else
    v_lm := limite_ia(v_papel, 'mercado');
    v_ld := limite_ia(v_papel, 'documental');
    v_li := limite_ia(v_papel, 'indice');
  end if;
  -- Espelha o ramo da escrita, igual a `minhas_cotas`: explorador consome AMOSTRA vitalícia,
  -- não cota mensal. É o que faz a tela escrever "no total" em vez de "este mês" — e dizer
  -- "este mês" ao explorador é a falha mais cara desta família (ele acha que renova, e some).
  v_amostra := (v_papel = 'explorador');

  return jsonb_build_object(
    'plano', v_papel, 'role', v_papel, 'mes', to_char(now(),'YYYY-MM'),
    'amostra', v_amostra, 'simulado', true,
    'mercado',    jsonb_build_object('usado',0,'limite',v_lm,'bonus',0,'ilimitado',(v_lm is null),'amostra',v_amostra),
    'documental', jsonb_build_object('usado',0,'limite',v_ld,'bonus',0,'ilimitado',(v_ld is null)),
    'indice',     jsonb_build_object('usado',0,'limite',v_li,'bonus',0,'ilimitado',(v_li is null)),
    'credito_saldo', 0);
end $$;

revoke all on function public.cotas_do_papel(text) from public, anon;
grant execute on function public.cotas_do_papel(text) to authenticated;
