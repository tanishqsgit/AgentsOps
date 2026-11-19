'use client';

import { useRef, useState } from 'react';
import { getToolName, isToolUIPart, type UIMessage } from 'ai';
import { ExternalLink, FileText, Globe2, Terminal, Wrench, X } from 'lucide-react';
import { Streamdown } from 'streamdown';
import { z } from 'zod';

const knowledgeOutput = z.object({
  status: z.string(),
  sources: z.array(z.object({ sourceId: z.string(), name: z.string(), position: z.number(),
    page: z.number().nullable() })),
});

function mediaUrl(value: unknown, image = false) {
  if (typeof value !== 'string') return;
  if (image && /^data:image\/(png|jpeg|webp|gif|avif);base64,/i.test(value)) return value;
  if (/^\/(?![\/\\])/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch { /* Unsupported source. */ }
}

function MessageImage({ src, alt }: { src: unknown; alt?: string }) {
  const url = mediaUrl(src, true);
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <p className="chat-media-unavailable">Image unavailable{alt ? ' · ' + alt : ''}</p>;
  return <img className="chat-image" src={url} alt={alt || 'Image from the agent'} loading="lazy" decoding="async"
    referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

const markdownComponents = {
  img: ({ src, alt }: { src?: unknown; alt?: string }) => <MessageImage key={String(src)} src={src} alt={alt} />,
};

const previewSchema = z.object({
  kind: z.enum(['browser', 'sandbox']),
  title: z.string().min(1),
  status: z.enum(['running', 'completed', 'failed']),
  url: z.string().optional(),
  imageUrl: z.string().optional(),
});
const imageOutput = z.object({ kind: z.literal('image'), url: z.string(), alt: z.string().optional() });

function SessionPreview({ data }: { data: z.infer<typeof previewSchema> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [opened, setOpened] = useState(false);
  const url = mediaUrl(data.url);
  const Icon = data.kind === 'browser' ? Globe2 : Terminal;
  const embed = data.kind === 'browser' && url?.startsWith('https://') &&
    new URL(url).hostname.endsWith('.browserbase.com') && data.status === 'running';
  return <div className="chat-artifact">
    <div className="artifact-label"><Icon size={16} /><div><strong>{data.title}</strong><small>{data.status}</small></div></div>
    {data.imageUrl && <MessageImage key={data.imageUrl} src={data.imageUrl} alt={data.title} />}
    {embed ? <>
      <button onClick={() => { setOpened(true); dialog.current?.showModal(); }}>Open live preview</button>
      <dialog className="preview-dialog" ref={dialog} aria-label={data.title} onClose={() => setOpened(false)}>
        <header className="panel-head"><h2>{data.title}</h2><button onClick={() => dialog.current?.close()} className="icon" aria-label="Close preview"><X size={16} /></button></header>
        {opened && <iframe src={url} title={data.title} sandbox="allow-scripts allow-same-origin" tabIndex={-1} referrerPolicy="no-referrer" />}
      </dialog>
    </> : url && <a className="artifact-link" href={url} target="_blank" rel="noreferrer">Open preview <ExternalLink size={13} /></a>}
  </div>;
}

export function AgentMarkdown({ text, streaming = false, className = 'chat-markdown' }: {
  text: string; streaming?: boolean; className?: string;
}) {
  return <Streamdown className={className} mode={streaming ? 'streaming' : 'static'} isAnimating={streaming}
    components={markdownComponents}>{text}</Streamdown>;
}

export function ChatPart({ part, streaming }: { part: UIMessage['parts'][number]; streaming: boolean }) {
  if (part.type === 'text') return <AgentMarkdown text={part.text} streaming={streaming} />;
  if (part.type === 'file') {
    if (part.mediaType.startsWith('image/')) return <MessageImage key={part.url} src={part.url} alt={part.filename} />;
    const url = mediaUrl(part.url);
    return url ? <a className="artifact-link" href={url} target="_blank" rel="noreferrer"><FileText size={14} />{part.filename || 'Open attachment'}</a> : null;
  }
  if (part.type === 'source-url') {
    const url = mediaUrl(part.url);
    return url ? <a className="artifact-link" href={url} target="_blank" rel="noreferrer">{part.title || url}<ExternalLink size={13} /></a> : null;
  }
  if (part.type === 'data-preview') {
    const result = previewSchema.safeParse(part.data);
    return result.success ? <SessionPreview data={result.data} /> : null;
  }
  if (isToolUIPart(part)) {
    const output = part.state === 'output-available' ? part.output : undefined;
    const name = getToolName(part);
    const image = imageOutput.safeParse(output);
    if (image.success) return <MessageImage key={image.data.url} src={image.data.url} alt={image.data.alt} />;
    const preview = previewSchema.safeParse(output);
    if (preview.success) return <SessionPreview data={preview.data} />;
    const status = part.state === 'output-available' ? 'Completed' : part.state === 'output-error' ? 'Failed'
      : part.state === 'approval-requested' ? 'Awaiting approval' : part.state === 'output-denied' ? 'Declined' : 'Working';
    if (name === 'company-knowledge') {
      const result = knowledgeOutput.safeParse(output);
      const sources = result.success ? result.data.sources : [];
      return <details className="chat-artifact">
        <summary><FileText size={14} />Company knowledge<small>{sources.length ? `${sources.length} excerpts` : status}</small></summary>
        {sources.length > 0 && <ul className="p-3 list-disc list-inside">
          {sources.map(source => <li className="prewrap" key={source.sourceId + ':' + source.position}>
            {source.name} · {source.page ? `Page ${source.page} · ` : ''}Excerpt {source.position}
          </li>)}
        </ul>}
        {result.success && sources.length === 0 && <p>{result.data.status === 'search-limit-reached' ? 'Search budget reached.' : 'No matching excerpts.'}</p>}
        {part.state === 'output-error' && <p>The knowledge search failed.</p>}
      </details>;
    }
    return <details className="chat-artifact">
      <summary><Wrench size={14} />{name.replace(/[-_]/g, ' ')}<small>{status}</small></summary>
      {part.state === 'output-error' ? <p>{part.errorText}</p>
        : output !== undefined && <pre>{typeof output === 'string' ? output : JSON.stringify(output, null, 2)}</pre>}
    </details>;
  }
  return null;
}
