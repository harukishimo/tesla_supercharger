-- スパQ: queue_versionの更新だけをprivate Realtime Broadcastへ送る。
-- ブラウザは受信専用。匿名ユーザーのINSERT policyを作らないため、
-- クライアントから偽のqueue_changedを発行できない。
--
-- Supabase Realtimeの拡張がない通常のローカルPostgreSQLでは、この
-- migrationは何も変更せず成功する。Supabase projectではrealtime.sendと
-- realtime.messagesのRLSを利用する。

do $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null
    or to_regprocedure('realtime.topic()') is null
    or to_regclass('realtime.messages') is null then
    raise notice 'Supabase Realtime is not installed; private Broadcast setup skipped for local validation.';
    return;
  end if;

  execute $function$
    create or replace function public.broadcast_queue_version()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $trigger$
    begin
      perform realtime.send(
        jsonb_build_object(
          'siteId', new.id::text,
          'queueVersion', new.queue_version
        ),
        'queue_changed',
        'site:' || new.id::text,
        true
      );
      return null;
    end;
    $trigger$;
  $function$;

  execute 'drop trigger if exists charging_sites_queue_version_broadcast on public.charging_sites';
  execute $trigger$
    create trigger charging_sites_queue_version_broadcast
    after update of queue_version on public.charging_sites
    for each row
    when (old.queue_version is distinct from new.queue_version)
    execute function public.broadcast_queue_version()
  $trigger$;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute $policy$
      create policy "supa_q_anon_can_receive_queue_versions"
      on realtime.messages
      for select
      to anon
      using (
        realtime.messages.extension = 'broadcast'
        and (select realtime.topic()) like 'site:%'
      )
    $policy$;
  end if;
end;
$$;
