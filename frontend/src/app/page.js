"use client";

import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Send, Book, Hash, LogOut, ArrowLeft, Plus, Download } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { loadAuthSession, clearAuthSession, syncAuthSessionWithServer } from '../lib/authStorage';

export default function Home() {
  const router = useRouter();
  const [auth, setAuth] = useState(null);
  
  const [classrooms, setClassrooms] = useState([]);
  const [selectedClassroom, setSelectedClassroom] = useState(null);
  const [joinCode, setJoinCode] = useState("");
  
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState([]);
  const [notesMeta, setNotesMeta] = useState([]);
  const [downloadingNote, setDownloadingNote] = useState("");
  const [downloadingAllNotes, setDownloadingAllNotes] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  
  const messagesEndRef = useRef(null);

  // Auto-scroll chat
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(() => scrollToBottom(), [messages]);

  useEffect(() => {
    const initializeAuth = async () => {
      const { token, role, username } = loadAuthSession();

      if (!token) {
        router.push("/login");
        return;
      }

      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      const synced = await syncAuthSessionWithServer(token);
      if (!synced) {
        clearAuthSession();
        router.push("/login");
        return;
      }
      const activeSession = synced || { token, role, username };

      if ((activeSession.role || "").toLowerCase() === "faculty") {
        router.push("/dashboard");
        return;
      }

      setAuth(activeSession);

      // Generate unique session for this open tab
      if (!localStorage.getItem("sessionId")) {
        localStorage.setItem("sessionId", "session_" + Math.random().toString(36).substring(7));
      }

      fetchClassrooms();
    };

    initializeAuth();
  }, []);

  const fetchClassrooms = async () => {
    try {
      const res = await axios.get(`http://localhost:8000/api/classrooms?t=${new Date().getTime()}`);
      setClassrooms(res.data.classrooms || []);
    } catch (e) {
      if (e.response?.status === 401) {
        clearAuthSession();
        router.push("/login");
      }
    }
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
    const existingSessionId = localStorage.getItem("sessionId") || "session_" + Math.random().toString(36).substring(7);
    localStorage.setItem("sessionId", existingSessionId);
    setSelectedSessionId(existingSessionId);
    setMessages([{ role: 'ai', content: `Hello! I am your AI Tutor for **${c.name}**. What would you like to review?` }]);
    fetchNotes(c.id);
    fetchChatHistory(c.id);
  };

  const hydrateMessagesFromSession = (items) => {
    const hydrated = [];
    items.forEach((item) => {
      hydrated.push({ role: 'user', content: item.query || "" });
      hydrated.push({ role: 'ai', content: item.reply || "", citations: item.citations || [] });
    });
    setMessages(hydrated.length > 0 ? hydrated : [{ role: 'ai', content: `Hello! I am your AI Tutor for **${selectedClassroom?.name || "this class"}**. What would you like to review?` }]);
  };

  const handleOpenHistorySession = (sessionId) => {
    if (!sessionId) return;
    const sessionItems = chatHistory
      .filter((item) => item.session_id === sessionId)
      .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    localStorage.setItem("sessionId", sessionId);
    setSelectedSessionId(sessionId);
    hydrateMessagesFromSession(sessionItems);
  };

  const handleNewChat = () => {
    const newSessionId = "session_" + Math.random().toString(36).substring(7);
    localStorage.setItem("sessionId", newSessionId);
    setSelectedSessionId(newSessionId);
    setMessages([{ role: 'ai', content: `Hello! I am your AI Tutor for **${selectedClassroom?.name || "this class"}**. What would you like to review?` }]);
  };

  const fetchNotes = async (classroomId) => {
    try {
      const res = await axios.get(`http://localhost:8000/api/notes?classroom_id=${classroomId}&t=${new Date().getTime()}`);
      setNotes(res.data.notes || []);
      setNotesMeta(res.data.notes_meta || []);
    } catch (err) {
      console.error("Failed to fetch available notes", err);
      setNotesMeta([]);
    }
  };

  const formatBytes = (bytes) => {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleDownloadNote = async (noteName) => {
    if (!selectedClassroom || !noteName) return;
    try {
      setDownloadingNote(noteName);
      const res = await axios.get(
        `http://localhost:8000/api/notes/${encodeURIComponent(noteName)}/download`,
        {
          params: { classroom_id: String(selectedClassroom.id) },
          responseType: 'blob',
        }
      );

      const blobUrl = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', noteName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to download material');
    } finally {
      setDownloadingNote("");
    }
  };

  const handleDownloadAllNotes = async () => {
    if (!selectedClassroom || notes.length === 0) return;
    try {
      setDownloadingAllNotes(true);
      const res = await axios.get("http://localhost:8000/api/notes/download-all", {
        params: { classroom_id: String(selectedClassroom.id) },
        responseType: 'blob',
      });

      const blobUrl = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', `classroom_${selectedClassroom.id}_materials.zip`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to download classroom materials');
    } finally {
      setDownloadingAllNotes(false);
    }
  };

  const notesMetaByName = (notesMeta || []).reduce((acc, item) => {
    acc[item.name] = item;
    return acc;
  }, {});

  const fetchChatHistory = async (classroomId) => {
    if (!classroomId) return;
    setHistoryLoading(true);
    try {
      const res = await axios.get("http://localhost:8000/api/chat/history", {
        params: { classroom_id: String(classroomId), limit: 500 }
      });
      const items = res.data.items || [];
      setChatHistory(items);

      const currentSessionId = localStorage.getItem("sessionId") || selectedSessionId;
      if (currentSessionId) {
        const currentSessionItems = items
          .filter((item) => item.session_id === currentSessionId)
          .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

        if (currentSessionItems.length > 0) {
          setSelectedSessionId(currentSessionId);
          hydrateMessagesFromSession(currentSessionItems);
        }
      }
    } catch (err) {
      console.error("Failed to fetch chat history", err);
      setChatHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || !selectedClassroom) return;
    
    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setInput("");
    setLoading(true);

    const sessionId = localStorage.getItem("sessionId");
    
    try {
      const response = await axios.post("http://localhost:8000/api/chat", {
        classroom_id: String(selectedClassroom.id),
        session_id: sessionId,
        query: userMsg,
        history: messages.map(m => ({ role: m.role, content: m.content }))
      });
      
      setMessages(prev => [...prev, { 
        role: 'ai', 
        content: response.data.reply,
        citations: response.data.citations 
      }]);
      fetchChatHistory(selectedClassroom.id);
    } catch (error) {
      setMessages(prev => [...prev, { role: 'ai', content: "An error occurred connecting to the tutor." }]);
    }
    setLoading(false);
  };

  const handleLogout = () => {
    clearAuthSession();
    router.push("/login");
  };

  if (!auth) return <div style={{padding: '50px', textAlign: 'center'}}>Loading...</div>;

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

  // View 1: Classroom Selection
  if (!selectedClassroom) {
    return (
      <div style={{maxWidth: '800px', margin: '0 auto', width: '100%', paddingTop: '40px'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px'}}>
          <h1 style={{fontSize: '2.5rem'}}>Welcome, {auth.username}</h1>
          <button onClick={handleLogout} className="send-btn" style={{background: 'rgba(255,100,100,0.1)', color: 'var(--danger)', gap: '8px'}}>
            <LogOut size={16} /> Logout
          </button>
        </div>

        {auth.role === "faculty" && (
          <div style={{marginBottom: '30px', padding: '20px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px'}}>
            You are logged in as a Faculty member. 
            <button onClick={() => router.push('/dashboard')} className="send-btn" style={{marginTop: '10px'}}>
              Go to Faculty Dashboard
            </button>
          </div>
        )}

        <div className="glass-panel" style={{marginBottom: '30px', padding: '30px'}}>
          <h2>Join a Course</h2>
          <form onSubmit={handleJoinClassroom} style={{display: 'flex', gap: '15px', marginTop: '15px'}}>
            <input 
              type="text" 
              placeholder="Enter 6-digit Join Code" 
              className="chat-input"
              value={joinCode} onChange={e => setJoinCode(e.target.value)}
              style={{flex: 1, fontSize: '1.2rem', textTransform: 'uppercase'}}
              maxLength={6}
            />
            <button type="submit" className="send-btn"><Plus size={18}/> Join</button>
          </form>
        </div>

        <h2 style={{marginBottom: '20px'}}>My Enrolled Courses</h2>
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px'}}>
          {classrooms.length === 0 ? <p style={{color: 'var(--text-secondary)'}}>You haven&apos;t joined any classrooms yet.</p> :
            classrooms.map(c => (
              <div 
                key={c.id} 
                onClick={() => handleSelectClassroom(c)}
                className="glass-panel stat-card"
                style={{cursor: 'pointer', transition: '0.2s', border: '1px solid transparent'}}
                onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--accent-color)'}
                onMouseOut={(e) => e.currentTarget.style.borderColor = 'transparent'}
              >
                <h3 style={{fontSize: '1.2rem', margin: '0 0 10px 0'}}>{c.name}</h3>
              </div>
            ))
          }
        </div>
      </div>
    );
  }

  // View 2: Chat Interface
  return (
    <div className="layout-container">
      <aside className="glass-panel" style={{width: '320px', margin: '20px 0 20px 20px', display: 'flex', flexDirection: 'column', overflow: 'hidden'}}>
        <div style={{padding: '14px 14px 10px 14px', borderBottom: '1px solid var(--panel-border)'}}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px'}}>
            <h3 style={{margin: 0, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '8px'}}>
              <Hash size={16} /> Chat History
            </h3>
            <button onClick={handleNewChat} className="send-btn" style={{padding: '6px 10px', fontSize: '0.8rem'}}>
              <Plus size={14} /> New
            </button>
          </div>
          <div style={{fontSize: '0.8rem', color: 'var(--text-secondary)'}}>{selectedClassroom.name}</div>
        </div>

        <div style={{flex: 1, overflowY: 'auto', padding: '8px'}}>
          {historyLoading ? (
            <p style={{fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '10px'}}>Loading history...</p>
          ) : sessionSummaries.length === 0 ? (
            <p style={{fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '10px'}}>No previous chats yet.</p>
          ) : (
            sessionSummaries.map((session) => (
              <button
                key={session.session_id}
                onClick={() => handleOpenHistorySession(session.session_id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: selectedSessionId === session.session_id ? 'var(--user-msg)' : 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--panel-border)',
                  borderRadius: '8px',
                  padding: '10px',
                  marginBottom: '8px',
                  color: '#fff'
                }}
              >
                <div style={{fontSize: '0.84rem', fontWeight: 600, marginBottom: '4px'}}>{session.preview || 'Untitled chat'}</div>
                <div style={{fontSize: '0.75rem', color: 'var(--text-secondary)'}}>
                  {session.turns} messages{session.created_at ? ` - ${new Date(session.created_at).toLocaleString()}` : ''}
                </div>
              </button>
            ))
          )}
        </div>

        <div style={{borderTop: '1px solid var(--panel-border)', padding: '10px 8px', maxHeight: '35%', overflowY: 'auto'}}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px'}}>
            <div style={{fontSize: '0.82rem', color: 'var(--text-secondary)'}}>Classroom Materials</div>
            <button
              onClick={handleDownloadAllNotes}
              className="send-btn"
              disabled={notes.length === 0 || downloadingAllNotes}
              style={{padding: '5px 8px', fontSize: '0.72rem'}}
              title="Download all materials as zip"
            >
              <Download size={12} /> {downloadingAllNotes ? '...' : 'All'}
            </button>
          </div>
          {notes.length === 0 ? (
            <p style={{fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0}}>No uploaded files yet.</p>
          ) : (
            notes.map((note) => (
              <div key={note} style={{display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px'}}>
                <div style={{flex: 1, minWidth: 0}} title={note}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px'}}>
                    <span style={{fontSize: '0.62rem', padding: '2px 6px', borderRadius: '999px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.35)', color: '#bfdbfe'}}>
                      {(notesMetaByName[note]?.file_type || 'FILE')}
                    </span>
                    <span style={{fontSize: '0.72rem', color: 'var(--text-secondary)'}}>{formatBytes(notesMetaByName[note]?.size_bytes || 0)}</span>
                  </div>
                  <div style={{fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{note}</div>
                </div>
                <button
                  onClick={() => handleDownloadNote(note)}
                  className="send-btn"
                  disabled={downloadingNote === note}
                  style={{padding: '6px 8px'}}
                  title="Download material"
                >
                  <Download size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="chat-container" style={{padding: '20px 20px 20px 10px'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 20px', borderBottom: '1px solid var(--panel-border)', marginBottom: '15px'}}>
          <h2 style={{fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', margin: 0}}>
            <Book size={18} /> {selectedClassroom.name}
          </h2>
          <button onClick={() => setSelectedClassroom(null)} style={{background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600}}>
            <ArrowLeft size={16}/> Back
          </button>
        </div>
        <div className="chat-history">
          {messages.map((msg, index) => (
            <div key={index} className={`message ${msg.role === 'user' ? 'user-message' : 'ai-message'}`}>
              <div className="message-bubble">
                <div style={{fontWeight: 600, marginBottom: '5px', fontSize: '0.85rem', opacity: 0.8}}>
                  {msg.role === 'user' ? 'You' : 'AI Tutor'}
                </div>
                {msg.content}
                
                {/* Citations block */}
                {msg.citations && msg.citations.length > 0 && (
                  <div style={{marginTop: '15px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '0.8rem', color: 'var(--text-secondary)'}}>
                    {msg.citations.map((cite, i) => (
                      <span key={i} style={{display: 'block'}}>
                        (File: {cite.file}, Page: {cite.page})
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="message ai-message">
              <div className="message-bubble" style={{opacity: 0.7}}>Tutor is thinking...</div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form className="input-area" onSubmit={handleSend}>
          <input 
            type="text" 
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about your course notes..."
            disabled={loading}
          />
          <button type="submit" className="send-btn" disabled={loading || !input.trim()}>
            <Send size={18} />
          </button>
        </form>
      </main>
    </div>
  );
}
