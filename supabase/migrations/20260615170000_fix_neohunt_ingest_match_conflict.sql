do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'matches_job_id_unique'
      and conrelid = 'public.matches'::regclass
  ) then
    if to_regclass('public.matches_job_id_key') is not null then
      alter table public.matches
        add constraint matches_job_id_unique unique using index matches_job_id_key;
    else
      alter table public.matches
        add constraint matches_job_id_unique unique (job_id);
    end if;
  end if;
end $$;

drop index if exists public.matches_job_id_key;

create or replace function public.neohunt_ingest_snapshot(payload jsonb, ingest_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  expected_token text;
  company_item jsonb;
  job_item jsonb;
  v_job_id uuid;
  stored_jobs integer := 0;
  stored_matches integer := 0;
  purged_jobs integer := 0;
  cutoff timestamptz := now() - interval '7 days';
begin
  select s.ingest_token
    into expected_token
  from public.neohunt_ingest_settings s
  where s.id = 1;

  if expected_token is null or ingest_token is distinct from expected_token then
    raise exception 'invalid ingest token';
  end if;

  for company_item in
    select * from jsonb_array_elements(coalesce(payload->'companies', '[]'::jsonb))
  loop
    insert into public.companies (name, career_url, active)
    values (
      company_item->>'name',
      company_item->>'career_url',
      coalesce(nullif(company_item->>'active', '')::boolean, true)
    )
    on conflict (name) do update
    set career_url = excluded.career_url,
        active = excluded.active,
        updated_at = now();
  end loop;

  for job_item in
    select * from jsonb_array_elements(coalesce(payload->'jobs', '[]'::jsonb))
  loop
    insert into public.jobs (
      company,
      title,
      location,
      description,
      job_url,
      source,
      posted_date,
      scraped_at,
      score,
      status
    )
    values (
      job_item->>'company',
      job_item->>'title',
      nullif(job_item->>'location', ''),
      nullif(job_item->>'description', ''),
      job_item->>'job_url',
      nullif(job_item->>'source', ''),
      nullif(job_item->>'posted_date', '')::date,
      coalesce(nullif(job_item->>'scraped_at', '')::timestamptz, now()),
      nullif(job_item->>'score', '')::integer,
      coalesce(nullif(job_item->>'status', ''), 'new')
    )
    on conflict (job_url) do update
    set company = excluded.company,
        title = excluded.title,
        location = excluded.location,
        description = excluded.description,
        source = excluded.source,
        posted_date = excluded.posted_date,
        scraped_at = excluded.scraped_at,
        score = excluded.score,
        status = excluded.status,
        updated_at = now()
    returning id into v_job_id;

    stored_jobs := stored_jobs + 1;

    if job_item ? 'match' and job_item->'match' is not null then
      insert into public.matches (
        job_id,
        match_score,
        strengths,
        gaps,
        cv_angle,
        decision
      )
      values (
        v_job_id,
        nullif(job_item->'match'->>'match_score', '')::integer,
        job_item->'match'->>'strengths',
        job_item->'match'->>'gaps',
        job_item->'match'->>'cv_angle',
        job_item->'match'->>'decision'
      )
      on conflict on constraint matches_job_id_unique do update
      set match_score = excluded.match_score,
          strengths = excluded.strengths,
          gaps = excluded.gaps,
          cv_angle = excluded.cv_angle,
          decision = excluded.decision,
          updated_at = now();

      stored_matches := stored_matches + 1;
    end if;
  end loop;

  delete from public.jobs j
  where j.scraped_at < cutoff;
  get diagnostics purged_jobs = row_count;

  delete from public.matches m
  where not exists (
    select 1 from public.jobs j where j.id = m.job_id
  );

  return jsonb_build_object(
    'stored_jobs', stored_jobs,
    'stored_matches', stored_matches,
    'purged_jobs', purged_jobs
  );
end;
$function$;
