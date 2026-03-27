import "./globals.css";
import Link from 'next/link';

export const metadata = {
  title: "AI-Powered RAG Tutor",
  description: "A course-aware AI tutor with Socratic guidance",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="app-container">
          <aside className="sidebar glass-panel">
            <h1>Nexus</h1>
            <nav style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
              <Link href="/" className="nav-link">💬 Student Chat</Link>
              <Link href="/dashboard" className="nav-link">📊 Faculty Dashboard</Link>
            </nav>
            <div style={{marginTop: 'auto', fontSize: '12px', color: 'var(--text-secondary)'}}>
              v1.0 • Course-Aware AI
            </div>
          </aside>
          <main className="main-content">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
