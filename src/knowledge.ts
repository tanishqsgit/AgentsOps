import { createHash } from 'node:crypto';
import { MDocument } from '@mastra/rag';
import { getResolvedPDFJS } from 'unpdf';
import { db } from './db.ts';

export const maxKnowledgeFileBytes = 2 * 1024 * 1024;
export const knowledgeToolId = 'company-knowledge';
const maxKnowledgeUploadBytes = maxKnowledgeFileBytes + 8192;
const maxTextLength = 200_000;
const maxPdfPages = 75;
const maxChunks = 400;
const maxSources = 100;
const excerptSize = 900;

export class KnowledgeInputError extends Error {}

type Source = { id: string; name: string; chunk_count: number; created_at: Date };
type Chunk = { position: number; page: number | null; excerpt: string };
export type KnowledgeMatch = Chunk & { sourceId: string; name: string };

export async function readKnowledgeFile(request: Request) {
  const type = request.headers.get('content-type');
  if (!type?.toLowerCase().startsWith('multipart/form-data;') || !request.body) {
    throw new KnowledgeInputError('Upload a multipart form with one file field.');
  }
  const reader = request.body.getReader();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxKnowledgeUploadBytes) {
        await reader.cancel();
        throw new KnowledgeInputError('Choose a file up to 2 MiB.');
      }
      parts.push(new Uint8Array(value));
    }
  } finally {
    reader.releaseLock();
  }
  const form = await new Response(new Blob(parts), { headers: { 'Content-Type': type } }).formData()
    .catch(() => { throw new KnowledgeInputError('Could not read the upload form.'); });
  const file = form.get('file');
  if (!(file instanceof File) || Array.from(form).length !== 1) {
    throw new KnowledgeInputError('Upload exactly one file.');
  }
  return file;
}

async function extractPages(file: File, extension: string) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (extension !== 'pdf') {
    try {
      return [new TextDecoder('utf-8', { fatal: true }).decode(bytes)];
    } catch {
      throw new KnowledgeInputError('Text documents must be encoded as UTF-8.');
    }
  }
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
    throw new KnowledgeInputError('This file does not have a valid PDF header.');
  }
  try {
    const { getDocument } = await getResolvedPDFJS();
    const loadingTask = getDocument({ data: bytes, stopAtErrors: true, useSystemFonts: true, verbosity: 0 });
    const timeout = setTimeout(() => { void loadingTask.destroy().catch(() => {}); }, 15_000);
    try {
      const pdf = await loadingTask.promise;
      if (pdf.numPages > maxPdfPages) throw new KnowledgeInputError('PDFs can contain up to 75 pages.');
      const pages: string[] = [];
      let length = 0;
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        const { items } = await page.getTextContent();
        const text = items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
        page.cleanup();
        length += text.length;
        if (length > maxTextLength) throw new KnowledgeInputError('Documents can contain up to 200,000 characters of text.');
        pages.push(text);
      }
      return pages;
    } finally {
      clearTimeout(timeout);
      if (!loadingTask.destroyed) await loadingTask.destroy();
    }
  } catch (error) {
    if (error instanceof KnowledgeInputError) throw error;
    throw new KnowledgeInputError('Could not read this PDF. Check that it opens and has no password.');
  }
}

export async function uploadKnowledge(companyId: string, file: File) {
  const name = file.name.replace(/[\x00-\x1f\x7f]/g, '').trim();
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (!name || name.length > 160 || !/\.(txt|md|csv|pdf)$/i.test(name)) {
    throw new KnowledgeInputError('Choose a TXT, Markdown, CSV, or text-based PDF with a filename up to 160 characters.');
  }
  if (file.size > maxKnowledgeFileBytes) throw new KnowledgeInputError('Choose a file up to 2 MiB.');
  const pages = (await extractPages(file, extension)).map(page => page.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim());
  if (!pages.some(Boolean)) throw new KnowledgeInputError('No readable text was found. For a scanned PDF, export it with OCR first.');
  if (pages.reduce((size, page) => size + page.length, 0) > maxTextLength) {
    throw new KnowledgeInputError('Documents can contain up to 200,000 characters of text.');
  }
  const hash = createHash('sha256').update(JSON.stringify({ paginated: extension === 'pdf', pages })).digest('hex');
  const chunks: Chunk[] = [];
  for (const [index, page] of pages.entries()) {
    if (!page) continue;
    const document = MDocument.fromText(page);
    for (const part of await document.chunk({ strategy: 'recursive', maxSize: excerptSize, overlap: 100 })) {
      const excerpt = part.text.trim();
      if (excerpt) chunks.push({ excerpt, position: chunks.length + 1, page: extension === 'pdf' ? index + 1 : null });
    }
  }
  if (!chunks.length || chunks.length > maxChunks) {
    throw new KnowledgeInputError('Split this document into smaller files before uploading it.');
  }

  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', ['knowledge:' + companyId]);
    const { rows: [existing] } = await client.query<Source>(
      'select id, name, chunk_count, created_at from agentops.knowledge_sources where company_id = $1 and content_hash = $2', [companyId, hash],
    );
    if (existing) {
      await client.query('commit');
      return { source: existing, duplicate: true };
    }
    const { rows: [source] } = await client.query<Source>(
      `insert into agentops.knowledge_sources (company_id, name, content_hash, chunk_count)
       select $1, $2, $3, $4 where (select count(*) from agentops.knowledge_sources where company_id = $1) < $5
       returning id, name, chunk_count, created_at`, [companyId, name, hash, chunks.length, maxSources],
    );
    if (!source) throw new KnowledgeInputError('This company already has 100 documents. Remove one before uploading another.');
    await client.query(
      `insert into agentops.knowledge_chunks (company_id, source_id, position, page, excerpt)
       select $1, $2, position, page, excerpt from jsonb_to_recordset($3::jsonb) as chunks(position integer, page integer, excerpt text)`,
      [companyId, source.id, JSON.stringify(chunks)],
    );
    await client.query('commit');
    return { source, duplicate: false };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function listKnowledge(companyId: string) {
  const { rows } = await db.query<Source>(
    'select id, name, chunk_count, created_at from agentops.knowledge_sources where company_id = $1 order by created_at desc, id',
    [companyId],
  );
  return rows;
}

export async function deleteKnowledge(companyId: string, sourceId: string) {
  const { rowCount } = await db.query('delete from agentops.knowledge_sources where company_id = $1 and id = $2', [companyId, sourceId]);
  return Boolean(rowCount);
}

export async function retrieveKnowledge(companyId: string, query: string, seen: string[] = []) {
  const { rows } = await db.query<KnowledgeMatch>(
    `with query as (
       select to_tsquery('simple', string_agg(quote_literal(term), ' | ')) as terms
       from unnest(tsvector_to_array(to_tsvector('english', $2))) as terms(term)
     )
     select source.id as "sourceId", source.name, chunk.position, chunk.page, chunk.excerpt
     from agentops.knowledge_chunks chunk
     join agentops.knowledge_sources source on source.company_id = chunk.company_id and source.id = chunk.source_id
     cross join query
     where chunk.company_id = $1 and chunk.search_vector @@ query.terms
       and (source.id::text || ':' || chunk.position) <> all($3::text[])
     order by ts_rank_cd(chunk.search_vector, query.terms, 32) desc, source.id, chunk.position
     limit 4`,
    [companyId, query, seen],
  );
  return rows;
}
