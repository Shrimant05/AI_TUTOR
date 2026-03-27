"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { Send, Book, Hash, LogOut, ArrowLeft, Plus, Download, Sparkles, ChevronRight, Zap, Brain, Target } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  loadAuthSession,
  clearAuthSession,
  syncAuthSessionWithServer,
} from "../../lib/authStorage";

// ─── Styles ──────────────────────────────────────────────────────────────────
const PAGE_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300;12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&family=DM+Mono:wght@300;400;500&display=swap');

  :root {
    --bg:          #05080f;
    --bg2:         #080d18;
    --surface:     rgba(255,255,255,0.032);
    --surface-hi:  rgba(255,255,255,0.06);
    --border:      rgba(255,255,255,0.065);
    --border-hi:   rgba(99,210,255,0.25);
    --accent:      #3dd6f5;
    --accent2:     #7c6ef5;
    --text:        #dce8f0;
    --text-2:      #7a8fa0;
    --text-3:      #3d5060;
    --danger:      #f75d6e;
    --radius:      14px;
    --radius-sm:   9px;
    --mono:        'DM Mono', monospace;
    --display:     'Bricolage Grotesque', sans-serif;
    --ease:        cubic-bezier(.22,.68,0,1.2);
  }

  /* ── Reset ── */
  .pg-root *, .pg-root *::before, .pg-root *::after { box-sizing: border-box; margin: 0; padding: 0; }
  .pg-root {
    font-family: var(--display);
    color: var(--text);
    background: var(--bg);
    overflow-x: hidden;
  }

  /* ── Locomotive scroll smooth container ── */
  html.loco-active { overflow: hidden; }
  .loco-container { overflow: hidden; }

  /* ── Fixed ambient background ── */
  .pg-bg {
    position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden;
  }
  .pg-orb {
    position: absolute; border-radius: 50%; filter: blur(110px); opacity: 0;
  }
  .pg-orb-1 {
    width: 600px; height: 600px; top: -160px; right: -120px;
    background: radial-gradient(circle, rgba(61,214,245,0.2) 0%, transparent 70%);
  }
  .pg-orb-2 {
    width: 480px; height: 480px; bottom: -120px; left: -100px;
    background: radial-gradient(circle, rgba(124,110,245,0.18) 0%, transparent 70%);
  }
  .pg-orb-3 {
    width: 320px; height: 320px; top: 45%; left: 38%;
    background: radial-gradient(circle, rgba(61,214,245,0.07) 0%, transparent 70%);
  }

  /* ── Grain overlay ── */
  .pg-grain {
    position: fixed; inset: 0; pointer-events: none; z-index: 1; opacity: 0.03;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 180px 180px;
  }

  /* ── Grid lines bg ── */
  .pg-grid {
    position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background-image:
      linear-gradient(rgba(61,214,245,0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(61,214,245,0.025) 1px, transparent 1px);
    background-size: 64px 64px;
    mask-image: radial-gradient(ellipse 80% 60% at 50% 50%, black 20%, transparent 100%);
    opacity: 0;
    transition: opacity 1s ease;
  }
  .pg-grid.visible { opacity: 1; }

  /* ── Page wrap ── */
  .pg-wrap { position: relative; z-index: 2; }

  /* ══════════════════════════════════════════
     SELECTION VIEW
  ══════════════════════════════════════════ */
  .sel-view {
    min-height: 100vh;
    display: flex; flex-direction: column;
    align-items: center; justify-content: flex-start;
    padding: 0 24px 120px;
  }

  /* ── Sticky Nav ── */
  .sel-nav {
    position: sticky; top: 0; z-index: 100;
    width: 100%; max-width: 900px;
    display: flex; align-items: center; justify-content: space-between;
    padding: 20px 0;
    opacity: 1;
  }
  .sel-nav-logo {
    display: flex; align-items: center; gap: 10px;
    font-weight: 800; font-size: 1.1rem; letter-spacing: -0.03em;
    background: linear-gradient(135deg, #e8f4ff 20%, var(--accent));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .sel-nav-logo-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 12px var(--accent);
    animation: pulse 2.5s ease infinite;
  }
  @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.85)} }

  .sel-logout {
    display: flex; align-items: center; gap: 7px;
    background: rgba(247,93,110,0.07);
    border: 1px solid rgba(247,93,110,0.18);
    color: var(--danger); border-radius: var(--radius-sm);
    padding: 8px 16px; font-family: var(--display);
    font-weight: 600; font-size: 0.83rem;
    cursor: pointer; transition: all 0.22s;
    will-change: transform;
  }
  .sel-logout:hover {
    background: rgba(247,93,110,0.14);
    border-color: rgba(247,93,110,0.4);
  }

  /* ── Hero ── */
  .sel-inner { width: 100%; max-width: 900px; }

  .sel-hero {
    text-align: center;
    padding: 80px 0 64px;
    position: relative;
  }

  .sel-eyebrow {
    display: inline-flex; align-items: center; gap: 7px;
    background: rgba(61,214,245,0.07);
    border: 1px solid rgba(61,214,245,0.18);
    border-radius: 99px;
    padding: 6px 16px;
    font-size: 0.72rem; font-weight: 600;
    color: var(--accent); letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 28px;
    opacity: 1; transform: translateY(0);
  }

  .sel-title {
    font-size: clamp(3rem, 7vw, 5.5rem);
    font-weight: 800;
    letter-spacing: -0.05em;
    line-height: 0.95;
    margin-bottom: 24px;
    overflow: hidden;
  }
  .sel-title-line {
    display: block; overflow: hidden;
  }
  .sel-title-inner {
    display: block;
    background: linear-gradient(145deg, #e8f4ff 15%, var(--accent) 55%, var(--accent2) 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    background-clip: text;
    transform: translateY(0);
  }
  .sel-title-inner.white {
    background: none; -webkit-text-fill-color: var(--text);
  }

  .sel-sub {
    font-size: 1.1rem; color: var(--text-2); font-weight: 400;
    max-width: 480px; margin: 0 auto 40px;
    opacity: 1; transform: translateY(0);
    line-height: 1.7;
  }
  .sel-sub strong { color: var(--accent); font-weight: 600; }

  /* ── Stats bar ── */
  .sel-stats {
    display: flex; align-items: center; justify-content: center; gap: 0;
    margin-bottom: 60px;
    opacity: 1; transform: translateY(0);
  }
  .sel-stat {
    padding: 0 28px;
    text-align: center;
  }
  .sel-stat + .sel-stat {
    border-left: 1px solid var(--border);
  }
  .sel-stat-num {
    font-size: 1.8rem; font-weight: 800; letter-spacing: -0.04em;
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    background-clip: text;
    display: block;
  }
  .sel-stat-label {
    font-size: 0.72rem; color: var(--text-3);
    font-family: var(--mono); letter-spacing: 0.06em;
  }

  /* ── Feature pills ── */
  .sel-features {
    display: flex; align-items: center; justify-content: center;
    flex-wrap: wrap; gap: 10px;
    margin-bottom: 64px;
    opacity: 1;
  }
  .sel-feat-pill {
    display: flex; align-items: center; gap: 7px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 99px;
    padding: 7px 14px;
    font-size: 0.8rem; color: var(--text-2);
    font-family: var(--mono);
    transition: border-color 0.2s, color 0.2s;
  }
  .sel-feat-pill:hover { border-color: var(--border-hi); color: var(--accent); }
  .sel-feat-pill svg { color: var(--accent); opacity: 0.7; }

  /* ── Join card ── */
  .join-section { margin-bottom: 56px; opacity: 1; transform: translateY(0); }
  .join-section-label {
    font-size: 0.68rem; font-weight: 700; color: var(--text-3);
    letter-spacing: 0.12em; text-transform: uppercase;
    margin-bottom: 14px;
    display: flex; align-items: center; gap: 8px;
  }
  .join-section-label::after {
    content: ''; flex: 1; height: 1px;
    background: linear-gradient(90deg, var(--border), transparent);
  }
  .join-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 24px 26px;
    transition: border-color 0.3s;
  }
  .join-card:focus-within { border-color: var(--border-hi); }
  .join-row { display: flex; gap: 10px; }
  .join-input {
    flex: 1;
    background: rgba(255,255,255,0.04);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 13px 20px;
    color: var(--text);
    font-family: var(--mono);
    font-size: 1.2rem; font-weight: 500;
    letter-spacing: 0.28em; text-transform: uppercase;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .join-input::placeholder { color: var(--text-3); letter-spacing: 0.18em; }
  .join-input:focus {
    border-color: rgba(61,214,245,0.45);
    box-shadow: 0 0 0 3px rgba(61,214,245,0.08);
  }
  .join-btn {
    display: flex; align-items: center; gap: 8px;
    background: linear-gradient(135deg, var(--accent), #5ab8d4);
    border: none; color: #04121a;
    border-radius: var(--radius-sm);
    padding: 13px 24px;
    font-family: var(--display); font-weight: 700; font-size: 0.92rem;
    cursor: pointer; white-space: nowrap;
    transition: transform 0.15s, box-shadow 0.22s, opacity 0.15s;
    will-change: transform;
  }
  .join-btn:hover { box-shadow: 0 8px 28px rgba(61,214,245,0.32); }
  .join-btn:active { transform: scale(0.97); }

  /* ── Section title ── */
  .sect-title {
    font-size: 0.68rem; font-weight: 700; color: var(--text-3);
    letter-spacing: 0.12em; text-transform: uppercase;
    margin-bottom: 18px;
    display: flex; align-items: center; gap: 8px;
  }
  .sect-title::after {
    content: ''; flex: 1; height: 1px;
    background: linear-gradient(90deg, var(--border), transparent);
  }

  /* ── Course grid ── */
  .course-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 14px;
  }
  .course-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 24px 22px;
    cursor: pointer;
    display: flex; flex-direction: column; gap: 12px;
    position: relative; overflow: hidden;
    opacity: 1; transform: translateY(0);
    will-change: transform, opacity;
    transition: border-color 0.22s, box-shadow 0.22s;
  }
  .course-card:hover {
    border-color: var(--border-hi);
    box-shadow: 0 20px 50px rgba(61,214,245,0.07);
  }
  .course-card::before {
    content: '';
    position: absolute; inset: 0;
    background: linear-gradient(135deg, rgba(61,214,245,0.05), rgba(124,110,245,0.04));
    opacity: 0;
    transition: opacity 0.3s;
  }
  .course-card:hover::before { opacity: 1; }

  /* shimmer line on hover */
  .course-card::after {
    content: '';
    position: absolute; top: 0; left: -100%; width: 60%; height: 1px;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    transition: left 0.5s ease;
  }
  .course-card:hover::after { left: 140%; }

  .course-icon {
    width: 44px; height: 44px; border-radius: 12px;
    background: linear-gradient(135deg, rgba(61,214,245,0.14), rgba(124,110,245,0.1));
    border: 1px solid rgba(61,214,245,0.15);
    display: flex; align-items: center; justify-content: center;
    font-size: 1.3rem;
    transition: transform 0.25s var(--ease);
  }
  .course-card:hover .course-icon { transform: scale(1.08) rotate(-4deg); }

  .course-name { font-size: 1.05rem; font-weight: 700; color: var(--text); line-height: 1.3; }

  .course-tap {
    display: flex; align-items: center; gap: 4px;
    font-size: 0.75rem; color: var(--text-3);
    font-family: var(--mono);
    transition: color 0.2s, gap 0.2s;
  }
  .course-card:hover .course-tap { color: var(--accent); gap: 7px; }

  .course-empty {
    grid-column: 1/-1;
    padding: 60px 30px; text-align: center;
    background: rgba(255,255,255,0.012);
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    color: var(--text-3); font-size: 0.9rem; line-height: 2.2;
    opacity: 1; animation: none;
  }
  .course-empty .ce-icon { font-size: 2.6rem; margin-bottom: 12px; opacity: 0.35; }

  /* ══════════════════════════════════════════
     CHAT VIEW
  ══════════════════════════════════════════ */
  .chat-view {
    display: flex; height: 100vh; overflow: hidden;
  }

  .c-sidebar {
    width: 280px; flex-shrink: 0;
    background: rgba(5,8,15,0.9);
    border-right: 1px solid var(--border);
    display: flex; flex-direction: column;
    backdrop-filter: blur(20px);
    overflow: hidden;
    transform: translateX(-100%);
  }
  .c-sidebar.open { transform: translateX(0); }

  .c-sidebar-top {
    padding: 20px 18px 16px;
    border-bottom: 1px solid var(--border);
  }
  .c-classroom-name {
    display: flex; align-items: center; gap: 9px;
    font-weight: 700; font-size: 0.95rem; color: var(--text);
    margin-bottom: 12px;
  }
  .c-classroom-name svg { color: var(--accent); flex-shrink: 0; }
  .c-back-btn {
    width: 100%;
    display: flex; align-items: center; justify-content: center; gap: 7px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-sm); color: var(--text-2);
    padding: 9px; font-family: var(--display);
    font-size: 0.82rem; font-weight: 600;
    cursor: pointer; transition: all 0.2s;
  }
  .c-back-btn:hover { border-color: var(--border-hi); color: var(--text); }

  .c-sidebar-body {
    flex: 1; overflow-y: auto; padding: 16px 14px;
    display: flex; flex-direction: column; gap: 22px;
  }
  .c-sidebar-body::-webkit-scrollbar { width: 3px; }
  .c-sidebar-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; }

  .c-sec-head {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 10px;
  }
  .c-sec-label {
    font-size: 0.65rem; font-weight: 700; color: var(--text-3);
    letter-spacing: 0.1em; text-transform: uppercase;
    display: flex; align-items: center; gap: 6px;
  }
  .c-new-btn {
    display: flex; align-items: center; gap: 4px;
    background: rgba(61,214,245,0.08); border: 1px solid rgba(61,214,245,0.2);
    border-radius: 6px; color: var(--accent);
    padding: 4px 9px; font-family: var(--display);
    font-size: 0.7rem; font-weight: 600;
    cursor: pointer; transition: all 0.18s;
  }
  .c-new-btn:hover { background: rgba(61,214,245,0.15); }

  .session-list { display: flex; flex-direction: column; gap: 4px; max-height: 200px; overflow-y: auto; }
  .session-list::-webkit-scrollbar { width: 2px; }
  .session-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; }
  .session-item-btn {
    width: 100%; text-align: left; background: transparent;
    border: 1px solid transparent; border-radius: var(--radius-sm);
    padding: 9px 11px; cursor: pointer;
    transition: all 0.15s; color: var(--text-2); font-family: var(--display);
  }
  .session-item-btn:hover { background: var(--surface); border-color: var(--border); color: var(--text); }
  .session-item-btn.active { background: rgba(61,214,245,0.07); border-color: rgba(61,214,245,0.2); color: var(--accent); }
  .session-preview { font-size: 0.78rem; font-weight: 600; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .session-meta { font-size: 0.65rem; color: var(--text-3); font-family: var(--mono); }

  .mat-list { display: flex; flex-direction: column; gap: 6px; }
  .mat-item {
    display: flex; align-items: center; gap: 8px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 8px 10px;
    transition: border-color 0.2s;
  }
  .mat-item:hover { border-color: rgba(61,214,245,0.2); }
  .mat-info { flex: 1; min-width: 0; }
  .mat-name { font-size: 0.78rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mat-badge {
    font-size: 0.58rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
    background: rgba(61,214,245,0.1); border: 1px solid rgba(61,214,245,0.2);
    color: var(--accent); padding: 1px 6px; border-radius: 99px;
    display: inline-block; margin-bottom: 3px;
  }
  .mat-size { font-size: 0.63rem; color: var(--text-3); font-family: var(--mono); }
  .mat-dl-btn {
    width: 28px; height: 28px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    background: var(--surface-hi); border: 1px solid var(--border);
    border-radius: 7px; color: var(--text-2);
    cursor: pointer; transition: all 0.18s;
  }
  .mat-dl-btn:hover { border-color: var(--border-hi); color: var(--accent); }
  .mat-dl-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .mat-dl-all {
    display: flex; align-items: center; gap: 5px;
    background: transparent; border: 1px solid var(--border);
    border-radius: 6px; color: var(--text-3);
    padding: 4px 9px; font-family: var(--display);
    font-size: 0.7rem; font-weight: 600; cursor: pointer; transition: all 0.18s;
  }
  .mat-dl-all:hover:not(:disabled) { border-color: var(--border-hi); color: var(--text-2); }
  .mat-dl-all:disabled { opacity: 0.35; cursor: not-allowed; }

  .c-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--bg); }

  .c-topbar {
    padding: 14px 24px;
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
    background: rgba(5,8,15,0.7); backdrop-filter: blur(14px);
    flex-shrink: 0;
  }
  .c-topbar-left { display: flex; align-items: center; gap: 10px; }
  .c-topbar-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--accent); box-shadow: 0 0 10px var(--accent);
    animation: pulse 2s ease infinite;
  }
  .c-topbar-name { font-weight: 700; font-size: 0.95rem; color: var(--text); }
  .c-topbar-sub { font-size: 0.73rem; color: var(--text-2); }

  .c-msgs {
    flex: 1; overflow-y: auto;
    padding: 28px 28px 12px;
    display: flex; flex-direction: column; gap: 18px;
  }
  .c-msgs::-webkit-scrollbar { width: 4px; }
  .c-msgs::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; }

  .msg-row { display: flex; gap: 10px; animation: fadeUp 0.32s var(--ease) both; }
  .msg-row.user { flex-direction: row-reverse; }

  .msg-avatar {
    width: 32px; height: 32px; border-radius: 9px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.88rem; font-weight: 700;
  }
  .msg-avatar.ai {
    background: linear-gradient(135deg, rgba(61,214,245,0.2), rgba(124,110,245,0.15));
    border: 1px solid rgba(61,214,245,0.22);
    color: var(--accent);
  }
  .msg-avatar.user {
    background: linear-gradient(135deg, rgba(124,110,245,0.25), rgba(61,214,245,0.1));
    border: 1px solid rgba(124,110,245,0.28);
    color: #a89cf5;
  }
  .msg-body { max-width: 72%; display: flex; flex-direction: column; gap: 4px; }
  .msg-row.user .msg-body { align-items: flex-end; }
  .msg-who { font-size: 0.65rem; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-3); }
  .msg-bubble {
    padding: 13px 17px; border-radius: 14px;
    font-size: 0.93rem; line-height: 1.72; word-break: break-word;
  }
  .msg-bubble.ai {
    background: var(--surface); border: 1px solid var(--border);
    border-top-left-radius: 4px; color: var(--text);
  }
  .msg-bubble.user {
    background: linear-gradient(135deg, rgba(61,214,245,0.1), rgba(124,110,245,0.09));
    border: 1px solid rgba(61,214,245,0.2);
    border-top-right-radius: 4px; color: var(--text);
  }
  .citations-row {
    margin-top: 10px; padding-top: 10px;
    border-top: 1px solid var(--border);
    display: flex; flex-wrap: wrap; gap: 6px;
  }
  .cite-chip {
    display: flex; align-items: center; gap: 5px;
    background: rgba(61,214,245,0.06); border: 1px solid rgba(61,214,245,0.15);
    border-radius: 6px; padding: 3px 9px;
    font-size: 0.72rem; color: var(--accent); font-family: var(--mono);
  }
  .thinking-row { display: flex; gap: 10px; align-items: flex-end; }
  .thinking-bubble {
    padding: 13px 17px; background: var(--surface); border: 1px solid var(--border);
    border-radius: 14px; border-top-left-radius: 4px;
    display: flex; align-items: center; gap: 10px;
    color: var(--text-2); font-size: 0.88rem;
  }
  .thinking-dots { display: flex; gap: 4px; }
  .thinking-dots span {
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--accent); opacity: 0.4;
    animation: dotBounce 1.2s ease infinite;
  }
  .thinking-dots span:nth-child(2) { animation-delay: 0.18s; }
  .thinking-dots span:nth-child(3) { animation-delay: 0.36s; }
  @keyframes dotBounce {
    0%,80%,100%{ transform: scale(0.6); opacity: 0.3; }
    40%         { transform: scale(1);   opacity: 1; }
  }

  .c-input-wrap {
    padding: 16px 24px 20px;
    border-top: 1px solid var(--border);
    background: rgba(5,8,15,0.75); backdrop-filter: blur(14px);
    flex-shrink: 0;
  }
  .c-input-row {
    display: flex; gap: 10px; align-items: flex-end;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 14px; padding: 10px 12px;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .c-input-row:focus-within {
    border-color: rgba(61,214,245,0.35);
    box-shadow: 0 0 0 3px rgba(61,214,245,0.07);
  }
  .c-textarea {
    flex: 1; background: transparent; border: none; outline: none;
    color: var(--text); font-family: var(--display);
    font-size: 0.95rem; line-height: 1.5;
    resize: none; max-height: 120px; min-height: 24px; overflow-y: auto;
  }
  .c-textarea::placeholder { color: var(--text-3); }
  .c-send-btn {
    width: 38px; height: 38px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, var(--accent), #5ab8d4);
    border: none; border-radius: 10px; color: #04121a;
    cursor: pointer; align-self: flex-end;
    transition: transform 0.15s, box-shadow 0.2s, opacity 0.2s;
    will-change: transform;
  }
  .c-send-btn:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 8px 22px rgba(61,214,245,0.38);
  }
  .c-send-btn:disabled { opacity: 0.32; cursor: not-allowed; }
  .c-input-hint {
    text-align: center; margin-top: 9px;
    font-size: 0.66rem; color: var(--text-3); font-family: var(--mono);
  }

  /* ── Loading ── */
  .pg-loading {
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; flex-direction: column; gap: 20px;
  }
  .pg-loading-ring {
    width: 38px; height: 38px; border-radius: 50%;
    border: 2px solid rgba(61,214,245,0.12);
    border-top-color: var(--accent);
    animation: spin 0.85s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .pg-loading-text { font-size: 0.82rem; color: var(--text-3); font-family: var(--mono); }

  /* ── Utilities ── */
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(18px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .empty-text { font-size: 0.76rem; color: var(--text-3); font-family: var(--mono); }

  /* ── Cursor trail dot ── */
  .cursor-dot {
    position: fixed; width: 6px; height: 6px; border-radius: 50%;
    background: var(--accent); pointer-events: none; z-index: 9999;
    mix-blend-mode: screen;
    transform: translate(-50%, -50%);
    transition: opacity 0.3s;
  }
  .cursor-ring {
    position: fixed; width: 32px; height: 32px; border-radius: 50%;
    border: 1px solid rgba(61,214,245,0.4); pointer-events: none; z-index: 9998;
    transform: translate(-50%, -50%);
    transition: width 0.3s, height 0.3s, border-color 0.3s;
  }
  .cursor-ring.hovered { width: 48px; height: 48px; border-color: rgba(61,214,245,0.7); }
`;

// ─── Main component ───────────────────────────────────────────────────────────
export default function Home() {
  const router = useRouter();
  const [auth, setAuth]                           = useState(null);
  const [classrooms, setClassrooms]               = useState([]);
  const [selectedClassroom, setSelectedClassroom] = useState(null);
  const [joinCode, setJoinCode]                   = useState("");
  const [messages, setMessages]                   = useState([]);
  const [input, setInput]                         = useState("");
  const [loading, setLoading]                     = useState(false);
  const [notes, setNotes]                         = useState([]);
  const [notesMeta, setNotesMeta]                 = useState([]);
  const [downloadingNote, setDownloadingNote]     = useState("");
  const [downloadingAllNotes, setDownloadingAllNotes] = useState(false);
  const [chatHistory, setChatHistory]             = useState([]);
  const [historyLoading, setHistoryLoading]       = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [gsapReady, setGsapReady]                 = useState(false);
  const [sidebarOpen, setSidebarOpen]             = useState(false);

  const messagesEndRef  = useRef(null);
  const textareaRef     = useRef(null);
  const locoScrollRef   = useRef(null);
  const containerRef    = useRef(null);
  const cursorDotRef    = useRef(null);
  const cursorRingRef   = useRef(null);
  const gsapRef         = useRef(null);
  const heroAnimDoneRef = useRef(false);

  // ── Scroll to bottom on new message ──
  useEffect(() => {
    // Use instant scroll to prevent window animation from hiding input controls
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages]);

  // ── Hide global sidebar when in chat ──
  useEffect(() => {
    const sidebar = document.querySelector("aside.sidebar");
    if (sidebar) sidebar.style.display = selectedClassroom ? "none" : "";
    return () => { if (sidebar) sidebar.style.display = ""; };
  }, [selectedClassroom]);

  // ── Auth init ──
  useEffect(() => {
    const init = async () => {
      const { token, role, username } = loadAuthSession();
      if (!token) { router.push("/login"); return; }
      axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
      const synced = await syncAuthSessionWithServer(token);
      if (!synced) { clearAuthSession(); router.push("/login"); return; }
      const session = synced || { token, role, username };
      if ((session.role || "").toLowerCase() === "faculty") { router.push("/dashboard"); return; }
      setAuth(session);
      if (!localStorage.getItem("sessionId"))
        localStorage.setItem("sessionId", "session_" + Math.random().toString(36).substring(7));
      fetchClassrooms();
    };
    init();
  }, []);

  // ── Load GSAP ──
  useEffect(() => {
    const loadGSAP = async () => {
      if (typeof window === "undefined") return;
      try {
        const { default: gsap } = await import("gsap");
        const { ScrollTrigger }  = await import("gsap/ScrollTrigger");
        gsap.registerPlugin(ScrollTrigger);
        gsapRef.current = { gsap, ScrollTrigger };
        setGsapReady(true);
      } catch (e) {
        console.warn("GSAP load failed", e);
      }
    };
    loadGSAP();
  }, []);

  // ── Custom cursor ──
  useEffect(() => {
    if (selectedClassroom) return;
    const dot  = cursorDotRef.current;
    const ring = cursorRingRef.current;
    if (!dot || !ring) return;

    let mx = 0, my = 0, rx = 0, ry = 0;
    let raf;

    const onMove = (e) => {
      mx = e.clientX; my = e.clientY;
      dot.style.left  = mx + "px";
      dot.style.top   = my + "px";
    };

    const lerp = (a, b, t) => a + (b - a) * t;
    const tick = () => {
      rx = lerp(rx, mx, 0.12);
      ry = lerp(ry, my, 0.12);
      ring.style.left = rx + "px";
      ring.style.top  = ry + "px";
      raf = requestAnimationFrame(tick);
    };

    const onEnter = () => ring.classList.add("hovered");
    const onLeave = () => ring.classList.remove("hovered");

    window.addEventListener("mousemove", onMove);
    document.querySelectorAll("button, a, .course-card, .sel-feat-pill").forEach(el => {
      el.addEventListener("mouseenter", onEnter);
      el.addEventListener("mouseleave", onLeave);
    });

    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [selectedClassroom, auth]);

  // ── Hero GSAP animation ──
  useEffect(() => {
    if (!gsapReady || !auth || selectedClassroom || heroAnimDoneRef.current) return;
    heroAnimDoneRef.current = true;
    const { gsap } = gsapRef.current;

    // Fade in grid
    const grid = document.querySelector(".pg-grid");
    if (grid) setTimeout(() => grid.classList.add("visible"), 100);

    const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

    // Orbs
    tl.to(".pg-orb", { opacity: 1, duration: 2, stagger: 0.3 }, 0);

    // Nav
    tl.to(".sel-nav", { opacity: 1, y: 0, duration: 0.7 }, 0.3);

    // Eyebrow badge
    tl.to(".sel-eyebrow", {
      opacity: 1, y: 0, duration: 0.65,
    }, 0.5);

    // Title lines
    tl.to(".sel-title-inner", {
      y: "0%", duration: 0.85, stagger: 0.12, ease: "power4.out",
    }, 0.65);

    // Sub
    tl.to(".sel-sub", { opacity: 1, y: 0, duration: 0.6 }, 0.95);

    // Stats
    tl.to(".sel-stats", { opacity: 1, y: 0, duration: 0.55 }, 1.05);

    // Feature pills
    tl.to(".sel-features", { opacity: 1, duration: 0.55 }, 1.15);

    // Join section
    tl.to(".join-section", { opacity: 1, y: 0, duration: 0.6 }, 1.2);

    // Course cards stagger
    tl.to(".course-card", {
      opacity: 1, y: 0, duration: 0.55, stagger: 0.09, ease: "power2.out",
    }, 1.35);

    // Floating parallax on orbs (continuous)
    gsap.to(".pg-orb-1", {
      y: "-=40", x: "+=20",
      duration: 8, repeat: -1, yoyo: true, ease: "sine.inOut",
    });
    gsap.to(".pg-orb-2", {
      y: "+=30", x: "-=25",
      duration: 10, repeat: -1, yoyo: true, ease: "sine.inOut",
    });
    gsap.to(".pg-orb-3", {
      y: "-=20", x: "+=15",
      duration: 7, repeat: -1, yoyo: true, ease: "sine.inOut",
      delay: 2,
    });

  }, [gsapReady, auth, selectedClassroom]);

  // ── Magnetic button effect ──
  const addMagnet = useCallback((el) => {
    if (!el) return;
    const onMove = (e) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (e.clientX - cx) * 0.25;
      const dy = (e.clientY - cy) * 0.25;
      el.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const onLeave = () => { el.style.transform = ""; };
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
  }, []);

  // ── Chat sidebar entrance ──
  useEffect(() => {
    if (!selectedClassroom || !gsapReady) return;
    const { gsap } = gsapRef.current;
    gsap.fromTo(".c-sidebar",
      { x: -40, opacity: 0 },
      { x: 0, opacity: 1, duration: 0.55, ease: "power3.out" }
    );
    gsap.fromTo(".c-main",
      { opacity: 0 },
      { opacity: 1, duration: 0.55, delay: 0.1, ease: "power2.out" }
    );
  }, [selectedClassroom, gsapReady]);

  // ─── Data fetchers ────────────────────────────────────────
  const fetchClassrooms = async () => {
    try {
      const res = await axios.get(`http://localhost:8000/api/classrooms?t=${Date.now()}`);
      setClassrooms(res.data.classrooms || []);
    } catch (e) {
      if (e.response?.status === 401) { clearAuthSession(); router.push("/login"); }
    }
  };

  const fetchNotes = async (classroomId) => {
    try {
      const res = await axios.get(`http://localhost:8000/api/notes?classroom_id=${classroomId}&t=${Date.now()}`);
      setNotes(res.data.notes || []);
      setNotesMeta(res.data.notes_meta || []);
    } catch { setNotesMeta([]); }
  };

  const fetchChatHistory = async (classroomId) => {
    if (!classroomId) return;
    setHistoryLoading(true);
    try {
      const res = await axios.get("http://localhost:8000/api/chat/history", {
        params: { classroom_id: String(classroomId), limit: 500 },
      });
      const items = res.data.items || [];
      setChatHistory(items);
      const sid = localStorage.getItem("sessionId") || selectedSessionId;
      if (sid) {
        const curr = items.filter(i => i.session_id === sid)
          .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
        if (curr.length > 0) { setSelectedSessionId(sid); hydrateMessages(curr); }
      }
    } catch { setChatHistory([]); }
    finally { setHistoryLoading(false); }
  };

  const hydrateMessages = (items) => {
    const h = [];
    items.forEach(item => {
      h.push({ role: "user", content: item.query || "" });
      h.push({ role: "ai", content: item.reply || "", citations: item.citations || [] });
    });
    setMessages(h.length > 0 ? h : [{
      role: "ai",
      content: `Hello! I'm your AI Tutor for **${selectedClassroom?.name || "this class"}**. Ask me anything! 🎓`,
    }]);
  };

  const handleJoinClassroom = async (e) => {
    e.preventDefault();
    const normalizedCode = (joinCode || "").trim().toUpperCase();
    if (!normalizedCode) return;
    if (!/^[A-Z0-9]{6}$/.test(normalizedCode)) {
      alert("Enter a valid 6-character classroom code (letters and numbers).");
      return;
    }
    try {
      await axios.post("http://localhost:8000/api/classrooms/join", { join_code: normalizedCode });
      setJoinCode("");
      await fetchClassrooms();
      alert("Joined classroom successfully.");
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        clearAuthSession();
        router.push("/login");
        return;
      }
      alert(err.response?.data?.detail || "Failed to join classroom");
    }
  };

  const handleSelectClassroom = (c) => {
    setSelectedClassroom(c);
    const sid = localStorage.getItem("sessionId") || "session_" + Math.random().toString(36).substring(7);
    localStorage.setItem("sessionId", sid);
    setSelectedSessionId(sid);
    setMessages([{
      role: "ai",
      content: `Hello! I'm your AI Tutor for **${c.name}**. What would you like to review? 🎓`,
    }]);
    fetchNotes(c.id);
    fetchChatHistory(c.id);
  };

  const handleOpenHistorySession = (sid) => {
    if (!sid) return;
    const items = chatHistory.filter(i => i.session_id === sid)
      .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    localStorage.setItem("sessionId", sid);
    setSelectedSessionId(sid);
    hydrateMessages(items);
  };

  const handleNewChat = () => {
    const sid = "session_" + Math.random().toString(36).substring(7);
    localStorage.setItem("sessionId", sid);
    setSelectedSessionId(sid);
    setMessages([{
      role: "ai",
      content: `Hello! I'm your AI Tutor for **${selectedClassroom?.name || "this class"}**. Ask me anything! 🎓`,
    }]);
  };

  const handleSend = async (e) => {
    e?.preventDefault();
    if (!input.trim() || !selectedClassroom || loading) return;
    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setInput("");
    setLoading(true);
    const sessionId = localStorage.getItem("sessionId");
    try {
      const res = await axios.post("http://localhost:8000/api/chat", {
        classroom_id: String(selectedClassroom.id),
        session_id: sessionId,
        query: userMsg,
        history: messages.map(m => ({ role: m.role, content: m.content })),
      });
      setMessages(prev => [...prev, { role: "ai", content: res.data.reply, citations: res.data.citations }]);
      fetchChatHistory(selectedClassroom.id);
    } catch {
      setMessages(prev => [...prev, { role: "ai", content: "An error occurred connecting to the tutor." }]);
    }
    setLoading(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleLogout = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    sessionStorage.setItem("logout_in_progress", "1");
    clearAuthSession();
    localStorage.removeItem("sessionId");
    delete axios.defaults.headers.common["Authorization"];
    try { router.replace("/login"); } finally { window.location.href = "/login"; }
  };

  const formatBytes = (bytes) => {
    const v = Number(bytes || 0);
    if (v < 1024) return `${v} B`;
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
    return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleDownloadNote = async (noteName) => {
    if (!selectedClassroom || !noteName) return;
    try {
      setDownloadingNote(noteName);
      const res = await axios.get(`http://localhost:8000/api/notes/${encodeURIComponent(noteName)}/download`, {
        params: { classroom_id: String(selectedClassroom.id) }, responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a"); a.href = url; a.setAttribute("download", noteName);
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
    } catch (err) { alert(err.response?.data?.detail || "Failed to download"); }
    finally { setDownloadingNote(""); }
  };

  const handleDownloadAllNotes = async () => {
    if (!selectedClassroom || notes.length === 0) return;
    try {
      setDownloadingAllNotes(true);
      const res = await axios.get("http://localhost:8000/api/notes/download-all", {
        params: { classroom_id: String(selectedClassroom.id) }, responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a"); a.href = url;
      a.setAttribute("download", `classroom_${selectedClassroom.id}_materials.zip`);
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
    } catch (err) { alert(err.response?.data?.detail || "Failed to download all"); }
    finally { setDownloadingAllNotes(false); }
  };

  const notesMetaByName = (notesMeta || []).reduce((acc, item) => {
    acc[item.name] = item; return acc;
  }, {});

  const sessionSummaries = Object.values(
    (chatHistory || []).reduce((acc, item) => {
      const sid = item.session_id || "unknown";
      if (!acc[sid]) acc[sid] = {
        session_id: sid,
        preview: (item.query || item.reply || "Untitled chat").slice(0, 55),
        created_at: item.created_at, turns: 0,
      };
      acc[sid].turns += 1;
      if (!acc[sid].created_at || new Date(item.created_at || 0) > new Date(acc[sid].created_at || 0))
        acc[sid].created_at = item.created_at;
      return acc;
    }, {})
  ).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  // ════════════════════════════════════════════════════════
  // LOADING STATE
  // ════════════════════════════════════════════════════════
  if (!auth) return (
    <>
      <style>{PAGE_STYLES}</style>
      <div className="pg-root">
        <div className="pg-bg">
          <div className="pg-orb pg-orb-1" style={{ opacity: 0.4 }}/>
          <div className="pg-orb pg-orb-2" style={{ opacity: 0.3 }}/>
        </div>
        <div className="pg-loading">
          <div className="pg-loading-ring"/>
          <p className="pg-loading-text">initializing tutor…</p>
        </div>
      </div>
    </>
  );

  // ════════════════════════════════════════════════════════
  // VIEW 1 — Course selection (animated)
  // ════════════════════════════════════════════════════════
  if (!selectedClassroom) return (
    <>
      <style>{PAGE_STYLES}</style>
      <div className="pg-root" ref={containerRef}>

        {/* Custom cursor */}
        <div ref={cursorDotRef}  className="cursor-dot"/>
        <div ref={cursorRingRef} className="cursor-ring"/>

        {/* Fixed ambient layers */}
        <div className="pg-bg">
          <div className="pg-orb pg-orb-1"/>
          <div className="pg-orb pg-orb-2"/>
          <div className="pg-orb pg-orb-3"/>
        </div>
        <div className="pg-grid"/>
        <div className="pg-grain"/>

        <div className="pg-wrap">
          <div className="sel-view">
            <div className="sel-inner">

              {/* ── Nav ── */}
              <nav className="sel-nav">
                <div className="sel-nav-logo">
                  <div className="sel-nav-logo-dot"/>
                  EDUXA
                </div>
                <button type="button" className="sel-logout" ref={addMagnet} onClick={handleLogout}>
                  <LogOut size={14}/> Logout
                </button>
              </nav>

              {/* ── Hero ── */}
              <div className="sel-hero">
                <div className="sel-eyebrow">
                  <Sparkles size={11}/> AI-Powered Learning
                </div>

                <h1 className="sel-title">
                  <span className="sel-title-line">
                    <span className="sel-title-inner white">Your Courses,</span>
                  </span>
                  <span className="sel-title-line">
                    <span className="sel-title-inner">Supercharged.</span>
                  </span>
                </h1>

                <p className="sel-sub">
                  Welcome back, <strong>{auth.username}</strong>. Your AI tutor is ready.
                  Pick a course and start learning smarter.
                </p>

                {/* Stats */}
                <div className="sel-stats">
                  <div className="sel-stat">
                    <span className="sel-stat-num">{classrooms.length}</span>
                    <span className="sel-stat-label">Courses enrolled</span>
                  </div>
                  <div className="sel-stat">
                    <span className="sel-stat-num">∞</span>
                    <span className="sel-stat-label">Questions answered</span>
                  </div>
                  <div className="sel-stat">
                    <span className="sel-stat-num">24/7</span>
                    <span className="sel-stat-label">AI availability</span>
                  </div>
                </div>

                {/* Feature pills */}
                <div className="sel-features">
                  {[
                    { icon: Brain, label: "Context-aware responses" },
                    { icon: Zap,   label: "Instant answers" },
                    { icon: Target,label: "Source citations" },
                  ].map(({ icon: Icon, label }) => (
                    <div key={label} className="sel-feat-pill">
                      <Icon size={12}/> {label}
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Join ── */}
              <div className="join-section">
                <p className="join-section-label">Join a course</p>
                <div className="join-card">
                  <form onSubmit={handleJoinClassroom} className="join-row">
                    <input
                      className="join-input"
                      placeholder="ABC123"
                      value={joinCode}
                      onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                      maxLength={6}
                    />
                    <button type="submit" className="join-btn" ref={addMagnet}>
                      <Plus size={15}/> Join
                    </button>
                  </form>
                </div>
              </div>

              {/* ── Courses ── */}
              <p className="sect-title">Enrolled courses</p>
              <div className="course-grid">
                {classrooms.length === 0 ? (
                  <div className="course-empty">
                    <div className="ce-icon">📚</div>
                    <div>You haven't joined any classrooms yet.</div>
                    <div style={{ fontSize: "0.82rem", color: "var(--text-3)" }}>
                      Use the join code above to enrol.
                    </div>
                  </div>
                ) : classrooms.map((c, i) => (
                  <div
                    key={c.id}
                    className="course-card"
                    style={{ animationDelay: `${i * 0.06}s` }}
                    onClick={() => handleSelectClassroom(c)}
                  >
                    <div className="course-icon">📖</div>
                    <div className="course-name">{c.name}</div>
                    <div className="course-tap">Open tutor <ChevronRight size={13}/></div>
                  </div>
                ))}
              </div>

            </div>
          </div>
        </div>
      </div>
    </>
  );

  // ════════════════════════════════════════════════════════
  // VIEW 2 — Chat interface
  // ════════════════════════════════════════════════════════
  return (
    <>
      <style>{PAGE_STYLES}</style>
      <div className="pg-root" style={{ height: "100vh" }}>
        <div className="pg-bg" style={{ opacity: 0.35 }}>
          <div className="pg-orb pg-orb-1" style={{ opacity: 0.5 }}/>
          <div className="pg-orb pg-orb-2" style={{ opacity: 0.4 }}/>
        </div>
        <div className="pg-grain"/>

        <div className="pg-wrap" style={{ height: "100%" }}>
          <div className="chat-view">

            {/* ── Sidebar ── */}
            <aside className="c-sidebar" style={{ transform: "none", opacity: 1 }}>
              <div className="c-sidebar-top">
                <div className="c-classroom-name">
                  <Book size={16}/> {selectedClassroom.name}
                </div>
                <button className="c-back-btn" onClick={() => setSelectedClassroom(null)}>
                  <ArrowLeft size={14}/> Back to Courses
                </button>
              </div>

              <div className="c-sidebar-body">
                {/* Sessions */}
                <div>
                  <div className="c-sec-head">
                    <span className="c-sec-label"><Hash size={11}/> Sessions</span>
                    <button className="c-new-btn" onClick={handleNewChat}>
                      <Plus size={11}/> New
                    </button>
                  </div>
                  <div className="session-list">
                    {historyLoading ? (
                      <p className="empty-text">Loading…</p>
                    ) : sessionSummaries.length === 0 ? (
                      <p className="empty-text">No previous sessions.</p>
                    ) : sessionSummaries.map(s => (
                      <button
                        key={s.session_id}
                        className={`session-item-btn ${selectedSessionId === s.session_id ? "active" : ""}`}
                        onClick={() => handleOpenHistorySession(s.session_id)}
                      >
                        <div className="session-preview">{s.preview || "Untitled"}</div>
                        <div className="session-meta">
                          {s.turns} msg{s.turns !== 1 ? "s" : ""}
                          {s.created_at ? ` · ${new Date(s.created_at).toLocaleDateString()}` : ""}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Materials */}
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: "18px" }}>
                  <div className="c-sec-head">
                    <span className="c-sec-label">Materials</span>
                    <button
                      className="mat-dl-all"
                      onClick={handleDownloadAllNotes}
                      disabled={notes.length === 0 || downloadingAllNotes}
                    >
                      <Download size={10}/> {downloadingAllNotes ? "…" : "All"}
                    </button>
                  </div>
                  <div className="mat-list">
                    {notes.length === 0 ? (
                      <p className="empty-text">No files uploaded yet.</p>
                    ) : notes.map(note => (
                      <div key={note} className="mat-item">
                        <div className="mat-info">
                          <span className="mat-badge">{notesMetaByName[note]?.file_type || "FILE"}</span>
                          <div className="mat-name">{note}</div>
                          <div className="mat-size">{formatBytes(notesMetaByName[note]?.size_bytes || 0)}</div>
                        </div>
                        <button
                          className="mat-dl-btn"
                          onClick={() => handleDownloadNote(note)}
                          disabled={downloadingNote === note}
                        >
                          <Download size={13}/>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </aside>

            {/* ── Chat main ── */}
            <main className="c-main">
              <div className="c-topbar">
                <div className="c-topbar-left">
                  <div className="c-topbar-dot"/>
                  <div>
                    <div className="c-topbar-name">{selectedClassroom.name}</div>
                    <div className="c-topbar-sub">AI Tutor · Course-aware</div>
                  </div>
                </div>
                <button type="button" className="sel-logout" style={{ position: "static" }} onClick={handleLogout}>
                  <LogOut size={13}/> Logout
                </button>
              </div>

              <div className="c-msgs">
                {messages.map((msg, i) => (
                  <div key={i} className={`msg-row ${msg.role}`}>
                    <div className={`msg-avatar ${msg.role}`}>
                      {msg.role === "ai" ? "✦" : auth.username?.[0]?.toUpperCase() || "U"}
                    </div>
                    <div className="msg-body">
                      <div className="msg-who">{msg.role === "ai" ? "AI Tutor" : "You"}</div>
                      <div className={`msg-bubble ${msg.role}`}>
                        <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{msg.content}</p>
                        {msg.citations && msg.citations.length > 0 && (
                          <div className="citations-row">
                            {msg.citations.map((cite, ci) => (
                              <span key={ci} className="cite-chip">📄 {cite.file}, p.{cite.page}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="thinking-row">
                    <div className="msg-avatar ai">✦</div>
                    <div className="thinking-bubble">
                      <div className="thinking-dots">
                        <span/><span/><span/>
                      </div>
                      Tutor is thinking…
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef}/>
              </div>

              <div className="c-input-wrap">
                <div className="c-input-row">
                  <textarea
                    ref={textareaRef}
                    className="c-textarea"
                    rows={1}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask a question about your course notes…"
                    disabled={loading}
                  />
                  <button
                    className="c-send-btn"
                    onClick={handleSend}
                    disabled={loading || !input.trim()}
                  >
                    <Send size={16}/>
                  </button>
                </div>
                <p className="c-input-hint">Enter to send · Shift+Enter for new line</p>
              </div>
            </main>
          </div>
        </div>
      </div>
    </>
  );
}