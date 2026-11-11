begin;
-- Respect per-user label order and all supported task sorting modes.
create or replace function public.open_api_dispatch(p_method text,p_path text,p_query jsonb default '{}',p_body jsonb default '{}',p_version bigint default null,p_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare
  ctx jsonb; perms jsonb; wid uuid; tid uuid; root_id uuid; label_id uuid; parent_id uuid; new_id uuid;
  seg text[]; action text; lk text; target text; source text; pref jsonb; def jsonb; zone text;
  row public.tasks; parent public.tasks; item record; data jsonb; result jsonb; cached jsonb;
  clone_map jsonb; original_id uuid; copied_root uuid;
  labels uuid[]; ids uuid[]; limit_n integer; offset_n integer; fingerprint text;
  can_write boolean; can_delete boolean; manual boolean; descending boolean; sort_key text;
begin
  ctx:=anttodo_private.open_context(); perms:=ctx->'permissions';
  if not perms ? 'tasks:read' then raise exception 'insufficient_scope' using errcode='42501'; end if;
  can_write:=perms ? 'tasks:write'; can_delete:=perms ? 'tasks:delete';
  seg:=string_to_array(trim(both '/' from p_path),'/');
  fingerprint:=encode(extensions.digest(jsonb_build_array(p_method,p_path,p_query,p_body,p_version)::text,'sha256'),'hex');
  if p_method<>'GET' then
    if p_method='DELETE' or seg[3]='restore' then
      if not can_delete then raise exception 'insufficient_scope' using errcode='42501'; end if;
    elsif not can_write then raise exception 'insufficient_scope' using errcode='42501'; end if;
    cached:=anttodo_private.open_idempotency((ctx->>'id')::uuid,p_key,fingerprint);
    if cached is not null then
      data:=coalesce(cached#>'{data,task}',cached->'data');
      if not ctx->'workspace_ids' ? (data->>'workspace_id') or not anttodo_private.is_workspace_member((data->>'workspace_id')::uuid)
        or not exists(select 1 from public.tasks where id=(data->>'id')::uuid) then
        raise exception 'not_found' using errcode='P0404';
      end if;
      if exists(select 1 from jsonb_array_elements(coalesce(cached#>'{data,affected_tasks}','[]')) t
        where not exists(select 1 from public.tasks where id=(t->>'id')::uuid)) then
        raise exception 'not_found' using errcode='P0404';
      end if;
      return cached;
    end if;
  end if;
  if seg=array['me'] and p_method='GET' then
    data:=ctx-'id'||jsonb_build_object('id',auth.uid());
  elsif seg=array['workspaces'] and p_method='GET' then
    select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'slug',w.slug)),'[]') into data
      from public.workspaces w where ctx->'workspace_ids' ? w.id::text;
  elsif seg[1]='workspaces' and cardinality(seg)=3 and seg[3] in ('labels','lists','tasks') then
    wid:=seg[2]::uuid;
    if not ctx->'workspace_ids' ? wid::text or not anttodo_private.is_workspace_member(wid) then
      raise exception 'workspace_not_authorized' using errcode='42501'; end if;
    if seg[3]='labels' and p_method='GET' then
      select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'workspace_id',l.workspace_id,'name',l.name,'color',l.color,'parent_id',l.parent_id,'kind',l.kind,'position',l.position) order by l.position,l.id),'[]') into data from public.labels l where l.workspace_id=wid;
    elsif seg[3]='lists' and p_method='GET' then
      select coalesce(jsonb_agg(x.obj order by x.pos,x.key),'[]') into data from (
        select v.key,coalesce(sp.position,v.ordinal)::integer pos,jsonb_build_object('id',v.key,'name',v.name,'type','system','workspace_id',wid,'parent_id',null,
          'url_path','/workspaces/'||wid||'/views/'||v.key,'capabilities',jsonb_build_object('create',can_write and v.key='inbox','move',can_write and v.key='inbox','reorder',false)) obj
        from (values('all','全部',0),('inbox','收集箱',1),('today','今天',2),('week','本周',3),('assigned','指派给我',4),('watching','我关注的',5),('trash','回收站',6)) v(key,name,ordinal)
        left join public.task_system_view_preferences sp on sp.workspace_id=wid and sp.user_id=auth.uid() and sp.view_key=v.key
        where coalesce(sp.visible,true)
        union all
        select 'label:'||l.id,coalesce(ulo.position,l.position)+100,jsonb_build_object('id','label:'||l.id,'name',l.name,'type','label','workspace_id',wid,'color',l.color,
          'parent_id',case when l.parent_id is null then null else 'label:'||l.parent_id end,'url_path','/workspaces/'||wid||'/tags/'||l.id,
          'capabilities',jsonb_build_object('create',can_write and anttodo_private.label_permission_level(l.id)>=2,'move',can_write and anttodo_private.label_permission_level(l.id)>=2,
            'reorder',can_write and anttodo_private.label_permission_level(l.id)>=2 and coalesce((select p.sort='custom' from public.task_list_preferences p where p.workspace_id=wid and p.user_id=auth.uid() and p.list_key='label:'||l.id and p.view_mode='list'),true)))
        from public.labels l left join public.user_label_order ulo on ulo.label_id=l.id and ulo.user_id=auth.uid() where l.workspace_id=wid
        union all
        select 'custom:'||v.id,v.position+50,jsonb_build_object('id','custom:'||v.id,'name',v.name,'type','custom','workspace_id',wid,'parent_id',null,
          'url_path','/workspaces/'||wid||'/views/custom/'||v.id,'capabilities',jsonb_build_object('create',false,'move',false,'reorder',false))
        from public.custom_task_views v where v.workspace_id=wid and v.user_id=auth.uid() and v.visible
      ) x;
    elsif seg[3]='tasks' and p_method='GET' then
      lk:=coalesce(p_query->>'list_id','all'); zone:=coalesce(p_query->>'timezone','UTC');
      perform now() at time zone zone;
      if lk like 'label:%' then
        label_id:=substring(lk from 7)::uuid;
        if not exists(select 1 from public.labels where id=label_id and workspace_id=wid) then raise exception 'list_not_found' using errcode='P0404'; end if;
      elsif lk like 'custom:%' then
        select definition into def from public.custom_task_views where id=substring(lk from 8)::uuid and workspace_id=wid and user_id=auth.uid();
        if def is null then raise exception 'list_not_found' using errcode='P0404'; end if;
      elsif lk not in ('all','inbox','today','week','assigned','watching','trash') then raise exception 'invalid_list' using errcode='22023'; end if;
      limit_n:=coalesce((p_query->>'limit')::integer,100);
      offset_n:=coalesce(nullif(p_query->>'cursor','')::integer,0);
      if limit_n not between 1 and 200 or offset_n<0 then raise exception 'invalid_pagination' using errcode='22023'; end if;
      select to_jsonb(p) into pref from public.task_list_preferences p where p.workspace_id=wid and p.user_id=auth.uid() and p.list_key=lk and p.view_mode='list';
      sort_key:=coalesce(pref->>'sort','custom'); descending:=coalesce(pref->>'direction','asc')='desc';
      with recursive label_scope as (
        select id from public.labels where id=label_id and workspace_id=wid
        union all select l.id from public.labels l join label_scope s on l.parent_id=s.id where l.workspace_id=wid
      ), eligible as (
        select t.*,coalesce(pl.position,t.position) as list_position,coalesce(pl.section_id::text,'') section_key,
          array_position(array['none','low','medium','high'],t.priority::text) priority_rank,
          (select p.display_name from public.profiles p where p.id=t.assignee_id) assignee_name,
          (select string_agg(l.name,E'\001' order by coalesce(ulo.position,l.position),l.id) from public.task_labels tl join public.labels l on l.id=tl.label_id left join public.user_label_order ulo on ulo.label_id=l.id and ulo.user_id=auth.uid() where tl.task_id=anttodo_private.task_root_id(t.id)) label_name
        from public.tasks t
        left join public.task_list_placements pl on pl.task_id=anttodo_private.task_root_id(t.id) and pl.workspace_id=wid and pl.list_key=lk
        where t.workspace_id=wid and t.kind='todo'
          and ((lk='trash' or coalesce(def->>'scope','')='trash')=(t.deleted_at is not null))
          and (coalesce(p_query->>'status',case when lk='trash' then 'all' else 'open' end)='all' or t.status::text=coalesce(p_query->>'status','open'))
          and (not p_query ? 'assignee_id' or t.assignee_id::text=case when p_query->>'assignee_id'='me' then auth.uid()::text else p_query->>'assignee_id' end)
          and (not p_query ? 'q' or t.title ilike '%'||(p_query->>'q')||'%')
          and (lk<>'inbox' and coalesce(def->>'scope','')<>'inbox' or not exists(select 1 from public.task_labels where task_id=anttodo_private.task_root_id(t.id)))
          and (label_id is null or exists(select 1 from public.task_labels tl join label_scope s on s.id=tl.label_id where tl.task_id=anttodo_private.task_root_id(t.id)))
          and (coalesce(def->>'scope','')<>'label' or exists(select 1 from public.task_labels tl where tl.task_id=anttodo_private.task_root_id(t.id) and def->'label_ids' ? tl.label_id::text))
          and (lk<>'assigned' or t.assignee_id=auth.uid())
          and (lk<>'watching' or exists(select 1 from public.task_participants where task_id=t.id and user_id=auth.uid()))
          and (lk<>'today' or anttodo_private.open_due_matches(t,'today',zone))
          and (lk<>'week' or anttodo_private.open_due_matches(t,'this_week',zone))
          and (coalesce(def->>'filter_assignee','all')='all'
            or def->>'filter_assignee'='unassigned' and t.assignee_id is null
            or def->>'filter_assignee'='assigned_to_me' and t.assignee_id=auth.uid()
            or def->>'filter_assignee'='users' and def->'filter_assignee_ids' ? t.assignee_id::text)
          and (coalesce(def->>'filter_creator','all')='all' or t.created_by=auth.uid())
          and (coalesce(def->>'filter_watching','all')='all' or exists(select 1 from public.task_participants where task_id=t.id and user_id=auth.uid()))
          and (def is null or def->'filter_due' is null or exists(select 1 from jsonb_array_elements_text(def->'filter_due') d where anttodo_private.open_due_matches(t,d,zone)))
      ), page as (
        select * from eligible order by section_key,
          case when sort_key='title' and not descending then title end asc,case when sort_key='title' and descending then title end desc,
          case when sort_key='due' and not descending then due_at end asc nulls last,case when sort_key='due' and descending then due_at end desc nulls last,
          case when sort_key='created' and not descending then created_at end asc,case when sort_key='created' and descending then created_at end desc,
          case when sort_key='updated' and not descending then updated_at end asc,case when sort_key='updated' and descending then updated_at end desc,
          case when sort_key='priority' and not descending then priority_rank end asc,case when sort_key='priority' and descending then priority_rank end desc,
          case when sort_key='assignee' and not descending then assignee_name end asc nulls last,case when sort_key='assignee' and descending then assignee_name end desc nulls last,
          case when sort_key='label' and not descending then label_name end asc nulls last,case when sort_key='label' and descending then label_name end desc nulls last,
          case when sort_key='custom' and not descending then list_position end asc,case when sort_key='custom' and descending then list_position end desc,
          created_at desc,id limit limit_n+1 offset offset_n
      ), numbered as (select *,row_number() over() n from page)
      select jsonb_build_object('items',coalesce(jsonb_agg(anttodo_private.open_task(id,perms) order by n) filter(where n<=limit_n),'[]'),
        'next_cursor',case when count(*)>limit_n then (offset_n+limit_n)::text else null end) into data from numbered;
    elsif seg[3]='tasks' and p_method='POST' then
      if not can_write then raise exception 'insufficient_scope' using errcode='42501'; end if;
      lk:=coalesce(p_body->>'list_id','inbox'); parent_id:=nullif(p_body->>'parent_task_id','')::uuid;
      if parent_id is null and lk<>'inbox' and lk not like 'label:%' then raise exception 'creation_target_required' using errcode='22023'; end if;
      if exists(select 1 from jsonb_object_keys(p_body) k where k not in ('title','description','priority','due_at','due_start_at','due_is_all_day','due_timezone','list_id','parent_task_id')) then raise exception 'unknown_field' using errcode='22023'; end if;
      if char_length(btrim(coalesce(p_body->>'title',''))) not between 1 and 500 then raise exception 'invalid_title' using errcode='22023'; end if;
      if parent_id is not null then
        select * into parent from public.tasks where id=parent_id and workspace_id=wid and kind='todo' and deleted_at is null;
        if parent.id is null or not anttodo_private.can_edit_task(parent_id) then raise exception 'parent_not_editable' using errcode='42501'; end if;
        new_id:=extensions.gen_random_uuid();
        insert into public.tasks(id,workspace_id,parent_task_id,title,description,priority,created_by)
          values(new_id,wid,parent_id,btrim(p_body->>'title'),coalesce(p_body->>'description',''),coalesce(p_body->>'priority','none')::public.task_priority,auth.uid());
      else
        labels:=case when lk='inbox' then array[]::uuid[] else array[substring(lk from 7)::uuid] end;
        row:=public.create_task_with_labels(wid,btrim(p_body->>'title'),labels,coalesce(p_body->>'description',''),null,coalesce(p_body->>'priority','none')::public.task_priority,null,null,'todo');
        new_id:=row.id;
      end if;
      if p_body ? 'due_at' then
        update public.tasks set due_at=(p_body->>'due_at')::timestamptz,due_start_at=(p_body->>'due_start_at')::timestamptz,
          due_is_all_day=coalesce((p_body->>'due_is_all_day')::boolean,false),due_timezone=p_body->>'due_timezone' where id=new_id;
      end if;
      data:=anttodo_private.open_task(new_id,perms);
    else raise exception 'not_found' using errcode='P0404'; end if;
  elsif seg[1]='tasks' and cardinality(seg) between 2 and 3 then
    tid:=seg[2]::uuid; action:=coalesce(seg[3],'');
    select * into row from public.tasks where id=tid and kind='todo';
    if row.id is null or not ctx->'workspace_ids' ? row.workspace_id::text then raise exception 'not_found' using errcode='P0404'; end if;
    wid:=row.workspace_id;
    if not anttodo_private.is_workspace_member(wid) then raise exception 'not_found' using errcode='P0404'; end if;
    if p_method='GET' and action='' then data:=anttodo_private.open_task(tid,perms);
    else
      if p_version is null then raise exception 'if_match_required' using errcode='P0428'; end if;
      -- Serialize tree/list writes before row locks, matching move_task's order.
      perform pg_advisory_xact_lock(hashtextextended('task-tree:'||wid::text,0));
      select * into row from public.tasks where id=tid for update;
      if row.version<>p_version then raise exception 'version_conflict' using errcode='P0412'; end if;
      if row.deleted_at is not null and action<>'restore' then raise exception 'task_deleted' using errcode='P0409'; end if;
      if p_method='DELETE' and action='' or p_method='POST' and action='restore' then
        if not can_delete or not anttodo_private.can_organize_task(tid) then raise exception 'insufficient_scope' using errcode='42501'; end if;
        if row.connector_id is not null then
          perform public.set_external_task_deleted_at(tid,case when action='restore' then null else now() end);
        else
          update public.tasks set deleted_at=case when action='restore' then null else now() end where id=tid;
        end if;
      elsif p_method='PATCH' and action='' then
        if not anttodo_private.can_edit_task(tid) then raise exception 'task_read_only' using errcode='42501'; end if;
        if exists(select 1 from jsonb_object_keys(p_body) k where k not in ('title','description','priority','due_at','due_start_at','due_is_all_day','due_timezone')) then raise exception 'unknown_field' using errcode='22023'; end if;
        if p_body ? 'title' and char_length(btrim(coalesce(p_body->>'title',''))) not between 1 and 500 then raise exception 'invalid_title' using errcode='22023'; end if;
        update public.tasks set title=case when p_body ? 'title' then btrim(p_body->>'title') else title end,
          description=case when p_body ? 'description' then p_body->>'description' else description end,
          priority=case when p_body ? 'priority' then (p_body->>'priority')::public.task_priority else priority end,
          due_at=case when p_body ? 'due_at' then (p_body->>'due_at')::timestamptz else due_at end,
          due_start_at=case when p_body ? 'due_start_at' then (p_body->>'due_start_at')::timestamptz else due_start_at end,
          due_is_all_day=case when p_body ? 'due_is_all_day' then (p_body->>'due_is_all_day')::boolean else due_is_all_day end,
          due_timezone=case when p_body ? 'due_timezone' then p_body->>'due_timezone' else due_timezone end where id=tid;
      elsif p_method='POST' and action in ('complete','reopen') then
        if not anttodo_private.can_edit_task(tid) then raise exception 'task_read_only' using errcode='42501'; end if;
        update public.tasks set status=case when action='complete' then 'completed'::public.task_status else 'open'::public.task_status end where id=tid;
      elsif p_method='POST' and action='duplicate' then
        if row.connector_id is not null or not anttodo_private.can_edit_task(tid) then raise exception 'task_read_only' using errcode='42501'; end if;
        root_id:=anttodo_private.task_root_id(tid);
        select coalesce(array_agg(label_id),array[]::uuid[]) into labels from public.task_labels where task_id=root_id;
        original_id:=tid; clone_map:='{}';
        for item in with recursive subtree as (
          select t.*,0 depth from public.tasks t where id=original_id
          union all select t.*,s.depth+1 from public.tasks t join subtree s on t.parent_task_id=s.id where t.deleted_at is null
        ) select * from subtree order by depth,position,id loop
          if item.connector_id is not null then raise exception 'connector_subtree_read_only' using errcode='42501'; end if;
          if item.depth=0 and item.parent_task_id is null then
            row:=public.create_task_with_labels(wid,coalesce(nullif(p_body->>'title',''),item.title),labels,item.description,item.due_at,item.priority,null,item.due_timezone,'todo');
            new_id:=row.id;
          else
            new_id:=extensions.gen_random_uuid();
            insert into public.tasks(id,workspace_id,parent_task_id,title,description,priority,position,created_by)
              values(new_id,wid,case when item.depth=0 then item.parent_task_id else (clone_map->>item.parent_task_id::text)::uuid end,
                case when item.depth=0 then coalesce(nullif(p_body->>'title',''),item.title) else item.title end,item.description,item.priority,item.position,auth.uid());
          end if;
          clone_map:=clone_map||jsonb_build_object(item.id::text,new_id);
          if item.depth=0 then copied_root:=new_id; end if;
          update public.tasks set due_at=item.due_at,due_start_at=item.due_start_at,due_is_all_day=item.due_is_all_day,
            due_timezone=item.due_timezone,recurrence=item.recurrence,estimate_hours=item.estimate_hours,estimate_pomodoros=item.estimate_pomodoros where id=new_id;
        end loop;
        tid:=copied_root;
      elsif p_method='POST' and action='move' then
        if not anttodo_private.can_edit_task(tid) then raise exception 'task_read_only' using errcode='42501'; end if;
        if p_body ? 'parent_task_id' then
          perform public.move_task(tid,(p_body->>'parent_task_id')::uuid,coalesce((p_body->>'position')::integer,0));
        else
          if row.parent_task_id is not null then raise exception 'move_root_required' using errcode='22023'; end if;
          target:=p_body->>'target_list_id'; source:=p_body->>'source_list_id';
          if target='inbox' then delete from public.task_labels where task_id=tid;
          elsif target like 'label:%' then
            label_id:=substring(target from 7)::uuid;
            if not exists(select 1 from public.labels where id=label_id and workspace_id=wid) or anttodo_private.label_permission_level(label_id)<2 then raise exception 'label_not_editable' using errcode='42501'; end if;
            if source like 'label:%' and source<>target then
              delete from public.task_labels where task_id=tid and task_labels.label_id=substring(source from 7)::uuid;
            end if;
            insert into public.task_labels(task_id,label_id) values(tid,label_id) on conflict do nothing;
          else raise exception 'invalid_move_target' using errcode='22023'; end if;
          update public.workspaces set updated_at=now() where id=wid;
        end if;
      elsif p_method='POST' and action='reorder' then
        if not anttodo_private.can_organize_task(tid) then raise exception 'task_read_only' using errcode='42501'; end if;
        lk:=p_body->>'list_id';
        select coalesce(p.sort='custom',true) into manual from public.task_list_preferences p where p.workspace_id=wid and p.user_id=auth.uid() and p.list_key=lk and p.view_mode='list';
        if lk not like 'label:%' or not coalesce(manual,true) then raise exception 'list_not_reorderable' using errcode='22023'; end if;
        if row.parent_task_id is not null then perform public.move_task(tid,row.parent_task_id,coalesce((p_body->>'position')::integer,0));
        else
          ids:=array(select jsonb_array_elements_text(p_body->'task_ids')::uuid);
          if cardinality(ids)=0 or not tid=any(ids) or cardinality(ids)<>cardinality(array(select distinct unnest(ids))) then raise exception 'invalid_order' using errcode='22023'; end if;
          if exists(select 1 from unnest(ids) i where not exists(select 1 from public.tasks t join public.task_labels tl on tl.task_id=t.id where t.id=i and t.workspace_id=wid and tl.label_id=substring(lk from 7)::uuid and t.parent_task_id is null)) then raise exception 'invalid_order' using errcode='42501'; end if;
          perform public.set_task_list_order(wid,lk,null,ids);
          update public.tasks set updated_at=now() where id=tid;
        end if;
      else raise exception 'not_found' using errcode='P0404'; end if;
      if p_method='PATCH' and p_body ?| array['due_at','due_start_at','due_is_all_day','due_timezone'] then
        select * into row from public.tasks where id=tid;
        perform public.save_task_schedule(tid,row.due_at,row.due_start_at,row.due_is_all_day,row.due_timezone,
          case when row.due_at is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('anchor',r.anchor,'offset_value',r.offset_value,'offset_unit',r.offset_unit,'local_time',r.local_time) order by r.position) from public.task_reminders r where r.task_id=tid),'[]') end,
          coalesce((select persistent from public.task_reminder_settings where task_id=tid),false),
          case when row.due_at is null then null else row.recurrence end);
      end if;
      data:=jsonb_build_object('task',anttodo_private.open_task(tid,perms),'affected_tasks',coalesce((
        select jsonb_agg(anttodo_private.open_task(t.id,perms)) from public.tasks t where t.workspace_id=wid and t.updated_at>=transaction_timestamp() and t.kind='todo'
      ),'[]'));
    end if;
  else raise exception 'not_found' using errcode='P0404'; end if;
  result:=jsonb_build_object('status',case when p_method='POST' and seg[1]='workspaces' then 201 else 200 end,'data',data);
  if p_method<>'GET' then perform anttodo_private.open_idempotency((ctx->>'id')::uuid,p_key,fingerprint,result); end if;
  return result;
end $$;
commit;
