"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, ArrowRight, LogIn, UserPlus, Brain, BookOpen, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  loadAuthSession,
  clearAuthSession,
  syncAuthSessionWithServer,
} from "../lib/authStorage";

const LANDING_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300;12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&family=DM+Mono:wght@300;400;500&display=swap');

  :root {
    --bg:          #05080f;
    --bg2:         #080d18;
    --surface:     rgba(255,255,255,0.035);
    --surface-hi:  rgba(255,255,255,0.07);
    --border:      rgba(255,255,255,0.08);
    --border-hi:   rgba(99,210,255,0.28);
    --accent:      #3dd6f5;
    --accent2:     #7c6ef5;
    --text:        #dce8f0;
    --text-2:      #7a8fa0;
    --text-3:      #3d5060;
    --radius:      16px;
    --radius-sm:   10px;
    --display:     'Bricolage Grotesque', sans-serif;
    --mono:        'DM Mono', monospace;
    --ease:        cubic-bezier(.22,.68,0,1.2);
  }

  .lp-root, .lp-root * { box-sizing: border-box; }
  .lp-root {
    min-height: 100vh;
    background: radial-gradient(circle at 20% 20%, #0e1a32 0%, var(--bg) 45%), var(--bg);
    color: var(--text);
    font-family: var(--display);
    overflow: hidden;
    position: relative;
  }

  .lp-bg { position: fixed; inset: 0; pointer-events: none; z-index: 0; }
  .lp-orb {
    position: absolute;
    border-radius: 999px;
    filter: blur(90px);
    opacity: 0.55;
    animation: drift 17s ease-in-out infinite alternate;
  }
  .lp-orb.one {
    width: 520px; height: 520px; right: -120px; top: -140px;
    background: radial-gradient(circle, rgba(61,214,245,0.2), transparent 70%);
  }
  .lp-orb.two {
    width: 460px; height: 460px; left: -140px; bottom: -180px;
    background: radial-gradient(circle, rgba(124,110,245,0.18), transparent 70%);
    animation-delay: -5s;
  }
  .lp-orb.three {
    width: 300px; height: 300px; left: 45%; top: 40%;
    background: radial-gradient(circle, rgba(61,214,245,0.1), transparent 70%);
    animation-delay: -9s;
  }
  @keyframes drift {
    from { transform: translate(0, 0) scale(1); }
    to { transform: translate(20px, 24px) scale(1.08); }
  }

  .lp-wrap {
    max-width: 1120px;
    margin: 0 auto;
    padding: 32px 22px 80px;
    position: relative;
    z-index: 2;
  }

  .lp-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 70px;
  }

  .lp-brand {
    display: flex;
    align-items: center;
    gap: 12px;
    text-decoration: none;
    color: inherit;
  }
  .lp-brand img {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    object-fit: cover;
    border: 1px solid rgba(99,210,255,0.3);
    box-shadow: 0 0 24px rgba(61,214,245,0.24);
  }
  .lp-brand-text {
    font-size: 1.38rem;
    line-height: 1;
    letter-spacing: -0.03em;
    font-weight: 800;
    background: linear-gradient(140deg, #e8f4ff 18%, var(--accent) 62%, var(--accent2) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .lp-top-links {
    display: flex;
    gap: 10px;
  }

  .lp-link {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 10px 14px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    text-decoration: none;
    color: var(--text-2);
    background: rgba(255,255,255,0.02);
    font-size: 0.86rem;
    font-weight: 600;
    transition: all 0.2s;
  }
  .lp-link:hover {
    border-color: var(--border-hi);
    color: var(--text);
    background: var(--surface);
  }

  .lp-hero {
    display: grid;
    grid-template-columns: 1.2fr 0.8fr;
    gap: 20px;
    align-items: stretch;
  }

  .lp-hero-main,
  .lp-hero-side {
    border: 1px solid var(--border);
    background: linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.01));
    border-radius: var(--radius);
    backdrop-filter: blur(14px);
  }

  .lp-hero-main {
    padding: 34px;
    display: flex;
    flex-direction: column;
    gap: 22px;
  }

  .lp-badge {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    width: fit-content;
    padding: 5px 12px;
    border-radius: 999px;
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
    border: 1px solid rgba(61,214,245,0.26);
    background: rgba(61,214,245,0.08);
    font-family: var(--mono);
  }

  .lp-title {
    font-size: clamp(2rem, 4.8vw, 3.3rem);
    line-height: 1.06;
    letter-spacing: -0.04em;
    font-weight: 800;
  }

  .lp-sub {
    color: var(--text-2);
    line-height: 1.75;
    max-width: 62ch;
    font-size: 1rem;
  }

  .lp-cta {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }

  .lp-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 18px;
    border-radius: var(--radius-sm);
    text-decoration: none;
    font-weight: 700;
    font-size: 0.9rem;
    border: 1px solid transparent;
    transition: transform 0.15s, box-shadow 0.2s, background 0.2s;
  }
  .lp-btn:hover { transform: translateY(-1px); }
  .lp-btn.primary {
    color: #04121a;
    background: linear-gradient(135deg, var(--accent), #5ab8d4);
    box-shadow: 0 10px 28px rgba(61,214,245,0.24);
  }
  .lp-btn.secondary {
    color: var(--text);
    background: var(--surface);
    border-color: var(--border);
  }
  .lp-btn.secondary:hover { border-color: var(--border-hi); }

  .lp-hero-side {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .lp-side-head {
    font-size: 0.72rem;
    font-family: var(--mono);
    color: var(--text-3);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .lp-feature {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: rgba(255,255,255,0.02);
  }
  .lp-feature svg {
    color: var(--accent);
    margin-top: 2px;
    flex-shrink: 0;
  }
  .lp-feature h4 { font-size: 0.9rem; margin: 0 0 4px; }
  .lp-feature p {
    margin: 0;
    color: var(--text-2);
    font-size: 0.82rem;
    line-height: 1.45;
  }

  .lp-loading {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-2);
    font-family: var(--mono);
    font-size: 0.82rem;
  }

  @media (max-width: 900px) {
    .lp-wrap { padding-top: 24px; }
    .lp-top { margin-bottom: 24px; flex-wrap: wrap; gap: 12px; }
    .lp-hero { grid-template-columns: 1fr; }
    .lp-hero-main, .lp-hero-side { padding: 22px; }
  }
`;

export default function LandingPage() {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const redirectIfAuthenticated = async () => {
      try {
        if (sessionStorage.getItem("logout_in_progress") === "1") {
          sessionStorage.removeItem("logout_in_progress");
          clearAuthSession();
          setCheckingSession(false);
          return;
        }

        const session = loadAuthSession();
        if (!session.token) {
          setCheckingSession(false);
          return;
        }

        const synced = await syncAuthSessionWithServer(session.token);
        if (!synced) {
          clearAuthSession();
          setCheckingSession(false);
          return;
        }

        const role = (synced.role || session.role || "").toLowerCase();
        if (role === "faculty") {
          router.replace("/dashboard");
          return;
        }
        if (role === "student") {
          router.replace("/student");
          return;
        }
      } catch {
        clearAuthSession();
      }

      setCheckingSession(false);
    };

    redirectIfAuthenticated();
  }, [router]);

  if (checkingSession) {
    return (
      <>
        <style>{LANDING_STYLES}</style>
        <div className="lp-root">
          <div className="lp-loading">checking session...</div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{LANDING_STYLES}</style>
      <div className="lp-root">
        <div className="lp-bg">
          <div className="lp-orb one" />
          <div className="lp-orb two" />
          <div className="lp-orb three" />
        </div>

        <div className="lp-wrap">
          <header className="lp-top">
            <Link href="/" className="lp-brand">
              <img src="/logo.jpeg" alt="EDUXA logo" />
              <span className="lp-brand-text">EDUXA</span>
            </Link>

            <div className="lp-top-links">
              <Link href="/login" className="lp-link">
                <LogIn size={14} /> Sign In
              </Link>
              <Link href="/register" className="lp-link">
                <UserPlus size={14} /> Register
              </Link>
            </div>
          </header>

          <section className="lp-hero">
            <div className="lp-hero-main">
              <div className="lp-badge">
                <Sparkles size={11} /> Socratic AI Tutor
              </div>

              <h1 className="lp-title">Learn with guidance, not shortcuts.</h1>
              <p className="lp-sub">
                EDUXA helps students reason through course material with context-aware tutoring,
                grounded citations, and classroom-specific resources.
              </p>

              <div className="lp-cta">
                <Link href="/login" className="lp-btn primary">
                  Start Learning <ArrowRight size={14} />
                </Link>
                <Link href="/register" className="lp-btn secondary">
                  Create Account
                </Link>
              </div>
            </div>

            <aside className="lp-hero-side">
              <p className="lp-side-head">What you get</p>

              <div className="lp-feature">
                <Brain size={16} />
                <div>
                  <h4>Socratic prompts</h4>
                  <p>Guided answers that build understanding instead of giving away solutions.</p>
                </div>
              </div>

              <div className="lp-feature">
                <BookOpen size={16} />
                <div>
                  <h4>Course-grounded responses</h4>
                  <p>Chat responses use classroom notes and include citations to source material.</p>
                </div>
              </div>

              <div className="lp-feature">
                <ShieldCheck size={16} />
                <div>
                  <h4>Role-aware experience</h4>
                  <p>Separate student and faculty experiences with secure authenticated access.</p>
                </div>
              </div>
            </aside>
          </section>
        </div>
      </div>
    </>
  );
}
