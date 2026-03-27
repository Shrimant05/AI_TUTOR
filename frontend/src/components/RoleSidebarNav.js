"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LayoutDashboard, MessageSquare, LogIn, UserPlus } from 'lucide-react';
import { loadAuthSession, syncAuthSessionWithServer } from '../lib/authStorage';

// ─── Scoped styles matching main page token system ──────────────────────────
const NAV_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700;12..96,800&family=DM+Mono:wght@400;500&display=swap');

  :root {
    --accent:     #3dd6f5;
    --accent2:    #7c6ef5;
    --surface:    rgba(255,255,255,0.032);
    --surface-hi: rgba(255,255,255,0.06);
    --border:     rgba(255,255,255,0.065);
    --border-hi:  rgba(99,210,255,0.25);
    --text:       #dce8f0;
    --text-2:     #7a8fa0;
    --text-3:     #3d5060;
    --radius-sm:  9px;
    --display:    'Bricolage Grotesque', sans-serif;
    --mono:       'DM Mono', monospace;
    --ease:       cubic-bezier(.22,.68,0,1.2);
  }

  /* ── Logo block ── */
  .snav-logo {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0 6px 20px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 12px;
  }

  .snav-logo-ring {
    width: 44px; height: 44px;
    border-radius: 12px;
    background: linear-gradient(135deg, rgba(61,214,245,0.15), rgba(124,110,245,0.12));
    border: 1px solid rgba(61,214,245,0.2);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 0 20px rgba(61,214,245,0.08);
    flex-shrink: 0;
  }

  .snav-logo-ring img {
    width: 28px; height: 28px; object-fit: contain;
  }

  .snav-wordmark {
    font-family: var(--display);
    font-size: 1.25rem;
    font-weight: 800;
    letter-spacing: -0.04em;
    line-height: 1;
    background: linear-gradient(135deg, #e8f4ff 20%, var(--accent) 70%, var(--accent2) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .snav-tagline {
    font-family: var(--mono);
    font-size: 0.62rem;
    color: var(--text-3);
    letter-spacing: 0.06em;
    line-height: 1;
  }

  /* ── Nav section label ── */
  .snav-section-label {
    font-family: var(--mono);
    font-size: 0.6rem;
    font-weight: 500;
    color: var(--text-3);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 0 10px;
    margin-bottom: 4px;
  }

  /* ── Nav links ── */
  .snav-nav {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .snav-link {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    color: var(--text-2);
    font-family: var(--display);
    font-size: 0.875rem;
    font-weight: 600;
    text-decoration: none;
    border: 1px solid transparent;
    transition: background 0.18s var(--ease),
                border-color 0.18s,
                color 0.18s,
                transform 0.15s var(--ease);
    cursor: pointer;
  }

  .snav-link:hover {
    background: var(--surface-hi);
    border-color: var(--border);
    color: var(--text);
    transform: translateX(2px);
  }

  .snav-link.primary {
    background: rgba(61,214,245,0.07);
    border-color: rgba(61,214,245,0.15);
    color: var(--accent);
  }

  .snav-link.primary:hover {
    background: rgba(61,214,245,0.12);
    border-color: rgba(61,214,245,0.3);
    color: var(--accent);
    transform: translateX(2px);
  }

  .snav-link.ghost {
    background: transparent;
    border-color: transparent;
    color: var(--text-2);
  }

  .snav-link-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px; height: 28px;
    border-radius: 7px;
    background: rgba(255,255,255,0.04);
    border: 1px solid var(--border);
    flex-shrink: 0;
    transition: background 0.18s, border-color 0.18s;
  }

  .snav-link.primary .snav-link-icon {
    background: rgba(61,214,245,0.1);
    border-color: rgba(61,214,245,0.2);
  }

  .snav-link:hover .snav-link-icon {
    background: rgba(255,255,255,0.07);
    border-color: var(--border-hi);
  }

  .snav-link.primary:hover .snav-link-icon {
    background: rgba(61,214,245,0.16);
    border-color: rgba(61,214,245,0.35);
  }

  /* ── Skeleton loader ── */
  .snav-skeleton {
    display: flex; flex-direction: column; gap: 6px; padding: 0 2px;
  }

  .snav-skel-bar {
    height: 38px; border-radius: var(--radius-sm);
    background: var(--surface);
    border: 1px solid var(--border);
    animation: skelPulse 1.6s ease-in-out infinite;
  }

  .snav-skel-bar:nth-child(2) { animation-delay: 0.15s; opacity: 0.7; }

  @keyframes skelPulse {
    0%, 100% { opacity: 0.4; }
    50%       { opacity: 0.8; }
  }
`;

// ─── Individual nav link ─────────────────────────────────────────────────────
function NavLink({ href, icon: Icon, label, variant = "ghost" }) {
  return (
    <Link href={href} className={`snav-link ${variant}`}>
      <span className="snav-link-icon">
        <Icon size={13} strokeWidth={2.2} />
      </span>
      {label}
    </Link>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function RoleSidebarNav() {
  const [role, setRole]       = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initializeRole = async () => {
      const session = loadAuthSession();
      setHasToken(Boolean(session.token));

      if (!session.token) {
        setRole("");
        setLoading(false);
        return;
      }

      const synced = await syncAuthSessionWithServer(session.token);
      setRole((synced?.role || session.role || "").toLowerCase());
      setLoading(false);
    };

    initializeRole();
  }, []);

  return (
    <>
      <style>{NAV_STYLES}</style>

      {/* ── Logo block ── */}
      <div className="snav-logo">
        <div className="snav-logo-ring">
          <img src="/logo.jpeg" alt="EDUXA logo" />
        </div>
        <div>
          <div className="snav-wordmark">EDUXA</div>
          <div className="snav-tagline">AI-powered learning</div>
        </div>
      </div>

      {/* ── Nav links ── */}
      {loading && hasToken ? (
        <div className="snav-skeleton">
          <div className="snav-skel-bar" />
          <div className="snav-skel-bar" />
        </div>
      ) : (
        <nav className="snav-nav">
          {role === "faculty" ? (
            <>
              <p className="snav-section-label">Faculty</p>
              <NavLink
                href="/dashboard"
                icon={LayoutDashboard}
                label="Dashboard"
                variant="primary"
              />
            </>
          ) : role === "student" ? (
            <>
              <p className="snav-section-label">Student</p>
              <NavLink
                href="/student"
                icon={MessageSquare}
                label="AI Tutor Chat"
                variant="primary"
              />
            </>
          ) : !hasToken ? (
            <>
              <p className="snav-section-label">Account</p>
              <NavLink href="/login"    icon={LogIn}    label="Sign In"  variant="ghost" />
              <NavLink href="/register" icon={UserPlus} label="Register" variant="ghost" />
            </>
          ) : null}
        </nav>
      )}
    </>
  );
}