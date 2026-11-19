// Run against a disposable PostgreSQL database after npm run migrate.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { db } from '../src/db.ts';
import { knowledgeToolId, maxKnowledgeFileBytes } from '../src/knowledge.ts';
import { memory, storage } from '../src/mastra/storage.ts';
import { employeeRuntime, employeeTools } from '../src/mastra/tools.ts';
import { routes } from '../src/routes.ts';
import { POST as forwardUpload } from '../web/app/api/agentops/[...path]/route.ts';

const owner = randomUUID();
const otherOwner = randomUUID();
const member = randomUUID();
const company = randomUUID();
const other = randomUUID();
const thread = randomUUID();
const resource = 'knowledge-test:' + thread;
const excerpt = 'The cobalt reimbursement ceiling is twelve lanterns.';

async function call(companyId, userId, method, path = '', body, incomingRequest) {
  const uri = '/agentops/v1/companies/:companyId/knowledge' + (method === 'DELETE' ? '/:sourceId' : path);
  const route = routes.find(route => route.path === uri && route.method === method);
  assert.ok(route, uri);
  const multipart = body instanceof FormData;
  const raw = incomingRequest ?? new Request('http://localhost/knowledge', {
    method, headers: multipart ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined || multipart ? body : JSON.stringify(body),
  });
  const context = {
    req: { raw, param: name => name === 'companyId' ? companyId : path.slice(1), json: () => raw.json() },
    get: () => new Map([['user', { id: userId }]]),
    json: (data, status) => Response.json(data, { status }),
  };
  const response = await route.handler(context);
  return { status: response.status, body: await response.json() };
}

async function uploadThroughWeb(form) {
  const api = createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/agentops/v1/companies/' + company + '/knowledge');
      assert.equal(request.headers.authorization, 'Bearer test-owner');
      const raw = new Request('http://localhost/knowledge', {
        method: 'POST', headers: request.headers, body: Readable.toWeb(request), duplex: 'half',
      });
      const result = await call(company, owner, 'POST', '', undefined, raw);
      response.writeHead(result.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(result.body));
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const previousOrigin = process.env.AGENTOPS_API_URL;
  process.env.AGENTOPS_API_URL = 'http://127.0.0.1:' + api.address().port;
  try {
    const response = await forwardUpload(new Request('http://localhost/knowledge', {
      method: 'POST', headers: { Authorization: 'Bearer test-owner' }, body: form,
    }), { params: Promise.resolve({ path: ['companies', company, 'knowledge'] }) });
    return { status: response.status, body: await response.json() };
  } finally {
    if (previousOrigin === undefined) delete process.env.AGENTOPS_API_URL;
    else process.env.AGENTOPS_API_URL = previousOrigin;
    await new Promise(resolve => api.close(resolve));
  }
}

function file(name, text) {
  const form = new FormData();
  form.set('file', new File([text], name));
  return form;
}

