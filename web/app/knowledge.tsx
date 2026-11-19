'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { FileText, Search, Upload } from 'lucide-react';
import { type Api, dateLabel } from './data';
import { Button } from './ui/button';

type Source = { id: string; name: string; chunk_count: number; created_at: string };
type Match = { sourceId: string; name: string; position: number; page: number | null; excerpt: string };

export function Knowledge({ api, owner, openPeople }: { api: Api; owner: boolean; openPeople: () => void }) {
  const [sources, setSources] = useState<Source[]>();
  const [matches, setMatches] = useState<Match[]>();
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [searchError, setSearchError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!owner) return;
    let active = true;
    api<Source[]>('/knowledge').then(rows => { if (active) setSources(rows); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [api, owner]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get('file');
    setError('');
    setNotice('');
    if (!(file instanceof File) || !file.size || file.size > 2 * 1024 * 1024) {
      setError('Choose a file between 1 byte and 2 MiB.');
      return;
    }
    setBusy(true);
    try {
      const { source, duplicate } = await api<{ source: Source; duplicate: boolean }>('/knowledge', 'POST', data);
      setSources(rows => rows?.some(row => row.id === source.id) ? rows : [source, ...(rows ?? [])]);
      setNotice(duplicate ? `${source.name} is already indexed.` : `${source.name} is ready to search.`);
      form.reset();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(source: Source) {
    if (!window.confirm(`Remove "${source.name}" from company knowledge?`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('/knowledge/' + source.id, 'DELETE');
      setSources(rows => rows?.filter(row => row.id !== source.id));
      setMatches(rows => rows?.filter(row => row.sourceId !== source.id));
      setNotice(`${source.name} was removed.`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not remove the document.');
    } finally {
      setBusy(false);
    }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new FormData(event.currentTarget).get('query');
    setSearching(true);
    setSearchError('');
    setMatches(undefined);
    try {
      setMatches(await api<Match[]>('/knowledge/search', 'POST', { query }));
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  }

  if (!owner) return <section className="panel"><p className="empty">A workspace owner manages company documents and employee access.</p></section>;

  return <div className="columns">
    <section className="panel">
      <div className="panel-head"><h2>Company documents</h2>{sources && <span className="muted">{sources.length} / 100</span>}</div>
      <div className="pad">
        <p className="muted">Upload policies, procedures, and other references that employees may cite in replies and tasks.</p>
        <form className="form" onSubmit={upload}>
          <label>Document<input name="file" type="file" accept=".txt,.md,.csv,.pdf" aria-describedby="knowledge-formats" required disabled={busy || !sources} /></label>
          <small id="knowledge-formats">TXT, Markdown, CSV, or text-based PDF · up to 2 MiB.</small>
          <Button disabled={busy || !sources}><Upload size={16} />{busy ? 'Working…' : 'Upload document'}</Button>
        </form>
        {error && <p role="alert" className="error">{error}</p>}
        {notice && <p role="status" className="muted">{notice}</p>}
      </div>
      {!sources && !error && <p className="empty">Loading documents…</p>}
      {sources?.length === 0 && <p className="empty">Your workspace has no documents yet.</p>}
      {sources?.map(source => <div className="row" key={source.id}>
        <div className="person"><FileText size={17} /><div className="min-w-0">
          <strong title={source.name}>{source.name}</strong>
          <small>{source.chunk_count} {source.chunk_count === 1 ? 'excerpt' : 'excerpts'} · {dateLabel(source.created_at)}</small>
        </div></div>
        <Button variant="outline" type="button" disabled={busy || searching} aria-label={`Remove ${source.name}`} onClick={() => void remove(source)}>Remove</Button>
      </div>)}
    </section>
    <section className="panel">
      <div className="panel-head"><h2>Test retrieval</h2></div>
      <div className="pad">
        <p>Preview the excerpts an employee can find. Try a policy name or a few specific keywords.</p>
        <form className="form" onSubmit={search}>
          <label>Search company documents<input name="query" type="search" minLength={2} maxLength={300} required /></label>
          <Button disabled={searching || busy || !sources?.length}><Search size={16} />{searching ? 'Searching…' : 'Search'}</Button>
        </form>
        {searchError && <p role="alert" className="error">{searchError}</p>}
        {matches?.length === 0 && <p role="status" className="muted">No matching excerpts. Try more specific keywords.</p>}
      </div>
      {matches?.map(match => <article className="pad border-t border-[var(--line)]" key={match.sourceId + ':' + match.position}>
        <h3 className="prewrap">{match.name}</h3>
        <small>{match.page ? `Page ${match.page} · ` : ''}Excerpt {match.position}</small>
        <p className="prewrap mt-2">{match.excerpt}</p>
      </article>)}
      <div className="pad border-t border-[var(--line)]">
        <p>Enable <strong>Search company knowledge</strong> for each employee who should use these documents.</p>
        <Button className="mt-3" variant="outline" type="button" onClick={openPeople}>Manage employee tools</Button>
      </div>
    </section>
  </div>;
}
