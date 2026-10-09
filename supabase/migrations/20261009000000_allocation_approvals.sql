-- Fair-share allocation runs + approval reviews (hosted Supabase parity).
-- Local SQLite deployments create these tables lazily via
-- app.services.allocation_store.ensure_allocation_tables().

create table if not exists public.allocation_runs (
    id text primary key,
    medicine_id text not null,
    medicine_name text not null,
    params_json text not null default '{}',
    result_json text not null default '{}',
    status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
    created_by text,
    created_at timestamptz not null default now()
);

create table if not exists public.allocation_approvals (
    id text primary key,
    run_id text not null references public.allocation_runs(id) on delete cascade,
    decision text not null check (decision in ('APPROVED', 'REJECTED')),
    reviewer text not null,
    note text,
    created_at timestamptz not null default now()
);

create index if not exists idx_allocation_runs_medicine on public.allocation_runs(medicine_id);
create index if not exists idx_allocation_approvals_run on public.allocation_approvals(run_id);
