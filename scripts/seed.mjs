const { AGENTOPS_API_URL = 'http://127.0.0.1:4111', SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
  AGENTOPS_TEST_EMAIL, AGENTOPS_TEST_PASSWORD } = process.env;
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !AGENTOPS_TEST_EMAIL || !AGENTOPS_TEST_PASSWORD) {
  throw new Error('Set the Supabase URL, publishable key, AGENTOPS_TEST_EMAIL, and AGENTOPS_TEST_PASSWORD.');
}

const login = await fetch(new URL('/auth/v1/token?grant_type=password', SUPABASE_URL), {
  method: 'POST',
  headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: AGENTOPS_TEST_EMAIL, password: AGENTOPS_TEST_PASSWORD }),
});
if (!login.ok) throw new Error('Supabase demo login failed (' + login.status + ').');
const { access_token } = await login.json();

async function api(path, body) {
  const response = await fetch(new URL('/agentops/v1' + path, AGENTOPS_API_URL), {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(path + ' failed (' + response.status + '): ' + (data.error ?? 'unknown error'));
  return data;
}

const companyName = 'AgentOps Demo';
const company = (await api('/companies')).find(row => row.name === companyName && row.access === 'owner')
  ?? await api('/companies', { name: companyName });
const workspace = '/companies/' + company.id;
const employees = await api(workspace + '/employees');
const avery = employees.find(employee => employee.name === 'Avery') ?? await api(workspace + '/employees', {
  name: 'Avery', role: 'Release lead',
  instructions: 'Turn supplied product feedback into concise release briefs. Ask a teammate to audit feedback when available.',
});
const morgan = employees.find(employee => employee.name === 'Morgan') ?? await api(workspace + '/employees', {
  name: 'Morgan', role: 'Feedback analyst',
  instructions: 'Find repeated product feedback, identify themes and provide counts using the feedback audit tool.',
  toolIds: ['feedback-audit'],
});
const team = (await api(workspace + '/teams')).find(team => team.name === 'Release team') ?? await api(workspace + '/teams', {
  name: 'Release team', leadEmployeeId: avery.id, employeeIds: [avery.id, morgan.id],
});
const panel = (await api(workspace + '/teams')).find(team => team.name.toLowerCase() === 'panel') ?? await api(workspace + '/teams', {
  name: 'Panel', leadEmployeeId: avery.id, employeeIds: [avery.id, morgan.id],
});
console.log(JSON.stringify({ companyId: company.id, employeeIds: [avery.id, morgan.id], teamId: team.id, panelId: panel.id }, null, 2));
