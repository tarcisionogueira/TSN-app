-- 07/11 — Decisões do dono gravadas como regra de negócio (dado, não comentário), com a função que aplica.
--
-- (1) atendimento.prazo_resposta_equipe: a equipe responde em até 24 h quando o pedido chega em DIA ÚTIL e em
--     até 48 h quando chega em fim de semana ou feriado nacional (hora de Brasília). Quem aplica é
--     atendimento_prazo_horas(): o servidor (api/_atendimento-canal.js) a consulta para dizer ao cliente
--     "até sex., 08/11 às 14:30" e o health-check usa a mesma régua para acusar atraso. A conta em
--     api/_prazo-atendimento.js é só reserva quando o banco não responde.
-- (2) assessoria.preco_independe_do_imovel: a Assessoria é para ARREMATAR o imóvel, com honorário de êxito em
--     percentual; o preço não varia com o valor do imóvel. Aplicada por catalogo_assessoria_texto(), que é o
--     texto que a IA recebe no CATÁLOGO.
-- (3) e-book: o mês do Investidor Pro entra na hora da compra (dito na página do produto e no card) e a caixa
--     "continuar com a assinatura" já deixa levar só o e-book, sem cobrança depois. Só texto de tela, sem regra aqui.
-- (4) Sem template pago da Meta (WhatsApp): o contato de reserva é e-mail. Decisão registrada no HANDOFF.

create or replace function public._pascoa(p_ano int)
 returns date language sql immutable set search_path to 'public'
as $$
  with v as (
    select p_ano % 19 a, p_ano / 100 b, p_ano % 100 c
  ), w as (
    select a, b, c, b / 4 d, b % 4 e, (b + 8) / 25 f from v
  ), x as (
    select a, b, c, d, e, f, (b - f + 1) / 3 g, c / 4 i, c % 4 k from w
  ), y as (
    select a, e, i, k, (19 * a + b - d - g + 15) % 30 h from x
  ), z as (
    select a, h, (32 + 2 * e + 2 * i - h - k) % 7 l from y
  ), q as (
    select h, l, (a + 11 * h + 22 * l) / 451 m from z
  )
  select make_date(p_ano, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1) from q;
$$;

create or replace function public.eh_feriado_nacional(p_dia date)
 returns boolean language sql immutable set search_path to 'public'
as $$
  select to_char(p_dia, 'MM-DD') in ('01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25')
      or p_dia in (public._pascoa(extract(year from p_dia)::int) - 48,
                   public._pascoa(extract(year from p_dia)::int) - 47,
                   public._pascoa(extract(year from p_dia)::int) - 2,
                   public._pascoa(extract(year from p_dia)::int) + 60);
$$;

-- Regra atendimento.prazo_resposta_equipe: 24 h se o pedido chegou em dia útil; 48 h em fim de semana/feriado.
create or replace function public.atendimento_prazo_horas(p_desde timestamptz default now())
 returns int language sql stable set search_path to 'public'
as $$
  with d as (select (p_desde at time zone 'America/Sao_Paulo')::date dia)
  select case
    when extract(isodow from dia) in (6, 7) or public.eh_feriado_nacional(dia)
      then coalesce((select (valor->>'fim_de_semana_feriado_h')::int from public.regra_negocio where chave = 'atendimento.prazo_resposta_equipe' and ativo), 48)
    else coalesce((select (valor->>'dia_util_h')::int from public.regra_negocio where chave = 'atendimento.prazo_resposta_equipe' and ativo), 24)
  end from d;
$$;
grant execute on function public.atendimento_prazo_horas(timestamptz) to authenticated, service_role;

-- Regra assessoria.preco_independe_do_imovel: o texto que a IA recebe sobre a Assessoria.
create or replace function public.catalogo_assessoria_texto()
 returns text language sql stable security definer set search_path to 'public'
as $$
  select 'Assessoria (assessoria.preco_independe_do_imovel): a equipe acompanha o cliente para ARREMATAR o imóvel, do edital ao registro. '
      || 'Preço: R$ ' || replace(to_char(coalesce(preco_vista, preco), 'FM999G999'), ',', '.') || ' à vista ou R$ ' || replace(to_char(preco, 'FM999G999'), ',', '.')
      || ' parcelado, mais honorário de êxito de ' || to_char(honorarios_exito_pct, 'FM990') || '% sobre o valor da arrematação (mínimo de R$ 7.000, conforme o termo). '
      || 'O preço NÃO muda com o valor do imóvel; o êxito só é devido se arrematar.'
    from public.planos_config where plano_key = 'assessorado' and ativo;
$$;
revoke execute on function public.catalogo_assessoria_texto() from public, anon;

insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo) values
 ('atendimento.prazo_resposta_equipe', '{"dia_util_h": 24, "fim_de_semana_feriado_h": 48, "fuso": "America/Sao_Paulo", "feriados": "nacionais"}',
  'Dono, 07/11: a equipe responde ao cliente em até 24 h quando o pedido chega em dia útil e em até 48 h em fim de semana e feriado. O cliente vê a data/hora calculada; o health-check acusa o que passou do prazo.',
  array['atendimento_prazo_horas'], true),
 ('assessoria.preco_independe_do_imovel', '{"honorario_exito": true, "varia_com_valor_do_imovel": false}',
  'Dono, 07/11: a Assessoria é para arrematar o imóvel, com adicional de percentual de êxito; o preço é o mesmo qualquer que seja o valor do imóvel. A IA nunca cita pacote por imóvel nem preço de caso real.',
  array['catalogo_assessoria_texto'], true)
on conflict (chave) do update set valor = excluded.valor, descricao = excluded.descricao, aplicada_por = excluded.aplicada_por, ativo = true;
