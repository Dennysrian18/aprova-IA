-- ════════════════════════════════════════════════════════════════════
--  APROVA IA — BACK-END REAL (SUPABASE)  •  Login + Admin de verdade
-- ════════════════════════════════════════════════════════════════════
--  Este arquivo tem 2 partes:
--    (1) PASSO A PASSO no painel do Supabase (ler os comentários)
--    (2) O SQL para copiar/colar no "SQL Editor" do Supabase
--
--  Nada aqui contém senha ou chave secreta. A ÚNICA coisa que vai para o
--  código do app (index.html) é a URL do projeto e a "anon key" (PÚBLICA).
--  A "service_role key" é SECRETA e NUNCA deve ir para o app.
-- ════════════════════════════════════════════════════════════════════
--
--  ┌─ PASSO 1 — Criar o projeto ─────────────────────────────────────┐
--  │ 1. Entre em https://supabase.com  →  "Start your project".       │
--  │ 2. New project → dê um nome (ex.: aprova-ia), crie uma senha do  │
--  │    banco (guarde) e escolha a região mais perto (South America). │
--  │ 3. Espere ~1 min o projeto subir.                                │
--  └──────────────────────────────────────────────────────────────────┘
--
--  ┌─ PASSO 2 — Rodar este SQL ──────────────────────────────────────┐
--  │ 1. Menu lateral → "SQL Editor" → "New query".                    │
--  │ 2. Cole TODO o bloco SQL do fim deste arquivo → "Run".           │
--  │ 3. Deve aparecer "Success". Pronto: tabela + segurança criadas.  │
--  └──────────────────────────────────────────────────────────────────┘
--
--  ┌─ PASSO 3 — Pegar as chaves PÚBLICAS ────────────────────────────┐
--  │ 1. Menu → "Project Settings" → "API".                            │
--  │ 2. Copie "Project URL"  (ex.: https://abcdefgh.supabase.co).     │
--  │ 3. Copie "anon public"  (chave que começa com eyJ...).           │
--  │ 4. No index.html, lá no topo, preencha:                          │
--  │        const SUPABASE_URL      = 'https://abcdefgh.supabase.co'; │
--  │        const SUPABASE_ANON_KEY = 'eyJhbGciOi...';                │
--  │    Salve, faça commit/push. O app passa a usar login real.       │
--  │ ⚠️ NÃO copie a "service_role" — essa é secreta.                  │
--  └──────────────────────────────────────────────────────────────────┘
--
--  ┌─ PASSO 4 — Ligar o "Continuar com Google" (opcional) ───────────┐
--  │ 1. Menu → "Authentication" → "Providers" → "Google" → Enable.    │
--  │ 2. Precisa de um OAuth Client no Google Cloud Console:           │
--  │      https://console.cloud.google.com → APIs & Services →        │
--  │      Credentials → Create Credentials → OAuth client ID → Web.   │
--  │    - Authorized redirect URI: cole a "Callback URL (for OAuth)"  │
--  │      que o Supabase mostra na tela do provider Google, algo como │
--  │      https://abcdefgh.supabase.co/auth/v1/callback               │
--  │ 3. Cole no Supabase o Client ID e o Client Secret → Save.        │
--  │ 4. Authentication → URL Configuration → "Redirect URLs": adicione│
--  │      https://SEU-USUARIO.github.io/aprova-IA/                    │
--  │      http://localhost:*  (se for testar local)                   │
--  └──────────────────────────────────────────────────────────────────┘
--
--  ┌─ PASSO 5 — Confirmação de email (recomendado deixar LIGADO) ────┐
--  │ Authentication → Providers → Email: "Confirm email" ON garante   │
--  │ que a pessoa é dona do email. Com isso, ao criar conta o app     │
--  │ mostra "confirme seu email"; a pessoa clica no link e depois faz │
--  │ login. Se quiser entrar na hora (sem confirmar), desligue essa   │
--  │ opção — menos seguro, use só para testes.                        │
--  └──────────────────────────────────────────────────────────────────┘
--
--  ┌─ PASSO 6 — Tornar alguém ADMIN ─────────────────────────────────┐
--  │ 1. A pessoa PRIMEIRO cria a conta normalmente no app (ou em      │
--  │    Authentication → Users → "Add user").                         │
--  │ 2. Menu → "Table Editor" → tabela "profiles" → ache a linha do   │
--  │    email → marque is_admin = true → Save.                        │
--  │    (ou rode:  update public.profiles set is_admin = true         │
--  │               where email = 'voce@email.com';)                   │
--  │ 3. Só quem tem is_admin=true vê o painel de admin. Essa marca    │
--  │    NÃO pode ser mudada pelo navegador — o RLS abaixo bloqueia.   │
--  └──────────────────────────────────────────────────────────────────┘
--
-- ════════════════════════════════════════════════════════════════════
--  SQL — copie deste ponto até o fim e rode no SQL Editor do Supabase
-- ════════════════════════════════════════════════════════════════════

-- 1) Tabela de perfis: 1 linha por usuário (id = id do auth.users).
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  name       text,
  data       jsonb       not null default '{}'::jsonb,  -- XP, streak, objetivo, etc.
  is_admin   boolean     not null default false,        -- SÓ o dono muda isto
  updated_at timestamptz not null default now()
);

-- 2) Liga a segurança por linha (Row Level Security).
alter table public.profiles enable row level security;

-- 3) Políticas: cada usuário só ENXERGA e EDITA a PRÓPRIA linha.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using ( auth.uid() = id );

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using ( auth.uid() = id )
  with check ( auth.uid() = id );

-- 4) BLOQUEIO ANTI-ESCALADA: o usuário NÃO pode alterar a coluna is_admin
--    (nem id). Mesmo com a política de update acima, sem este privilégio
--    o navegador não consegue se promover a admin. Só o painel do Supabase
--    (service_role) consegue. É isto que torna o admin "de verdade".
revoke update (is_admin, id) on public.profiles from anon, authenticated;
-- Garante que as DEMAIS colunas continuam editáveis pelo dono:
grant update (email, name, data, updated_at) on public.profiles to authenticated;

-- 5) Cria a linha de perfil AUTOMATICAMENTE quando alguém se cadastra.
--    (roda como "security definer" para conseguir inserir na tabela)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Pronto! Agora é só preencher SUPABASE_URL e SUPABASE_ANON_KEY no index.html.
