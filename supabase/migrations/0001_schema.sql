create table profiles (
  id uuid primary key references auth.users on delete cascade,
  name text,
  avatar_url text,
  created_at timestamptz default now()
);

create table boards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles,
  title text not null,
  created_at timestamptz default now()
);

create table board_members (
  board_id uuid references boards on delete cascade,
  user_id uuid references profiles on delete cascade,
  role text not null check (role in ('owner','client')),
  primary key (board_id, user_id)
);

create table columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards on delete cascade,
  title text not null,
  position int not null default 0,
  created_at timestamptz default now()
);

create table cards (
  id uuid primary key default gen_random_uuid(),
  column_id uuid not null references columns on delete cascade,
  title text not null,
  description text,
  due_date date,
  assignee_id uuid references profiles,
  position int not null default 0,
  created_at timestamptz default now()
);

create table labels (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards on delete cascade,
  name text not null,
  color text not null
);

create table card_labels (
  card_id uuid references cards on delete cascade,
  label_id uuid references labels on delete cascade,
  primary key (card_id, label_id)
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards on delete cascade,
  author_id uuid not null references profiles,
  body text not null,
  created_at timestamptz default now()
);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards on delete cascade,
  path text not null,
  filename text not null,
  uploaded_by uuid not null references profiles,
  created_at timestamptz default now()
);

-- new auth user -> profile row
create function handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, name) values (new.id, new.raw_user_meta_data->>'name');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();
