import Database from 'better-sqlite3'

const db = new Database('./proxim-dev.db')

// Get Meetu's candidate ID
const cand = db.prepare("SELECT id FROM candidates WHERE name LIKE ?").get('%Meetu%')
if (!cand) { console.log('Candidate not found'); process.exit(1) }

console.log('Candidate ID:', cand.id)

// Get recent pipeline runs joined to pipeline jobs
const runs = db.prepare(`
  SELECT pr.id, pr.status, pr.jobs_discovered, pr.jobs_deduplicated, pr.completed_at,
         pj.job_type
  FROM pipeline_runs pr
  JOIN pipeline_jobs pj ON pr.pipeline_job_id = pj.id
  WHERE pj.candidate_id = ?
  ORDER BY pr.started_at DESC
  LIMIT 10
`).all(cand.id)

console.log('\nRecent pipeline runs:')
runs.forEach(r => {
  console.log(`  job_type=${r.job_type}  status=${r.status}  discovered=${r.jobs_discovered}  deduped=${r.jobs_deduplicated}  completed=${r.completed_at}`)
})

db.close()
