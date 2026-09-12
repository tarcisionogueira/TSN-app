-- Pedido do dono (11-12/09): quem se inscreve na aula ao vivo e opta por "explorar agora"
-- (RedefinirSenha.jsx) entra na plataforma sem nunca ter digitado uma senha própria — a conta
-- nasceu com senha aleatória em live-inscrever.js. Sem um popup pedindo isso na primeira
-- navegação, a única forma de definir senha depois é lembrar de ir em "Esqueci minha senha".
--
-- `senha_pendente` marca essa dívida. `default false` porque TODO outro caminho de criação de
-- conta (criar-conta-checkout.js, cadastro normal) já pede a senha própria no formulário — só
-- live-inscrever.js liga esta flag, e só para conta NOVA. Fica `true` até a pessoa de fato
-- definir uma senha (RedefinirSenha.jsx ou Perfil.jsx desligam), e o popup (SenhaPendenteModal)
-- volta a cada acesso enquanto ela não resolver — mesmo padrão do vídeo de boas-vindas.
alter table public.perfis
  add column if not exists senha_pendente boolean not null default false;

comment on column public.perfis.senha_pendente is 'true = conta nasceu com senha aleatória (fluxo de acesso direto pela inscrição na aula) e a pessoa ainda não definiu a própria — dispara o SenhaPendenteModal até ser resolvido.';
