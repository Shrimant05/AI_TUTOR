"use client";

import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { Send, Book, Hash, LogOut, ArrowLeft, Plus, Download } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  loadAuthSession,
  clearAuthSession,
  syncAuthSessionWithServer,
} from "../lib/authStorage";

// ─────────────────────────────────────────────────────────
// Tiny helper: run a GSAP timeline once on mount
// ─────────────────────────────────────────────────────────
function useGsapOnce(fn, deps = []) {
  useEffect(() => {
    let ctx;
    const run = async () => {
      const { default: gsap } = await import("gsap");
      ctx = gsap.context(fn(gsap));
    };
    run();
    return () => ctx?.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// ─────────────────────────────────────────────────────────
export default function Home() {
  const router = useRouter();
  const [auth, setAuth]                       = useState(null);
  const [classrooms, setClassrooms]           = useState([]);
  const [selectedClassroom, setSelectedClassroom] = useState(null);
  const [joinCode, setJoinCode]               = useState("");
  const [messages, setMessages]               = useState([]);
  const [input, setInput]                     = useState("");
  const [loading, setLoading]                 = useState(false);
  const [notes, setNotes]                     = useState([]);
  const [notesMeta, setNotesMeta]             = useState([]);
  const [downloadingNote, setDownloadingNote] = useState("");
  const [downloadingAllNotes, setDownloadingAllNotes] = useState(false);
  const [chatHistory, setChatHistory]         = useState([]);
  const [historyLoading, setHistoryLoading]   = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState("");

  const messagesEndRef = useRef(null);

  // ── Refs for GSAP ──
  const pageRef       = useRef(null);
  const headerRef     = useRef(null);
  const joinCardRef   = useRef(null);
  const coursesRef    = useRef(null);
  const chatRef       = useRef(null);
  const sidebarRef    = useRef(null);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Auth init ──
  useEffect(() => {
    const initializeAuth = async () => {
      const { token, role, username } = loadAuthSession();
      if (!token) { router.push("/login"); return; }
      axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
      const synced = await syncAuthSessionWithServer(token);
      if (!synced) { clearAuthSession(); router.push("/login"); return; }
      const activeSession = synced || { token, role, username };
      if ((activeSession.role || "").toLowerCase() === "faculty") { router.push("/dashboard"); return; }
      setAuth(activeSession);
      if (!localStorage.getItem("sessionId")) {
        localStorage.setItem("sessionId", "session_" + Math.random().toString(36).substring(7));
      }
      fetchClassrooms();
    };
    initializeAuth();
  }, []);

  // ── GSAP: classroom selection page entry ──
  useEffect(() => {
    if (!auth || selectedClassroom) return;
    let ctx;
    const run = async () => {
      const { default: gsap } = await import("gsap");
      ctx = gsap.context(() => {
        const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
        tl.from(headerRef.current, { y: -28, opacity: 0, duration: 0.6 }, 0)
          .from(joinCardRef.current, { y: 24, opacity: 0, duration: 0.55 }, 0.15)
          .from(".courses-heading", { x: -20, opacity: 0, duration: 0.5 }, 0.25)
          .from(coursesRef.current?.children || [], {
            y: 28, opacity: 0, duration: 0.5, stagger: 0.08,
          }, 0.35);
      }, pageRef.current);
    };
    run();
    return () => ctx?.revert();
  }, [auth, selectedClassroom, classrooms]);

  // ── GSAP: chat view entry ──
  useEffect(() => {
    if (!selectedClassroom) return;
    let ctx;
    const run = async () => {
      const { default: gsap } = await import("gsap");
      ctx = gsap.context(() => {
        const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
        tl.from(sidebarRef.current, { x: -40, opacity: 0, duration: 0.6 }, 0)
          .from(chatRef.current, { opacity: 0, duration: 0.5 }, 0.15);
      });
    };
    run();
    return () => ctx?.revert();
  }, [selectedClassroom]);

  // ── Data fetch helpers ──
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
      const currentSessionId = localStorage.getItem("sessionId") || selectedSessionId;
      if (currentSessionId) {
        const currentItems = items
          .filter((i) => i.session_id === currentSessionId)
          .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
        if (currentItems.length > 0) {
          setSelectedSessionId(currentSessionId);
          hydrateMessagesFromSession(currentItems);
        }
      }
    } catch { setChatHistory([]); } finally { setHistoryLoading(false); }
  };

  const hydrateMessagesFromSession = (items) => {
    const hydrated = [];
    items.forEach((item) => {
      hydrated.push({ role: "user", content: item.query || "" });
      hydrated.push({ role: "ai", content: item.reply || "", citations: item.citations || [] });
    });
    setMessages(
      hydrated.length > 0
        ? hydrated
        : [{ role: "ai", content: `Hello! I am your AI Tutor for **${selectedClassroom?.name || "this class"}**. What would you like to review?` }]
    );
  };

  const handleJoinClassroom = async (e) => {
    e.preventDefault();
    if (!joinCode) return;
    try {
      await axios.post("http://localhost:8000/api/classrooms/join", { join_code: joinCode });
      setJoinCode("");
      fetchClassrooms();
    } catch (err) {
      alert(err.response?.data?.detail || "Failed to join classroom");
    }
  };

  const handleSelectClassroom = (c) => {
    setSelectedClassroom(c);
    const sid = localStorage.getItem("sessionId") || "session_" + Math.random().toString(36).substring(7);
    localStorage.setItem("sessionId", sid);
    setSelectedSessionId(sid);
    setMessages([{ role: "ai", content: `Hello! I am your AI Tutor for **${c.name}**. What would you like to review?` }]);
    fetchNotes(c.id);
    fetchChatHistory(c.id);
  };

  const handleOpenHistorySession = (sessionId) => {
    if (!sessionId) return;
    const items = chatHistory
      .filter((i) => i.session_id === sessionId)
      .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    localStorage.setItem("sessionId", sessionId);
    setSelectedSessionId(sessionId);
    hydrateMessagesFromSession(items);
  };

  const handleNewChat = () => {
    const newSid = "session_" + Math.random().toString(36).substring(7);
    localStorage.setItem("sessionId", newSid);
    setSelectedSessionId(newSid);
    setMessages([{ role: "ai", content: `Hello! I am your AI Tutor for **${selectedClassroom?.name || "this class"}**. What would you like to review?` }]);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || !selectedClassroom) return;
    const userMsg = input.trim();
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setInput("");
    setLoading(true);
    const sessionId = localStorage.getItem("sessionId");
    try {
      const response = await axios.post("http://localhost:8000/api/chat", {
        classroom_id: String(selectedClassroom.id),
        session_id: sessionId,
        query: userMsg,
        history: messages.map((m) => ({ role: m.role, content: m.content })),
      });
      setMessages((prev) => [
        ...prev,
        { role: "ai", content: response.data.reply, citations: response.data.citations },
      ]);
      fetchChatHistory(selectedClassroom.id);
    } catch {
      setMessages((prev) => [...prev, { role: "ai", content: "An error occurred connecting to the tutor." }]);
    }
    setLoading(false);
  };

  const handleLogout = () => { clearAuthSession(); router.push("/login"); };

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
      const res = await axios.get(
        `http://localhost:8000/api/notes/${encodeURIComponent(noteName)}/download`,
        { params: { classroom_id: String(selectedClassroom.id) }, responseType: "blob" }
      );
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url; a.setAttribute("download", noteName);
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.response?.data?.detail || "Failed to download material");
    } finally { setDownloadingNote(""); }
  };

  const handleDownloadAllNotes = async () => {
    if (!selectedClassroom || notes.length === 0) return;
    try {
      setDownloadingAllNotes(true);
      const res = await axios.get("http://localhost:8000/api/notes/download-all", {
        params: { classroom_id: String(selectedClassroom.id) }, responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url; a.setAttribute("download", `classroom_${selectedClassroom.id}_materials.zip`);
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.response?.data?.detail || "Failed to download classroom materials");
    } finally { setDownloadingAllNotes(false); }
  };

  const notesMetaByName = (notesMeta || []).reduce((acc, item) => {
    acc[item.name] = item; return acc;
  }, {});

  const sessionSummaries = Object.values(
    (chatHistory || []).reduce((acc, item) => {
      const sid = item.session_id || "unknown";
      if (!acc[sid]) {
        acc[sid] = {
          session_id: sid,
          preview: (item.query || item.reply || "Untitled chat").slice(0, 60),
          created_at: item.created_at,
          turns: 0,
        };
      }
      acc[sid].turns += 1;
      if (!acc[sid].created_at || new Date(item.created_at || 0) > new Date(acc[sid].created_at || 0)) {
        acc[sid].created_at = item.created_at;
      }
      return acc;
    }, {})
  ).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  // ── Loading screen ──
  if (!auth) {
    return (
      <div className="loading-screen">
        <div className="loading-ring" />
        <span style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>Loading…</span>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════
  // VIEW 1: Classroom selection
  // ════════════════════════════════════════════════════════
  if (!selectedClassroom) {
    return (
      <div ref={pageRef} style={{ maxWidth: 820, margin: "0 auto", width: "100%", paddingTop: 40, paddingBottom: 60 }}>

        {/* Header */}
        <div ref={headerRef} style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 44,
        }}>
          <div>
            <h1 style={{
              fontFamily: "var(--font-display)",
              fontSize: "2.4rem",
              fontWeight: 800,
              letterSpacing: "-0.04em",
              marginBottom: 6,
              background: "linear-gradient(135deg, #e8eeff 30%, #a78bfa)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}>
              Welcome, {auth.username}
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem" }}>
              Select a course to start learning
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="btn-danger"
            style={{ background: "var(--danger-subtle)", color: "var(--danger)", border: "1px solid rgba(255,79,107,0.22)", gap: 8, padding: "9px 16px" }}
          >
            <LogOut size={15} /> Logout
          </button>
        </div>

        {/* Faculty redirect banner */}
        {auth.role === "faculty" && (
          <div ref={joinCardRef} style={{
            marginBottom: 28, padding: "18px 22px",
            background: "rgba(79,124,255,0.06)",
            borderRadius: "var(--radius-md)",
            border: "1px solid rgba(79,124,255,0.2)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              You are logged in as a <strong style={{ color: "var(--text-primary)" }}>Faculty</strong> member.
            </span>
            <button onClick={() => router.push("/dashboard")} className="send-btn" style={{ padding: "8px 14px" }}>
              Go to Dashboard
            </button>
          </div>
        )}

        {/* Join card */}
        <div ref={!auth.role || auth.role !== "faculty" ? joinCardRef : null}
          className="glass-panel"
          style={{ marginBottom: 32, padding: "26px 28px" }}
        >
          <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: 16, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Join a Course
          </h2>
          <form onSubmit={handleJoinClassroom} style={{ display: "flex", gap: 12 }}>
            <input
              type="text"
              placeholder="Enter 6-digit join code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              maxLength={6}
              style={{ flex: 1, fontSize: "1.1rem", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 700 }}
            />
            <button type="submit" className="send-btn" style={{ padding: "10px 20px", gap: 6 }}>
              <Plus size={16} /> Join
            </button>
          </form>
        </div>

        {/* Courses grid */}
        <h2 className="courses-heading" style={{
          marginBottom: 18,
          fontFamily: "var(--font-display)",
          fontSize: "1.05rem",
          fontWeight: 700,
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
        }}>
          Enrolled Courses
        </h2>

        <div ref={coursesRef} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          {classrooms.length === 0 ? (
            <div style={{
              gridColumn: "1 / -1",
              padding: "40px 30px",
              textAlign: "center",
              color: "var(--text-secondary)",
              background: "rgba(255,255,255,0.02)",
              borderRadius: "var(--radius-md)",
              border: "1px dashed var(--panel-border)",
            }}>
              <div style={{ fontSize: "2rem", marginBottom: 12 }}>📚</div>
              <p>You haven&apos;t joined any classrooms yet.</p>
              <p style={{ fontSize: "0.85rem", marginTop: 6 }}>Use the join code above to enrol.</p>
            </div>
          ) : (
            classrooms.map((c) => (
              <div
                key={c.id}
                onClick={() => handleSelectClassroom(c)}
                className="glass-panel stat-card classroom-card"
              >
                <div style={{
                  width: 36, height: 36,
                  borderRadius: 10,
                  background: "linear-gradient(135deg, rgba(79,124,255,0.25) 0%, rgba(139,92,246,0.2) 100%)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "1.1rem", marginBottom: 4,
                }}>
                  📖
                </div>
                <h3 style={{ fontSize: "1.1rem", margin: "4px 0 0 0", color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
                  {c.name}
                </h3>
                <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", margin: 0 }}>
                  Tap to open tutor
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════
  // VIEW 2: Chat Interface
  // ════════════════════════════════════════════════════════
  return (
    <div className="layout-container" style={{ gap: 0 }}>

      {/* ── Left sidebar: history + materials ── */}
      <aside
        ref={sidebarRef}
        className="glass-panel"
        style={{
          width: 300,
          margin: "16px 0 16px 16px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRadius: "var(--radius-lg)",
        }}
      >
        {/* Sidebar header */}
        <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--panel-border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h3 style={{
              margin: 0, fontSize: "0.85rem",
              fontFamily: "var(--font-display)", fontWeight: 700,
              display: "flex", alignItems: "center", gap: 7, color: "var(--text-secondary)",
              textTransform: "uppercase", letterSpacing: "0.06em",
            }}>
              <Hash size={14} /> Sessions
            </h3>
            <button
              onClick={handleNewChat}
              className="send-btn"
              style={{ padding: "5px 10px", fontSize: "0.78rem", gap: 5 }}
            >
              <Plus size={13} /> New
            </button>
          </div>
          <div style={{ fontSize: "0.82rem", color: "var(--accent-color)", fontWeight: 600 }}>
            {selectedClassroom.name}
          </div>
        </div>

        {/* Session list */}
        <div style={{ flex: 1, overflowY: "auto", padding: 10 }}>
          {historyLoading ? (
            <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", padding: 8 }}>Loading…</p>
          ) : sessionSummaries.length === 0 ? (
            <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", padding: 8 }}>No previous chats yet.</p>
          ) : (
            sessionSummaries.map((session) => (
              <button
                key={session.session_id}
                onClick={() => handleOpenHistorySession(session.session_id)}
                className={`session-item ${selectedSessionId === session.session_id ? "active" : ""}`}
              >
                <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: 3 }}>
                  {session.preview || "Untitled chat"}
                </div>
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                  {session.turns} msg{session.turns !== 1 ? "s" : ""}
                  {session.created_at ? ` · ${new Date(session.created_at).toLocaleDateString()}` : ""}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Materials panel */}
        <div style={{ borderTop: "1px solid var(--panel-border)", padding: "12px 10px", maxHeight: "33%", overflowY: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Materials
            </div>
            <button
              onClick={handleDownloadAllNotes}
              className="send-btn"
              disabled={notes.length === 0 || downloadingAllNotes}
              style={{ padding: "4px 9px", fontSize: "0.7rem", gap: 4 }}
              title="Download all as zip"
            >
              <Download size={11} /> {downloadingAllNotes ? "…" : "All"}
            </button>
          </div>
          {notes.length === 0 ? (
            <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: 0 }}>No files uploaded yet.</p>
          ) : (
            notes.map((note) => (
              <div key={note} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
                    <span style={{
                      fontSize: "0.6rem", padding: "2px 6px", borderRadius: 999,
                      background: "var(--accent-subtle)", border: "1px solid rgba(79,124,255,0.3)",
                      color: "#bfdbfe", fontWeight: 600, textTransform: "uppercase",
                    }}>
                      {notesMetaByName[note]?.file_type || "FILE"}
                    </span>
                    <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                      {formatBytes(notesMetaByName[note]?.size_bytes || 0)}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.78rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {note}
                  </div>
                </div>
                <button
                  onClick={() => handleDownloadNote(note)}
                  className="send-btn"
                  disabled={downloadingNote === note}
                  style={{ padding: "5px 8px" }}
                  title="Download"
                >
                  <Download size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ── Main chat area ── */}
      <main
        ref={chatRef}
        className="chat-container"
        style={{ padding: "16px 20px 20px 12px" }}
      >
        {/* Chat header */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "14px 18px", marginBottom: 12,
          background: "var(--panel-bg)",
          border: "1px solid var(--panel-border)",
          borderRadius: "var(--radius-md)",
          backdropFilter: "blur(16px)",
        }}>
          <h2 style={{
            fontSize: "0.95rem", fontWeight: 700,
            display: "flex", alignItems: "center", gap: 8, margin: 0,
            fontFamily: "var(--font-display)",
          }}>
            <Book size={17} style={{ color: "var(--accent-color)" }} />
            {selectedClassroom.name}
          </h2>
          <button
            onClick={() => setSelectedClassroom(null)}
            style={{ background: "transparent", border: "1px solid var(--panel-border)", color: "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center", gap: 7, fontWeight: 600, fontSize: "0.85rem", padding: "6px 12px", borderRadius: "var(--radius-sm)", transition: "all var(--transition)" }}
            onMouseOver={(e) => { e.currentTarget.style.borderColor = "var(--panel-border-hi)"; e.currentTarget.style.color = "#fff"; }}
            onMouseOut={(e) => { e.currentTarget.style.borderColor = "var(--panel-border)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
          >
            <ArrowLeft size={15} /> Back
          </button>
        </div>

        {/* Messages */}
        <div className="chat-history">
          {messages.map((msg, index) => (
            <div key={index} className={`message ${msg.role === "user" ? "user-message" : "ai-message"}`}>
              <div className="message-bubble">
                <div style={{
                  fontWeight: 700, marginBottom: 5, fontSize: "0.78rem",
                  letterSpacing: "0.04em", textTransform: "uppercase",
                  color: msg.role === "user" ? "var(--accent-color)" : "var(--text-secondary)",
                }}>
                  {msg.role === "user" ? "You" : "AI Tutor"}
                </div>
                <div style={{ lineHeight: 1.65 }}>{msg.content}</div>

                {/* Citations */}
                {msg.citations && msg.citations.length > 0 && (
                  <div style={{
                    marginTop: 12, paddingTop: 10,
                    borderTop: "1px solid rgba(255,255,255,0.07)",
                    display: "flex", flexWrap: "wrap", gap: 6,
                  }}>
                    {msg.citations.map((cite, i) => (
                      <span key={i} className="citation">
                        📄 {cite.file}, p.{cite.page}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="ai-message">
              <div className="message-bubble thinking-bubble" style={{
                display: "flex", alignItems: "center", gap: 10,
                color: "var(--text-secondary)", fontSize: "0.88rem",
              }}>
                <span style={{
                  width: 14, height: 14,
                  border: "2px solid rgba(255,255,255,0.1)",
                  borderTopColor: "var(--accent-color)",
                  borderRadius: "50%",
                  display: "inline-block",
                  animation: "spinRing 0.8s linear infinite",
                }} />
                Tutor is thinking…
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <form className="input-area" onSubmit={handleSend}>
          <input
            type="text"
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about your course notes…"
            disabled={loading}
          />
          <button type="submit" className="send-btn" disabled={loading || !input.trim()}>
            <Send size={17} />
          </button>
        </form>
      </main>
    </div>
  );
}