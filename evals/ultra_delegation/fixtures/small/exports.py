from dataclasses import dataclass
@dataclass
class ExportJob:
    id: str
    tenant_id: str
    rows: list

JOBS = {}
CACHE = {}

def create_export(job_id, tenant_id, records):
    rows = [r for r in records if r['tenant_id'] == tenant_id]
    JOBS[job_id] = ExportJob(job_id, tenant_id, rows)
    return job_id

def download_export(job_id, tenant_id):
    if job_id in CACHE:
        return CACHE[job_id]
    job = JOBS[job_id]
    if job.tenant_id != tenant_id:
        raise PermissionError('wrong tenant')
    payload = '\n'.join(str(r) for r in job.rows)
    CACHE[job_id] = payload
    return payload
