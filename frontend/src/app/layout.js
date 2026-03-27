import "./globals.css";
import RoleSidebarNav from '../components/RoleSidebarNav';

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
            <RoleSidebarNav />
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