function samplePdf() {
  const stream = 'BT /F1 12 Tf 20 50 Td (Chromium travel policy) Tj ET\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return String(offset).padStart(10, '0');
  });
  return pdf + `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => offset + ' 00000 n \n').join('')}` +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${pdf.length}\n%%EOF\n`;
}

try {
  await db.query('insert into agentops.users (id) values ($1), ($2), ($3)', [owner, otherOwner, member]);
  await db.query("insert into agentops.companies (id, owner_id, name) values ($1, $2, 'Knowledge test A'), ($3, $4, 'Knowledge test B')",
    [company, owner, other, otherOwner]);
  await db.query('insert into agentops.company_members (company_id, user_id) values ($1, $2)', [company, member]);
  const initial = await uploadThroughWeb(file('Expenses.md', excerpt));
  assert.equal(initial.status, 201);
  const { id: sourceId } = initial.body.source;
  assert.equal((await call(company, owner, 'GET')).body[0].id, sourceId);
  const repeated = await call(company, owner, 'POST', '', file('Duplicate.md', excerpt));
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.source.id, sourceId);
  assert.equal((await call(other, otherOwner, 'POST', '', file('Other.txt', 'The cobalt allowance is thirty.'))).status, 201);
  assert.equal((await call(company, member, 'GET')).status, 404);
  assert.equal((await call(company, member, 'POST', '', file('Denied.txt', excerpt))).status, 404);
  assert.equal((await call(company, member, 'POST', '/search', { query: 'cobalt' })).status, 404);
  assert.equal((await call(other, otherOwner, 'DELETE', '/' + sourceId)).status, 404);
  assert.equal((await call(company, owner, 'POST', '', file('Large.txt', 'a'.repeat(maxKnowledgeFileBytes + 9000)))).status, 400);
  assert.equal((await call(company, owner, 'POST', '', file('Broken.pdf', '%PDF-1.4\n'))).status, 400);
  const pdf = await call(company, owner, 'POST', '', file('Travel.pdf', samplePdf()));
  assert.equal(pdf.status, 201, JSON.stringify(pdf.body));
  const travel = await call(company, owner, 'POST', '/search', { query: 'chromium travel' });
  assert.equal(travel.body[0].page, 1);
  assert.equal(travel.body[0].name, 'Travel.pdf');
  const search = await call(company, owner, 'POST', '/search', { query: 'How do cobalt reimbursements work?' });
  assert.equal(search.status, 200);
  assert.deepEqual(search.body.map(result => result.excerpt), [excerpt]);
  assert.deepEqual((await call(company, owner, 'POST', '/search', { query: 'the and' })).body, []);
  const longDocument = Array.from({ length: 14 }, (_, index) =>
    `Annex ${index + 1} describes the zigzag policy. ` + 'Separate instructions for employee equipment. '.repeat(15),
  ).join('\n\n');
  const longUpload = await call(company, owner, 'POST', '', file('Annexes.txt', longDocument));
  assert.equal(longUpload.status, 201);
  assert.ok(longUpload.body.source.chunk_count > 8);
  const bounded = await call(company, owner, 'POST', '/search', { query: 'zigzag' });
  assert.equal(bounded.body.length, 4);
  assert.ok(bounded.body.every(match => match.excerpt.length <= 900));

  const grant = [knowledgeToolId];
  const runtime = await employeeRuntime(company, [{ tool_ids: grant }, { tool_ids: [] }]);
  assert.equal(Object.hasOwn(employeeTools([], runtime.connected), knowledgeToolId), false);
  const tool = employeeTools(grant, runtime.connected)[knowledgeToolId];
  const result = await tool.execute({ query: 'cobalt reimbursement' }, {});
  assert.deepEqual(result.sources.map(source => source.excerpt), [excerpt]);
  assert.equal((await tool.execute({ query: 'chromium travel' }, {})).status, 'matches');
  assert.equal((await tool.execute({ query: 'third search' }, {})).status, 'search-limit-reached');

  await memory.createThread({ threadId: thread, resourceId: resource });
  const toolInvocation = { state: 'result', toolCallId: randomUUID(), toolName: knowledgeToolId, args: { query: 'cobalt' }, result };
  await memory.saveMessages({ messages: [{
    id: randomUUID(), role: 'assistant', createdAt: new Date(), threadId: thread, resourceId: resource,
    content: { format: 2, parts: [{ type: 'tool-invocation', toolInvocation }], toolInvocations: [toolInvocation] },
  }] });
  const { messages } = await memory.recall({ threadId: thread, resourceId: resource, perPage: 10 });
  assert.equal(messages.length, 1);
  assert.ok(JSON.stringify(messages).includes('Expenses.md'));
  assert.ok(!JSON.stringify(messages).includes(excerpt));

  assert.equal((await call(company, owner, 'DELETE', '/' + sourceId)).status, 200);
  assert.deepEqual((await call(company, owner, 'POST', '/search', { query: 'cobalt' })).body, []);
  console.log('Knowledge upload, PDF citations, retry, authorization, retrieval, tool limits, memory, and deletion passed.');
} finally {
  try {
    if (await memory.getThreadById({ threadId: thread })) await memory.deleteThread(thread);
    await db.query('delete from agentops.company_members where company_id = $1', [company]);
    await db.query('delete from agentops.companies where id in ($1, $2)', [company, other]);
    await db.query('delete from agentops.users where id in ($1, $2, $3)', [owner, otherOwner, member]);
  } finally {
    await Promise.all([db.end(), storage.pool.end()]);
  }
}
