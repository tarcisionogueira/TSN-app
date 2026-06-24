create table if not exists push_subscriptions (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text,
  auth       text,
  user_agent text,
  criado_em  timestamptz not null default now(),
  unique(user_id)
);

alter table push_subscriptions enable row level security;

create policy "service_role_all" on push_subscriptions
  for all to service_role using (true) with check (true);
