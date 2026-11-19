alter table agentops.tasks drop constraint if exists tasks_status_check;
alter table agentops.tasks add constraint tasks_status_check check (status in ('queued', 'running', 'succeeded', 'failed'));
