import type { Metadata } from 'next';
import './globals.css';
import '@xyflow/react/dist/style.css';

export const metadata: Metadata = {
  title: 'AgentOps',
  description: 'Operate your AI team and follow its work.',
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
