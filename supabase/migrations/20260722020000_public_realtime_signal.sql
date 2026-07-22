-- スパQ: ログインなしのブラウザへqueue_version更新の合図だけを送る。
-- public Broadcastのpayloadは信用せず、ブラウザは必ずNext.js APIから
-- 最新状態を再取得する。個人情報・entry ID・管理トークンは送らない。

do $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null
    or to_regclass('realtime.messages') is null then
    raise notice 'Supabase Realtime is not installed; public Broadcast setup skipped for local validation.';
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
        false
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

  execute 'drop policy if exists "supa_q_anon_can_receive_queue_versions" on realtime.messages';
end;
$$;
