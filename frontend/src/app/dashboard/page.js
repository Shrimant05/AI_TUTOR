"use client";

import { useState, useEffect, useMemo } from 'react';
import { apiClient as axios } from '../../lib/apiClient';
import { useRouter } from 'next/navigation';
import { UploadCloud, FileText, Users, AlertTriangle, Trash2, Database, LogOut, Plus, BookOpen, Eye, Download } from 'lucide-react';
import { loadAuthSession, clearAuthSession, syncAuthSessionWithServer } from '../../lib/authStorage';
import { Bar, Radar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, PointElement, RadarController, RadialLinearScale, Filler, LineElement
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, PointElement, RadarController, RadialLinearScale, Filler, LineElement);

export default function Dashboard() {
  const router = useRouter();
  const [auth, setAuth] = useState(null);
  const [classrooms, setClassrooms] = useState([]);
  const [selectedClassroom, setSelectedClassroom] = useState(null);
  
  const [stats, setStats] = useState({
    total_queries: 0, active_students: 0, heatmap_data: [], student_activity: []
  });
  const [studentInsights, setStudentInsights] = useState([]);
  const [topicStudents, setTopicStudents] = useState([]);
  const [notes, setNotes] = useState([]);
  const [topicMatrix, setTopicMatrix] = useState({ labels: [], matrix: [] });
  const [topicClusters, setTopicClusters] = useState([]);
  const [latencyStats, setLatencyStats] = useState({
    measured_responses: 0,
    overall_avg_response_time_ms: 0,
    overall_max_response_time_ms: 0,
    users: [],
  });
  
  const [uploading, setUploading] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [deletingClassroomId, setDeletingClassroomId] = useState(null);
  const [actionMessage, setActionMessage] = useState("");
  const [newRoomName, setNewRoomName] = useState("");
  const [downloadingNote, setDownloadingNote] = useState("");
  const [viewingNote, setViewingNote] = useState("");

  const buildFallbackMatrix = (items) => {
    const labels = (items || []).map((item) => item.topic).filter(Boolean).slice(0, 8);
    const scoreByTopic = Object.fromEntries((items || []).map((item) => [item.topic, Number(item.score || item.confusion_score || 0)]));

    if (labels.length === 0) return { labels: [], matrix: [] };

    const matrix = labels.map((rowLabel, i) =>
      labels.map((colLabel, j) => {
        if (i === j) return 1;
        const a = Number(scoreByTopic[rowLabel] || 0);
        const b = Number(scoreByTopic[colLabel] || 0);
        const denom = Math.max(a, b, 1);
        const similarity = 1 - Math.abs(a - b) / denom;
        return Number((similarity * 0.6 - 0.3).toFixed(2));
      })
    );

    return { labels, matrix };
  };

  const buildFallbackClusters = (items) => {
    // Generate bubble chart data from topic student insights or heatmap data
    const clusters = [];
    
    if (Array.isArray(items) && items.length > 0) {
      items.forEach((item, idx) => {
        const topic = item.topic || `Topic ${idx + 1}`;
        const freq = Number(item.frequency || item.count || (idx + 1) * 3);
        const conf = Number(item.confusion_score || Math.floor(Math.random() * 5));
        const rate = conf / (freq + 0.001);
        const r = Math.max(4, Math.min(35, Math.floor(rate * 25)));
        
        clusters.push({
          topic,
          x: freq,
          y: conf,
          r
        });
      });
    }
    
    return clusters;
  };

  const normalizedTopicMatrix = useMemo(() => {
    const rawLabels = Array.isArray(topicMatrix?.labels) ? topicMatrix.labels : [];
    const rawMatrix = Array.isArray(topicMatrix?.matrix) ? topicMatrix.matrix : [];

    if (rawLabels.length > 0 && rawMatrix.length === rawLabels.length) {
      const safeMatrix = rawLabels.map((_, i) => {
        const row = Array.isArray(rawMatrix[i]) ? rawMatrix[i] : [];
        return rawLabels.map((__, j) => {
          if (i === j) return 1;
          const val = Number(row[j]);
          return Number.isFinite(val) ? Math.max(-1, Math.min(1, val)) : 0;
        });
      });
      return { labels: rawLabels, matrix: safeMatrix };
    }

    // Fallback keeps matrix visible even when advanced endpoint returns partial/empty data.
    const fallbackItems = topicStudents.length > 0
      ? topicStudents.map((t) => ({ topic: t.topic, confusion_score: t.confusion_score }))
      : stats.heatmap_data;

    return buildFallbackMatrix(fallbackItems);
  }, [topicMatrix, topicStudents, stats.heatmap_data]);

  const normalizedTopicClusters = useMemo(() => {
    // If we have real cluster data, use it
    if (Array.isArray(topicClusters) && topicClusters.length > 0) {
      return topicClusters;
    }
    
    // Fallback: generate clusters from topic students or heatmap data
    const fallbackItems = topicStudents.length > 0
      ? topicStudents
      : (stats.heatmap_data ? (Array.isArray(stats.heatmap_data) ? stats.heatmap_data : []) : []);
    
    return buildFallbackClusters(fallbackItems);
  }, [topicClusters, topicStudents, stats.heatmap_data]);

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

      if (activeSession.role !== "faculty") {
        router.push("/student");
        return;
      }

      setAuth(activeSession);
      fetchClassrooms();
    };

    initializeAuth();
  }, []);

  useEffect(() => {
    if (!selectedClassroom) return;
    
    fetchStats();
    fetchNotes();
    fetchStudentInsights();
    fetchTopicStudents();
    fetchAdvancedAnalytics();
    fetchLatencyStats();
  }, [selectedClassroom]);

  const fetchClassrooms = async () => {
    try {
      const res = await axios.get(`/api/classrooms?t=${new Date().getTime()}`);
      const fetchedClassrooms = res.data.classrooms || [];
      setClassrooms(fetchedClassrooms);
      if (fetchedClassrooms.length > 0 && !selectedClassroom) {
        setSelectedClassroom(fetchedClassrooms[fetchedClassrooms.length - 1]); // Auto-select most recent one on initial load
      }
      return fetchedClassrooms;
    } catch (e) {
      if (e.response?.status === 401) {
        clearAuthSession();
        router.push("/login");
      }
      return [];
    }
  };

  const handleCreateClassroom = async () => {
    const roomName = newRoomName.trim();
    if (!roomName) {
      alert("Please enter a requested room name before clicking Create.");
      return;
    }

    setCreatingRoom(true);
    setActionMessage("Creating classroom...");
    try {
      await axios.post("/api/classrooms", { name: roomName });
      setNewRoomName("");

      const refreshedClassrooms = await fetchClassrooms();
      const createdRoom = [...refreshedClassrooms]
        .filter(c => c.name === roomName)
        .sort((a, b) => b.id - a.id)[0];

      if (createdRoom) {
        setSelectedClassroom(createdRoom);
      }

      setActionMessage(`Success! Classroom "${roomName}" created.`);
    } catch (e) {
      const errorMessage = "Failed to create classroom: " + (e.response?.data?.detail || e.message);
      setActionMessage(errorMessage);
      alert(errorMessage);
    } finally {
      setCreatingRoom(false);
    }
  };

  const handleDeleteClassroom = async (classroom) => {
    if (!classroom) return;

    const confirmed = window.confirm(
      `Delete classroom "${classroom.name}"? This will remove enrolled mappings, uploaded notes, vectors, and analytics for this classroom.`
    );
    if (!confirmed) return;

    setDeletingClassroomId(classroom.id);
    setActionMessage(`Deleting classroom "${classroom.name}"...`);
    try {
      await axios.delete(`/api/classrooms/${classroom.id}`);

      const refreshedClassrooms = await fetchClassrooms();
      if (selectedClassroom?.id === classroom.id) {
        setSelectedClassroom(refreshedClassrooms[0] || null);
      }

      setActionMessage(`Success! Classroom "${classroom.name}" deleted.`);
    } catch (e) {
      const detail = e.response?.data?.detail || e.response?.data?.message || e.message;
      const errorMessage = `Failed to delete classroom: ${detail}`;
      setActionMessage(errorMessage);
      alert(errorMessage);
    } finally {
      setDeletingClassroomId(null);
    }
  };

  const fetchStats = async () => {
    try {
      if (!selectedClassroom) return;
      const res = await axios.get(`/api/dashboard/stats?classroom_id=${selectedClassroom.id}&t=${Date.now()}`);
      setStats(res.data);
    } catch (e) {
      console.error('Failed to fetch stats:', e);
    }
  };

  const fetchStudentInsights = async () => {
    try {
      if (!selectedClassroom) return;
      const res = await axios.get(`/api/dashboard/student-insights?classroom_id=${selectedClassroom.id}&t=${Date.now()}`);
      setStudentInsights(res.data.student_insights || []);
    } catch (e) {
      setStudentInsights([]);
    }
  };

  const fetchAdvancedAnalytics = async () => {
    try {
      if (!selectedClassroom) return;
      const t = Date.now();
      const [matrixRes, clusterRes] = await Promise.all([
        axios.get(`/api/dashboard/topic-matrix?classroom_id=${selectedClassroom.id}&t=${t}`),
        axios.get(`/api/dashboard/topic-clusters?classroom_id=${selectedClassroom.id}&t=${t}`)
      ]);
      setTopicMatrix(matrixRes.data || { labels: [], matrix: [] });
      setTopicClusters(clusterRes.data.clusters || []);
    } catch (e) {
      setTopicMatrix({ labels: [], matrix: [] });
      setTopicClusters([]);
    }
  };

  const fetchTopicStudents = async () => {
    try {
      if (!selectedClassroom) return;
      const res = await axios.get(`/api/dashboard/topic-students?classroom_id=${selectedClassroom.id}&t=${Date.now()}`);
      console.log('Topic students:', res.data);
      setTopicStudents(res.data.topic_insights || []);
    } catch (e) {
      console.error('Failed to fetch topic students:', e);
      setTopicStudents([]);
    }
  };

  const fetchLatencyStats = async () => {
    try {
      if (!selectedClassroom) return;
      const res = await axios.get(`/api/dashboard/latency?classroom_id=${selectedClassroom.id}&t=${Date.now()}`);
      setLatencyStats({
        measured_responses: Number(res.data.measured_responses || 0),
        overall_avg_response_time_ms: Number(res.data.overall_avg_response_time_ms || 0),
        overall_max_response_time_ms: Number(res.data.overall_max_response_time_ms || 0),
        users: Array.isArray(res.data.users) ? res.data.users : [],
      });
    } catch (e) {
      setLatencyStats({
        measured_responses: 0,
        overall_avg_response_time_ms: 0,
        overall_max_response_time_ms: 0,
        users: [],
      });
    }
  };

  const fetchNotes = async () => {
    try {
      if (!selectedClassroom) return;
      const res = await axios.get(`/api/notes?classroom_id=${selectedClassroom.id}&t=${new Date().getTime()}`);
      setNotes(res.data.notes || []);
    } catch (e) {}
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !selectedClassroom) return;
    setUploading(true);
    setActionMessage("Uploading & Indexing into Vector DB...");
    
    const formData = new FormData();
    formData.append("file", file);
    formData.append("classroom_id", selectedClassroom.id);

    try {
      await axios.post("/api/upload_notes", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      setActionMessage(`Success! Indexed ${file.name}`);
      fetchNotes();
    } catch (err) {
      setActionMessage("Failed to upload document.");
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteNote = async (filename) => {
    if (!selectedClassroom || !confirm(`Are you sure you want to delete ${filename}?`)) return;
    setActionMessage(`Deleting ${filename}...`);
    try {
      await axios.delete(`/api/notes/${filename}?classroom_id=${selectedClassroom.id}`);
      setActionMessage(`Successfully deleted ${filename}`);
      fetchNotes();
    } catch (err) {
      setActionMessage("Failed to delete document.");
    }
  };

  const handleViewNote = async (filename) => {
    if (!selectedClassroom || !filename) return;
    const viewerWindow = window.open('', '_blank');
    if (!viewerWindow) {
      setActionMessage('Popup blocked. Please allow popups for this site to view documents.');
      return;
    }
    try {
      setViewingNote(filename);
      viewerWindow.document.title = `Opening ${filename}...`;
      viewerWindow.document.body.innerHTML = '<p style="font-family: sans-serif; padding: 16px;">Loading document...</p>';
      const res = await axios.get(`/api/notes/${encodeURIComponent(filename)}/view`, {
        params: { classroom_id: String(selectedClassroom.id) },
        responseType: 'blob',
      });
      const contentType = res.headers['content-type'] || 'application/octet-stream';
      const blob = new Blob([res.data], { type: contentType });
      const url = window.URL.createObjectURL(blob);
      viewerWindow.location.href = url;
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (err) {
      if (viewerWindow && !viewerWindow.closed) {
        viewerWindow.close();
      }
      setActionMessage('Failed to open document.');
    } finally {
      setViewingNote("");
    }
  };

  const handleDownloadNote = async (filename) => {
    if (!selectedClassroom || !filename) return;
    try {
      setDownloadingNote(filename);
      const res = await axios.get(`/api/notes/${encodeURIComponent(filename)}/download`, {
        params: { classroom_id: String(selectedClassroom.id) },
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.setAttribute('download', filename);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setActionMessage('Failed to download document.');
    } finally {
      setDownloadingNote("");
    }
  };

  const handleLogout = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();

    sessionStorage.setItem("logout_in_progress", "1");
    clearAuthSession();
    localStorage.removeItem("sessionId");
    delete axios.defaults.headers.common["Authorization"];

    try {
      router.replace("/login");
    } finally {
      window.location.href = "/login";
    }
  };

  if (!auth) return <div style={{padding: '50px', textAlign: 'center'}}>Loading...</div>;

  const chartData = {
    labels: stats.heatmap_data.map(d => d.topic),
    datasets: [{
      label: 'Confusion Rank',
      data: stats.heatmap_data.map(d => d.score),
      backgroundColor: 'rgba(255, 79, 107, 0.75)',
      borderColor: 'rgba(255, 79, 107, 1)',
      borderWidth: 1,
      borderRadius: 6,
      barThickness: 'flex',
      maxBarThickness: 45,
    }]
  };

  const studentNameById = Object.fromEntries(
    (studentInsights || []).map((student) => [student.user_id, student.student_name])
  );

  const latencyChartData = {
    labels: (latencyStats.users || []).map((u) => u.student_name || u.user_id),
    datasets: [
      {
        label: 'Average Response Time (ms)',
        data: (latencyStats.users || []).map((u) => Number(u.avg_response_time_ms || 0)),
        backgroundColor: 'rgba(79, 124, 255, 0.75)',
        borderColor: 'rgba(79, 124, 255, 1)',
        borderWidth: 1,
        borderRadius: 6,
      },
      {
        label: 'Maximum Response Time (ms)',
        data: (latencyStats.users || []).map((u) => Number(u.max_response_time_ms || 0)),
        backgroundColor: 'rgba(255, 159, 64, 0.75)',
        borderColor: 'rgba(255, 159, 64, 1)',
        borderWidth: 1,
        borderRadius: 6,
      },
    ],
  };

  return (
    <div style={{
  maxWidth: "1200px",
  margin: "0 auto",
  width: "100%",
  padding: "30px 10px 60px",
}}>
      
      {/* Header */}
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px'}}>
        <div>
          <h1 style={{fontSize: '2.2rem', fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '12px'}}>
            <img src="/logo.jpeg" alt="EDUXA" style={{ width: 42, height: 42, objectFit: 'contain', borderRadius: '10px' }} />
            <span><span className="logo-text">EDUXA</span> Faculty Dashboard</span>
          </h1>
          <p style={{color: 'var(--text-secondary)', margin: '5px 0 0 0'}}>
            Welcome, Professor {auth.username} &nbsp;&middot;&nbsp; Empowering Students to Think, Not Just Retrieve
          </p>
        </div>
        <button type="button" onClick={handleLogout} className="send-btn" style={{background: 'rgba(255,100,100,0.1)', color: 'var(--danger)', padding: '8px 16px', gap: '8px', alignItems: 'center', border: '1px solid rgba(255,79,107,0.2)'}}>
          <LogOut size={16} /> Logout
        </button>
      </div>
      
      {/* Classrooms Selector & Creator */}
      <div className="dashboard-grid" style={{marginBottom: '20px'}}>
        <div className="glass-panel" style={{display: 'flex', flexDirection: 'column', gap: '15px'}}>
          <h3 style={{margin: 0}}><BookOpen size={20} style={{verticalAlign: 'middle', marginRight: '8px'}} /> My Classrooms</h3>
          
          <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap'}}>
            {classrooms.length === 0 ? <p style={{fontSize: '0.9rem', color: 'var(--text-secondary)'}}>No classrooms yet. Create one below!</p> :
              classrooms.map(c => (
                <div 
                  key={c.id} 
                  onClick={() => setSelectedClassroom(c)}
                  style={{
                    padding: '12px 14px', borderRadius: '8px', cursor: 'pointer',
                    background: selectedClassroom?.id === c.id ? 'var(--accent-color)' : 'rgba(255,255,255,0.05)',
                    border: '1px solid',
                    borderColor: selectedClassroom?.id === c.id ? 'var(--accent-color)' : 'var(--panel-border)',
                    transition: '0.2s',
                    minWidth: '220px'
                  }}
                >
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px'}}>
                    <div>
                      <div style={{fontWeight: 600, color: '#fff'}}>{c.name}</div>
                      <div style={{fontSize: '0.8rem', color: selectedClassroom?.id === c.id ? 'rgba(255,255,255,0.8)' : 'var(--text-secondary)'}}>
                        Join Code: <strong style={{letterSpacing: '1px'}}>{c.join_code}</strong>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDeleteClassroom(c);
                      }}
                      disabled={deletingClassroomId === c.id}
                      title="Delete classroom"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--danger)',
                        cursor: deletingClassroomId === c.id ? 'not-allowed' : 'pointer',
                        opacity: deletingClassroomId === c.id ? 0.6 : 1,
                        padding: '2px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))
            }
          </div>

          <div style={{display: 'flex', gap: '10px', marginTop: '10px'}}>
            <input 
              type="text" 
              placeholder="E.g. CS 101 - Fall 2026 (Required)" 
              className="chat-input" 
              value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCreateClassroom();
                }
              }}
              style={{flex: 1}}
            />
            <button
              type="button"
              onClick={handleCreateClassroom}
              className="send-btn"
              style={{padding: '0 20px'}}
              disabled={creatingRoom}
            >
              <Plus size={18} /> {creatingRoom ? 'Creating...' : 'Create Room'}
            </button>
          </div>
        </div>
      </div>

      {selectedClassroom ? (
        <>
          <div className="dashboard-grid">
            <div className="stat-card glass-panel">
              <h3><FileText size={20} style={{verticalAlign: 'middle', marginRight: '8px'}}/> Total Queries Handled</h3>
              <p className="value">{stats.total_queries}</p>
            </div>
            <div className="stat-card glass-panel">
              <h3><Users size={20} style={{verticalAlign: 'middle', marginRight: '8px'}}/> Active Students</h3>
              <p className="value">{stats.active_students}</p>
            </div>
            <div className="stat-card glass-panel">
              <h3><AlertTriangle size={20} style={{verticalAlign: 'middle', marginRight: '8px'}}/> Avg Response Time</h3>
              <p className="value">{latencyStats.overall_avg_response_time_ms.toFixed(1)} ms</p>
            </div>
            <div className="stat-card glass-panel">
              <h3><AlertTriangle size={20} style={{verticalAlign: 'middle', marginRight: '8px'}}/> Max Response Time</h3>
              <p className="value">{latencyStats.overall_max_response_time_ms.toFixed(1)} ms</p>
            </div>
          </div>

          <div className="dashboard-grid" style={{ gridTemplateColumns: '1fr' }}>
            <div className="glass-panel chart-container" style={{ display: 'grid', gridTemplateColumns: 'minmax(400px, 1fr) minmax(400px, 1fr)', gap: 30 }}>
              
              {/* Correlation Matrix */}
              <div>
                <h3 style={{marginBottom: '20px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '10px'}}>
                  Topic-wise Confusion Matrix
                </h3>
                {normalizedTopicMatrix.labels.length === 0 ? <p style={{color: 'var(--text-secondary)'}}>Not enough data to form correlation matrix.</p> : (
                  <div style={{ overflowX: 'auto', paddingBottom: '10px', paddingTop: '40px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: `120px repeat(${normalizedTopicMatrix.labels.length}, minmax(40px, 1fr))` }}>
                      <div>&nbsp;</div>
                      {normalizedTopicMatrix.labels.map((l, i) => (
                        <div key={i} style={{ transform: 'rotate(-45deg)', transformOrigin: 'bottom left', whiteSpace: 'nowrap', fontSize: '0.75rem', paddingBottom: '5px' }}>
                          {l.substring(0, 15)}
                        </div>
                      ))}
                      {normalizedTopicMatrix.labels.map((label_y, i) => (
                        <div key={`row-${i}`} style={{ display: 'contents' }}>
                          <div style={{ fontWeight: 600, fontSize: '0.8rem', display: 'flex', alignItems: 'center', paddingRight: '10px' }}>
                            {label_y.substring(0, 15)}
                          </div>
                          {normalizedTopicMatrix.matrix[i].map((val, j) => {
                            let bgStr = 'transparent';
                            if (val < 0) bgStr = `rgba(255, 79, 107, ${Math.abs(val) * 0.85})`; // App Danger color
                            else if (val > 0) bgStr = `rgba(79, 124, 255, ${val * 0.85 + 0.15})`; // App Accent color
                            return (
                              <div key={`cell-${i}-${j}`} style={{
                                background: bgStr,
                                border: '1px solid rgba(255,255,255,0.04)',
                                height: '40px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '0.7rem', color: val > 0.4 || val < -0.4 ? '#ffffff' : 'var(--text-secondary)',
                                transition: 'all var(--transition)'
                              }}>
                                {val.toFixed(2)}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Clustering Star/Radar Chart */}
              <div>
                <h3 style={{marginBottom: '20px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '10px'}}>
                  Topic-wise Clustering of Questions
                </h3>
                {normalizedTopicClusters.length === 0 ? <p style={{color: 'var(--text-secondary)'}}>No clustering data available.</p> : (
                  <Radar
                    data={{
                      labels: normalizedTopicClusters.map(cluster => cluster.topic.replace('.pdf', '').substring(0, 20)),
                      datasets: [
                        {
                          label: 'Total Queries (Frequency)',
                          data: normalizedTopicClusters.map(cluster => cluster.x),
                          borderColor: 'rgba(79, 124, 255, 0.8)',
                          backgroundColor: 'rgba(79, 124, 255, 0.15)',
                          borderWidth: 2,
                          pointRadius: 5,
                          pointBackgroundColor: 'rgba(79, 124, 255, 1)',
                          pointBorderColor: '#fff',
                          pointBorderWidth: 2,
                          fill: true,
                        },
                        {
                          label: 'Confusion Frequency',
                          data: normalizedTopicClusters.map(cluster => cluster.y),
                          borderColor: 'rgba(255, 79, 107, 0.8)',
                          backgroundColor: 'rgba(255, 79, 107, 0.15)',
                          borderWidth: 2,
                          pointRadius: 5,
                          pointBackgroundColor: 'rgba(255, 79, 107, 1)',
                          pointBorderColor: '#fff',
                          pointBorderWidth: 2,
                          fill: true,
                        }
                      ]
                    }}
                    options={{
                      responsive: true,
                      plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 10, padding: 15, font: { size: 10 } } },
                      },
                      scales: {
                        r: {
                          beginAtZero: true,
                          grid: { color: 'rgba(255,255,255,0.1)' },
                          ticks: { color: 'var(--text-secondary)', font: { size: 9 } },
                          pointLabels: { color: 'var(--text)', font: { size: 10, weight: 500 } }
                        }
                      }
                    }}
                  />
                )}
              </div>
            </div>
          </div>
          
          <div className="dashboard-grid" style={{ gridTemplateColumns: 'minmax(400px, 2fr) minmax(300px, 1fr)', marginTop: '20px' }}>
            <div className="glass-panel chart-container">
              <h3 style={{marginBottom: '20px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '10px'}}>
                 Heatmap: Weakest Concepts in {selectedClassroom.name}
              </h3>
              <Bar 
                data={chartData} 
                options={{ 
                  responsive: true,
                  plugins: { legend: { position: 'top' }, title: { display: false } },
                  scales: { y: { beginAtZero: true, display: false } }
                }} 
              />
            </div>

            <div style={{display: 'flex', flexDirection: 'column', gap: '20px'}}>
              <div className="glass-panel upload-panel">
                <h3 style={{margin: 0}}>Classroom Materials</h3>
                <p style={{color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0, paddingBottom: '15px'}}>
                  Upload PDFs to explicitly ground AI answers for this room.
                </p>
                <label style={{cursor: 'pointer', display: 'inline-block', marginBottom: '15px'}}>
                  <div style={{
                    background: 'var(--accent-color)', padding: '12px 24px', borderRadius: '8px',
                    display: 'inline-flex', alignItems: 'center', gap: '10px', color: '#fff'
                  }}>
                    <UploadCloud size={20} />
                    {uploading ? 'Processing...' : 'Upload Notes'}
                  </div>
                  <input type="file" accept=".pdf,.txt" onChange={handleFileUpload} style={{display: 'none'}} disabled={uploading} />
                </label>

                <div>
                  <h4 style={{fontSize: '1rem', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px'}}>
                    <Database size={16}/> Active Vector Documents
                  </h4>
                  {notes.length === 0 ? (
                    <p style={{fontSize: '0.85rem', color: 'var(--text-secondary)'}}>No materials uploaded yet.</p>
                  ) : (
                    <ul style={{listStyle: 'none', padding: 0, margin: 0}}>
                      {notes.map(note => (
                        <li key={note} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '8px 12px', background: 'rgba(255,255,255,0.05)', 
                          borderRadius: '6px', marginBottom: '8px', fontSize: '0.9rem'
                        }}>
                          <span style={{whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '58%'}}>
                            {note}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <button
                              onClick={() => handleViewNote(note)}
                              disabled={viewingNote === note}
                              style={{background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px'}}
                              title="View document"
                            >
                              <Eye size={16} />
                            </button>
                            <button
                              onClick={() => handleDownloadNote(note)}
                              disabled={downloadingNote === note}
                              style={{background: 'transparent', border: 'none', color: 'var(--accent-color)', cursor: 'pointer', padding: '4px'}}
                              title="Download document"
                            >
                              <Download size={16} />
                            </button>
                            <button
                              onClick={() => handleDeleteNote(note)}
                              style={{background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '4px'}}
                              title="Delete and Purge Vectors"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {actionMessage && (
                  <div style={{marginTop: '15px', fontSize: '0.9rem', color: actionMessage.includes('Success') ? 'var(--success)' : 'var(--danger)'}}>
                    {actionMessage}
                  </div>
                )}
              </div>

              <div className="glass-panel" style={{padding: '20px', flex: 1}}>
                <h3 style={{marginBottom: '15px'}}><AlertTriangle size={18} style={{verticalAlign: 'middle'}}/> Activity Feed</h3>
                {stats.student_activity.length === 0 ? (
                  <p style={{color: 'var(--text-secondary)', fontSize: '0.9rem'}}>No student activity yet.</p>
                ) : (
                  <ul style={{listStyle: 'none', padding: 0, margin: 0}}>
                    {stats.student_activity.map((s, i) => (
                      <li key={i} style={{padding: '10px 0', borderBottom: 'i px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between'}}>
                        <span>
                          {s.student_name || studentNameById[s.user_id] || studentNameById[s.user] || (s.user ? `User Hash #${s.user.substring(0,8)}` : s.user_id)}
                        </span>
                        <span style={{color: 'var(--text-secondary)'}}>{s.count} queries</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Student-wise Query Tracking */}
            <div style={{marginTop: '30px'}}>
              <h2 style={{fontSize: '1.3rem', fontWeight: 600, marginBottom: '15px'}}>📊 Student-wise Query Tracking</h2>
              <div className="glass-panel" style={{padding: '20px', overflowX: 'auto'}}>
                {studentInsights.length === 0 ? (
                  <p style={{color: 'var(--text-secondary)'}}>No student queries yet.</p>
                ) : (
                  <table style={{width: '100%', borderCollapse: 'collapse'}}>
                    <thead>
                      <tr style={{borderBottom: '2px solid var(--panel-border)'}}>
                        <th style={{textAlign: 'left', padding: '10px', fontWeight: 600}}>Student Name</th>
                        <th style={{textAlign: 'center', padding: '10px', fontWeight: 600}}>Total Queries</th>
                        <th style={{textAlign: 'center', padding: '10px', fontWeight: 600}}>Doubts</th>
                        <th style={{textAlign: 'center', padding: '10px', fontWeight: 600}}>Help Requests</th>
                      </tr>
                    </thead>
                    <tbody>
                      {studentInsights.map((student, idx) => (
                        <tr key={idx} style={{borderBottom: '1px solid var(--panel-border)'}}>
                          <td style={{padding: '10px', fontSize: '0.9rem'}}>{student.student_name}</td>
                          <td style={{textAlign: 'center', padding: '10px', color: 'var(--accent-color)', fontWeight: 600}}>{student.total_queries}</td>
                          <td style={{textAlign: 'center', padding: '10px', color: student.doubts > 0 ? 'var(--danger)' : 'var(--success)'}}>{student.doubts}</td>
                          <td style={{textAlign: 'center', padding: '10px', color: student.help_requests > 0 ? '#ff9800' : 'var(--success)'}}>{student.help_requests}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Topic-wise Student Doubts */}
            <div style={{marginTop: '30px'}}>
              <h2 style={{fontSize: '1.3rem', fontWeight: 600, marginBottom: '15px'}}>🎯 Topic-wise Student Doubts</h2>
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px'}}>
                {topicStudents.length === 0 ? (
                  <p style={{color: 'var(--text-secondary)'}}>No topics with doubts yet.</p>
                ) : (
                  topicStudents.map((topic, idx) => (
                    <div key={idx} className="glass-panel" style={{padding: '15px'}}>
                      <h4 style={{margin: '0 0 10px 0', fontSize: '1rem', fontWeight: 600, color: 'var(--accent-color)'}}>{topic.topic}</h4>
                      <div style={{fontSize: '0.85rem', marginBottom: '10px'}}>
                        <div>Confusion Score: <span style={{fontWeight: 600, color: 'var(--danger)'}}>{topic.confusion_score}</span></div>
                        <div>Total Queries: <span style={{fontWeight: 600}}>{topic.frequency}</span></div>
                      </div>
                      <div style={{fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--panel-border)'}}>
                        <div style={{fontWeight: 600, marginBottom: '5px'}}>Students Struggling:</div>
                        {topic.struggling_students.length === 0 ? (
                          <p style={{margin: 0}}>No struggles recorded</p>
                        ) : (
                          <ul style={{listStyle: 'none', padding: 0, margin: 0}}>
                            {topic.struggling_students.map((student, sidx) => (
                              <li key={sidx} style={{padding: '3px 0'}}>• {student.student_name}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="dashboard-grid" style={{ gridTemplateColumns: '1fr', marginTop: '20px' }}>
            <div className="glass-panel chart-container">
              <h3 style={{marginBottom: '20px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '10px'}}>
                Latency vs User ({selectedClassroom.name})
              </h3>
              {latencyStats.users.length === 0 ? (
                <p style={{color: 'var(--text-secondary)'}}>No latency data recorded yet for this classroom.</p>
              ) : (
                <Bar
                  data={latencyChartData}
                  options={{
                    responsive: true,
                    plugins: {
                      legend: { position: 'top' },
                      title: { display: false },
                    },
                    scales: {
                      x: {
                        ticks: { color: 'var(--text-secondary)', maxRotation: 25, minRotation: 0 },
                        grid: { color: 'rgba(255,255,255,0.06)' },
                      },
                      y: {
                        beginAtZero: true,
                        ticks: { color: 'var(--text-secondary)' },
                        grid: { color: 'rgba(255,255,255,0.08)' },
                        title: {
                          display: true,
                          text: 'Milliseconds',
                          color: 'var(--text-secondary)',
                        },
                      },
                    },
                  }}
                />
              )}
              <p style={{marginTop: '10px', color: 'var(--text-secondary)', fontSize: '0.85rem'}}>
                Measured responses: {latencyStats.measured_responses}
              </p>
            </div>
          </div>
        </>
      ) : (
        <div style={{textAlign: 'center', padding: '50px', color: 'var(--text-secondary)'}}>
           Select or create a classroom above to manage it.
        </div>
      )}
    </div>
  );
}
