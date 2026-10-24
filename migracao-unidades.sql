-- =====================================================================
-- Central de Controle Anatômico – IDOMED
-- Estrutura completa do banco (unidades, corpos, tipos de aula, aulas)
--
-- Rode uma vez no Supabase: SQL Editor > New query > colar > Run
-- Funciona com o banco vazio ou com as tabelas já existentes,
-- e pode ser rodado de novo sem apagar nem duplicar nada.
-- =====================================================================

-- 1) Unidades
create table if not exists public.cadaver_unidades (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null unique,
  created_at timestamptz not null default now()
);

insert into public.cadaver_unidades (nome) values
  ('IDOMED Cittá'),
  ('IDOMED Vista Carioca'),
  ('IDOMED Unifacid')
on conflict (nome) do nothing;

-- 2) Corpos
create table if not exists public.cadaver_corpos (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  valor          numeric(12,2) not null default 0,
  data_aquisicao date,
  fornecedor     text,
  unidade        text,
  created_at     timestamptz not null default now()
);

-- 3) Tipos de aula
create table if not exists public.cadaver_procedimentos (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  pct_por_aluno numeric(8,4) not null default 0,
  descricao     text,
  created_at    timestamptz not null default now()
);

-- 4) Aulas
create table if not exists public.cadaver_aulas (
  id              uuid primary key default gen_random_uuid(),
  corpo_id        uuid references public.cadaver_corpos(id) on delete cascade,
  procedimento_id uuid references public.cadaver_procedimentos(id) on delete set null,
  procedimento    text,
  data            date not null default current_date,
  campus          text,
  num_alunos      integer not null default 1,
  observacao      text,
  peso            numeric(8,4) default 0,
  pontos          numeric(10,4) default 0,
  created_at      timestamptz not null default now()
);

-- 5) Ligação de cada tabela à unidade
--    (excluir uma unidade apaga os dados dela junto)
alter table public.cadaver_corpos
  add column if not exists unidade_id uuid references public.cadaver_unidades(id) on delete cascade;
alter table public.cadaver_procedimentos
  add column if not exists unidade_id uuid references public.cadaver_unidades(id) on delete cascade;
alter table public.cadaver_aulas
  add column if not exists unidade_id uuid references public.cadaver_unidades(id) on delete cascade;

create index if not exists cadaver_corpos_unidade_idx        on public.cadaver_corpos(unidade_id);
create index if not exists cadaver_procedimentos_unidade_idx on public.cadaver_procedimentos(unidade_id);
create index if not exists cadaver_aulas_unidade_idx         on public.cadaver_aulas(unidade_id);
create index if not exists cadaver_aulas_corpo_idx           on public.cadaver_aulas(corpo_id);

-- 6) Se já havia dados sem unidade, eles vão para a IDOMED Cittá
--    (no banco vazio estes comandos não alteram nada)
update public.cadaver_corpos
   set unidade_id = (select id from public.cadaver_unidades where nome = 'IDOMED Cittá')
 where unidade_id is null;

update public.cadaver_procedimentos
   set unidade_id = (select id from public.cadaver_unidades where nome = 'IDOMED Cittá')
 where unidade_id is null;

update public.cadaver_aulas a
   set unidade_id = c.unidade_id
  from public.cadaver_corpos c
 where a.corpo_id = c.id and a.unidade_id is null;

update public.cadaver_aulas
   set unidade_id = (select id from public.cadaver_unidades where nome = 'IDOMED Cittá')
 where unidade_id is null;

-- 7) Permissão para o app ler e gravar (chave pública "anon")
alter table public.cadaver_unidades      enable row level security;
alter table public.cadaver_corpos        enable row level security;
alter table public.cadaver_procedimentos enable row level security;
alter table public.cadaver_aulas         enable row level security;

drop policy if exists "app_acesso" on public.cadaver_unidades;
drop policy if exists "app_acesso" on public.cadaver_corpos;
drop policy if exists "app_acesso" on public.cadaver_procedimentos;
drop policy if exists "app_acesso" on public.cadaver_aulas;

create policy "app_acesso" on public.cadaver_unidades      for all to anon, authenticated using (true) with check (true);
create policy "app_acesso" on public.cadaver_corpos        for all to anon, authenticated using (true) with check (true);
create policy "app_acesso" on public.cadaver_procedimentos for all to anon, authenticated using (true) with check (true);
create policy "app_acesso" on public.cadaver_aulas         for all to anon, authenticated using (true) with check (true);

-- Conferência: deve listar as 3 unidades
select nome from public.cadaver_unidades order by created_at;
