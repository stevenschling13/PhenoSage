-- Migration: analysis_finding_confidence
-- Purpose:   persist optional per-finding confidence scores from the analysis service
-- Rollback:  alter table public.plant_findings drop constraint if exists plant_findings_confidence_score_range_check; alter table public.plant_findings drop column if exists confidence_score;

begin;

alter table public.plant_findings
  add column if not exists confidence_score numeric(3,2);

do $$
begin
  alter table public.plant_findings
    add constraint plant_findings_confidence_score_range_check
    check (
      confidence_score is null
      or (confidence_score >= 0 and confidence_score <= 1)
    );
exception
  when duplicate_object then
    null;
end
$$;

comment on column public.plant_findings.confidence_score is
  'Optional analysis-model confidence score (0-1). Service-role analysis writes may populate it; user-reported findings may leave it null.';

commit;
