"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { PixelCharacter, AnimationPhase } from "@/components/PixelCharacter";

type Stage = 'password' | 'first' | 'transitioning' | 'second';

// Hook to detect mobile screen with SSR-safe handling
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
    // 768px threshold for mobile
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  // Return false during SSR, then actual value after mount
  if (!mounted) return false;
  return isMobile;
}

const CORRECT_PASSWORD = '3016';
const SESSION_KEY = 'urav_authenticated';
const TODAY_NOTES_KEY = 'urav_today_notes';
const TODAY_TASKS_KEY = 'urav_today_tasks';

// Helper to format relative time
function getRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  const weeks = Math.floor(diff / 604800000);
  
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return `${weeks}w ago`;
}

// Helper to format date
function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toISOString().split('T')[0].replace(/-/g, '.');
}

// Helper to render markdown text as HTML string
function renderMarkdownToHtml(text: string): string {
  if (!text) return '';
  
  let html = text
    // Escape HTML first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headers
    .replace(/^### (.+)$/gm, '<h3 class="text-[16px] font-semibold text-black mt-4 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-[18px] font-semibold text-black mt-5 mb-2">$1</h2>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // Line breaks (double newline = paragraph)
    .replace(/\n\n/g, '</p><p class="mb-3">')
    // Single line breaks
    .replace(/\n/g, '<br/>');
  
  // Wrap in paragraph
  return `<p class="mb-3">${html}</p>`;
}

// Helper to render simple markdown (bold text) as React nodes
function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;
  
  // Split by **text** pattern and render bold
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    return <span key={idx}>{part}</span>;
  });
}

export default function Home() {
  const [stage, setStage] = useState<Stage>('password');
  const [password, setPassword] = useState('');
  const [showAbout, setShowAbout] = useState(false);
  const [activeView, setActiveView] = useState<'home' | 'index' | 'ventures' | 'archive'>('home');
  const [isHydrated, setIsHydrated] = useState(false);
  const isMobile = useIsMobile();
  
  // Check session on mount
  useEffect(() => {
    const isAuthenticated = sessionStorage.getItem(SESSION_KEY);
    if (isAuthenticated === 'true') {
      setStage('second');
      setShowAbout(true);
    }
    setIsHydrated(true);
  }, []);
  
  // Save session when authenticated
  useEffect(() => {
    if (stage === 'second') {
      sessionStorage.setItem(SESSION_KEY, 'true');
    }
  }, [stage]);
  const [selectedFolder, setSelectedFolder] = useState<number>(0);
  
  // Map tab index to KPI array index: holding(0)->labs(2), intelligence(1)->studio(1), application(2)->evos(0)
  const tabToKpiIndex = [2, 1, 0]; // holding->labs, intelligence->studio, application->evos
  
  // Venture KPI data
  const ventureKPIs = [
    { // evos
      name: 'evos',
      metrics: [
        { label: 'revenue', value: 85, display: '$2.4M' },
        { label: 'raised', value: 60, display: '$5M' },
        { label: 'operators', value: 45, display: '120+' },
        { label: 'waitlist', value: 70, display: '2.4K' },
      ]
    },
    { // studio
      name: 'studio',
      metrics: [
        { label: 'revenue', value: 40, display: '$400K' },
        { label: 'raised', value: 0, display: '—' },
        { label: 'projects', value: 70, display: '45+' },
        { label: 'team', value: 20, display: '4' },
      ]
    },
    { // labs
      name: 'labs',
      metrics: [
        { label: 'experiments', value: 90, display: '30+' },
        { label: 'raised', value: 25, display: '$500K' },
        { label: 'launches', value: 35, display: '8' },
        { label: 'team', value: 15, display: '3' },
      ]
    },
    { // fund
      name: 'fund',
      metrics: [
        { label: 'deployed', value: 55, display: '$2M' },
        { label: 'raised', value: 80, display: '$10M' },
        { label: 'portfolio', value: 40, display: '15' },
        { label: 'exits', value: 20, display: '2' },
      ]
    },
  ];
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagsExpanded, setTagsExpanded] = useState(true);
  const [indexFilter, setIndexFilter] = useState<'all' | 'today'>('all');
  const [selectedNoteId, setSelectedNoteId] = useState<Id<"notes"> | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [indexSearch, setIndexSearch] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [todayNotes, setTodayNotes] = useState('');
  const [todayTasks, setTodayTasks] = useState<{text: string; completed: boolean}[]>([]);
  const [dailySaved, setDailySaved] = useState(false);
  
  // Load Today notes from localStorage on mount
  useEffect(() => {
    const savedNotes = localStorage.getItem(TODAY_NOTES_KEY);
    const savedTasks = localStorage.getItem(TODAY_TASKS_KEY);
    if (savedNotes) setTodayNotes(savedNotes);
    if (savedTasks) {
      try {
        setTodayTasks(JSON.parse(savedTasks));
      } catch (e) {
        console.error('Failed to parse saved tasks');
      }
    }
  }, []);
  
  // Auto-save Today notes to localStorage
  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem(TODAY_NOTES_KEY, todayNotes);
    }
  }, [todayNotes, isHydrated]);
  
  // Auto-save Today tasks to localStorage
  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem(TODAY_TASKS_KEY, JSON.stringify(todayTasks));
    }
  }, [todayTasks, isHydrated]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [archiveFilter, setArchiveFilter] = useState<string | null>(null);
  const [archiveFilterExpanded, setArchiveFilterExpanded] = useState(true);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [uploadForm, setUploadForm] = useState({ title: '', description: '', category: 'design' });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedArchiveImage, setSelectedArchiveImage] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  
  // Archive categories
  const archiveCategories = ['all', 'design', 'people', 'nature', 'food', 'travel', 'art', 'architecture'];
  
  const [newTask, setNewTask] = useState('');
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNoteTags, setNewNoteTags] = useState<string[]>([]);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState<string | null>(null);
  const [isEditingBody, setIsEditingBody] = useState(false);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const titleAutoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Reset editing state when switching notes
  useEffect(() => {
    setEditingTitle(null);
    setEditingBody(null);
    setIsEditingBody(false);
  }, [selectedNoteId]);
  
  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  
  // Format today's date
  const formatTodayDate = () => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const now = new Date();
    const dayName = days[now.getDay()];
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    return `${dayName} ${day}/${month} ${year}`;
  };
  
  const addTask = () => {
    if (newTask.trim()) {
      setTodayTasks(prev => [...prev, { text: newTask.trim(), completed: false }]);
      setNewTask('');
    }
  };
  
  const toggleTask = (idx: number) => {
    setTodayTasks(prev => prev.map((task, i) => 
      i === idx ? { ...task, completed: !task.completed } : task
    ));
  };
  
  // Fetch notes and tags from Convex
  const notesData = useQuery(api.content.getNotes, { tags: selectedTags.length > 0 ? selectedTags : undefined });
  const tagCategories = useQuery(api.content.getTagsByCategory);
  const createNoteMutation = useMutation(api.content.createNote);
  
  // Initialize editing body when note is selected
  useEffect(() => {
    if (selectedNoteId && notesData) {
      const note = notesData.find(n => n._id === selectedNoteId);
      if (note && editingBody === null) {
        setEditingBody(note.body || '');
      }
    }
  }, [selectedNoteId, notesData, editingBody]);
  const updateNoteMutation = useMutation(api.updateNotes.updateNote);
  const deleteNoteMutation = useMutation(api.updateNotes.deleteNote);
  const analyzeNoteAction = useAction(api.agent.analyzeNote);
  
  // Archive
  const archiveImagesData = useQuery(api.archive.getImages, archiveFilter ? { category: archiveFilter } : {});
  const generateUploadUrl = useMutation(api.archive.generateUploadUrl);
  const saveImageMutation = useMutation(api.archive.saveImage);
  const deleteImageMutation = useMutation(api.archive.deleteImage);
  
  // Random colors for new notes
  const noteColors = ['#4A7CFF', '#E85454', '#B8B8B8', '#E8E854', '#E8A854', '#2A2A2A', '#1A1A1A', '#E8A8A8'];
  
  const handleCreateNote = async () => {
    if (!newNoteTitle.trim()) return;
    
    const randomColor = noteColors[Math.floor(Math.random() * noteColors.length)];
    const noteCount = notesData?.length || 0;
    
    await createNoteMutation({
      title: newNoteTitle.trim(),
      body: '',
      color: randomColor,
      tags: newNoteTags,
      order: noteCount + 1,
    });
    
    setNewNoteTitle('');
    setNewNoteTags([]);
    setIsAddingTag(false);
    setNewTagInput('');
    setIsCreatingNote(false);
  };
  
  const toggleNewNoteTag = (tag: string) => {
    const tagName = tag.replace('#', '');
    setNewNoteTags(prev => 
      prev.includes(tagName) 
        ? prev.filter(t => t !== tagName)
        : [...prev, tagName]
    );
  };
  
  const handleAddCustomTag = () => {
    if (!newTagInput.trim()) return;
    const tagName = newTagInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (!newNoteTags.includes(tagName)) {
      setNewNoteTags(prev => [...prev, tagName]);
    }
    setNewTagInput('');
    setIsAddingTag(false);
  };
  
  const handleAnalyzeNote = async () => {
    if (!selectedNoteId || isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      await analyzeNoteAction({ noteId: selectedNoteId });
    } catch (error) {
      console.error('Error analyzing note:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };
  
  const handleSaveTitle = async (newTitle: string) => {
    if (!selectedNoteId || !newTitle.trim()) return;
    await updateNoteMutation({ id: selectedNoteId, title: newTitle.trim() });
    setEditingTitle(null);
  };
  
  const handleSaveBody = async (newBody: string) => {
    if (!selectedNoteId) return;
    await updateNoteMutation({ id: selectedNoteId, body: newBody });
  };
  
  // Debounced auto-save for note body
  const handleBodyChange = (newBody: string) => {
    setEditingBody(newBody);
    
    // Clear existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    
    // Set new timer for auto-save after 1 second of no typing
    autoSaveTimerRef.current = setTimeout(() => {
      if (selectedNoteId) {
        updateNoteMutation({ id: selectedNoteId, body: newBody });
      }
    }, 1000);
  };
  
  // Debounced auto-save for note title
  const handleTitleChange = (newTitle: string) => {
    setEditingTitle(newTitle);
    
    if (titleAutoSaveTimerRef.current) {
      clearTimeout(titleAutoSaveTimerRef.current);
    }
    
    titleAutoSaveTimerRef.current = setTimeout(() => {
      if (selectedNoteId && newTitle.trim()) {
        updateNoteMutation({ id: selectedNoteId, title: newTitle.trim() });
      }
    }, 1000);
  };
  
  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      if (titleAutoSaveTimerRef.current) clearTimeout(titleAutoSaveTimerRef.current);
    };
  }, []);
  
  const handleDeleteNote = async (noteId: Id<"notes">, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this note?')) {
      await deleteNoteMutation({ id: noteId });
      if (selectedNoteId === noteId) {
        setSelectedNoteId(null);
      }
    }
  };
  
  // Save daily note to index
  const saveDailyToIndex = async () => {
    if (!todayNotes.trim() && todayTasks.length === 0) return;
    
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-GB', { 
      weekday: 'long', 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric' 
    });
    
    // Format tasks as part of the body
    const tasksText = todayTasks.length > 0 
      ? `**Tasks:**\n${todayTasks.map(t => `[${t.completed ? '✓' : ' '}] ${t.text}`).join('\n')}\n\n`
      : '';
    
    const body = tasksText + (todayNotes || '');
    const noteCount = notesData?.length || 0;
    
    await createNoteMutation({
      title: `Daily: ${dateStr}`,
      body,
      color: '#B8B8B8',
      tags: ['daily'],
      order: noteCount + 1,
    });
    
    // Clear the daily note and tasks
    setTodayNotes('');
    setTodayTasks([]);
    setDailySaved(true);
    
    // Reset saved status after a moment
    setTimeout(() => setDailySaved(false), 3000);
  };
  
  // Auto-save daily note at 11pm
  useEffect(() => {
    const checkAutoSave = () => {
      const now = new Date();
      if (now.getHours() === 23 && now.getMinutes() === 0) {
        // Only save if there's content and not already saved today
        if ((todayNotes.trim() || todayTasks.length > 0) && !dailySaved) {
          saveDailyToIndex();
        }
      }
    };
    
    // Check every minute
    const interval = setInterval(checkAutoSave, 60000);
    return () => clearInterval(interval);
  }, [todayNotes, todayTasks, dailySaved]);
  
  // Handle image upload
  const handleImageUpload = async () => {
    if (!selectedFile || !uploadForm.title.trim()) return;
    
    setUploadStatus('uploading');
    
    try {
      // Get upload URL
      const uploadUrl = await generateUploadUrl();
      
      // Upload the file
      const result = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': selectedFile.type },
        body: selectedFile,
      });
      
      const { storageId } = await result.json();
      
      // Get image dimensions
      const img = new Image();
      const dimensions = await new Promise<{ width: number; height: number }>((resolve) => {
        img.onload = () => resolve({ width: img.width, height: img.height });
        img.src = URL.createObjectURL(selectedFile);
      });
      
      // Save to database
      await saveImageMutation({
        storageId,
        title: uploadForm.title.trim(),
        description: uploadForm.description.trim() || undefined,
        category: uploadForm.category,
        width: dimensions.width,
        height: dimensions.height,
      });
      
      // Show success
      setUploadStatus('success');
      
      // Reset form after delay
      setTimeout(() => {
        setSelectedFile(null);
        setUploadForm({ title: '', description: '', category: 'design' });
        setIsUploadingImage(false);
        setUploadStatus('idle');
      }, 1500);
    } catch (error) {
      console.error('Upload failed:', error);
      setUploadStatus('error');
      
      // Reset error after delay
      setTimeout(() => {
        setUploadStatus('idle');
      }, 3000);
    }
  };
  
  // Transform notes for display
  const indexItems = useMemo(() => {
    if (!notesData) return [];
    return notesData.map((note, idx) => ({
      _id: note._id,
      id: String(idx + 1).padStart(2, '0'),
      color: note.color,
      title: note.title,
      tags: note.tags,
      timestamp: getRelativeTime(note.createdAt),
      date: formatDate(note.createdAt),
      body: note.body,
      bullets: note.bullets || [],
      furtherQuestions: note.furtherQuestions || [],
      aiSummary: note.aiSummary || '',
      relatedNotes: note.relatedNotes || [],
      links: note.links || [],
      lastAnalyzed: note.lastAnalyzed,
    }));
  }, [notesData]);
  
  // Get selected note data
  const selectedNoteData = useMemo(() => {
    if (!selectedNoteId || !indexItems.length) return null;
    return indexItems.find(item => item._id === selectedNoteId) || null;
  }, [selectedNoteId, indexItems]);
  
  // Handle tag click from table - add to filter
  const handleTagClick = (tag: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger note selection
    const tagWithHash = `#${tag}`;
    if (!selectedTags.includes(tagWithHash)) {
      setSelectedTags(prev => [...prev, tagWithHash]);
    }
  };
  
  // Use fetched tag categories or fallback
  const displayTagCategories = tagCategories || {
    'A': ['#ai', '#architecture', '#art', '#automation'],
    'B': ['#backend', '#books', '#business'],
    'C': ['#code', '#creativity', '#crypto'],
    'D': ['#data', '#design', '#devops'],
    'E': ['#economics', '#engineering', '#experiments'],
    'F': ['#finance', '#frontend', '#future'],
    'L': ['#learning', '#life', '#links'],
    'M': ['#marketing', '#music', '#mental-models'],
    'N': ['#notes', '#networks'],
    'P': ['#philosophy', '#productivity', '#projects'],
    'S': ['#startups', '#systems', '#strategy'],
    'T': ['#tech', '#thinking', '#tools'],
    'W': ['#writing', '#work', '#web'],
  };
  
  const toggleTag = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) 
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  };
  
  const handlePhaseChange = useCallback((phase: AnimationPhase) => {
    // When first character exits right, start transition to second stage
    if (phase === 'exited_right' && stage === 'first') {
      setStage('transitioning');
    }
    // When second character settles, show the about text
    if (phase === 'settled' && stage === 'second') {
      setShowAbout(true);
    }
  }, [stage]);
  
  // After a brief delay, show the second stage
  useEffect(() => {
    if (stage === 'transitioning') {
      const timer = setTimeout(() => {
        setStage('second');
      }, 10);
      return () => clearTimeout(timer);
    }
  }, [stage]);
  
  // Handle password submission on Enter key
  const handlePasswordKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && password === CORRECT_PASSWORD && stage === 'password') {
      setStage('first');
    }
  };

  // Handle logout - clears session but keeps data in Convex
  const handleLogout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setStage('password');
    setShowAbout(false);
    setActiveView('home');
    setPassword('');
  };
  
  
  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.trim()) {
      setStage('first');
    }
  };
  
  return (
    <main className="h-screen w-screen bg-[#fffffc] relative overflow-hidden">
      {/* Password stage - character centered with password input */}
      {stage === 'password' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-4">
          <PixelCharacter 
            pixelSize={isMobile ? 2.5 : 3}
            startPhase="idle"
            autoWalk={false}
          />
          <div className="mt-8">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handlePasswordKeyDown}
              placeholder="enter password"
              className="px-4 py-2 text-[14px] text-center bg-transparent border-b border-black/20 focus:border-black/40 outline-none transition-colors w-48 placeholder:text-black/30 focus:placeholder:text-transparent"
              autoFocus
            />
          </div>
        </div>
      )}

      {/* ==================== MOBILE LAYOUT ==================== */}
      {isMobile && stage === 'second' && (
        <>
          {/* Mobile Home - Character centered with nav underneath */}
          {activeView === 'home' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-6">
              <PixelCharacter 
                pixelSize={2} 
                startPhase="entering_left"
                startOffset={-150}
                walkSpeed={4}
                onPhaseChange={handlePhaseChange}
              />
              
              {/* Navigation underneath character */}
              <div 
                className="mt-12 flex flex-col items-center gap-6"
                style={{
                  opacity: showAbout ? 1 : 0,
                  transition: 'opacity 0.5s ease-in',
                }}
              >
                {/* Concealed logout - tap on "urav" */}
                <button 
                  onClick={handleLogout}
                  className="text-[14px] font-medium text-black mb-2 hover:text-black/60 transition-colors"
                >
                  urav
                </button>
                <div className="flex gap-6">
                  <button 
                    onClick={() => setActiveView('index')} 
                    className="text-[14px] font-medium text-black/40 hover:text-black transition-colors"
                  >
                    index
                  </button>
                  <button 
                    onClick={() => setActiveView('ventures')} 
                    className="text-[14px] font-medium text-black/40 hover:text-black transition-colors"
                  >
                    ventures
                  </button>
                  <button 
                    onClick={() => setActiveView('archive')} 
                    className="text-[14px] font-medium text-black/40 hover:text-black transition-colors"
                  >
                    archive
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Mobile Index View */}
          {activeView === 'index' && !selectedNoteId && (
            <div className="absolute inset-0 flex flex-col bg-[#fffffc]">
              {/* Header with back button and filters */}
              <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <button 
                  onClick={() => setActiveView('home')}
                  className="text-[14px] text-black/50 hover:text-black"
                >
                  ← back
                </button>
                <div className="flex gap-4">
                  <button
                    onClick={() => setIndexFilter('all')}
                    className={`text-[14px] ${indexFilter === 'all' ? 'text-black font-medium' : 'text-black/40'}`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setIndexFilter('today')}
                    className={`text-[14px] ${indexFilter === 'today' ? 'text-black font-medium border border-black px-2' : 'text-black/40'}`}
                  >
                    Today
                  </button>
                </div>
              </div>
              
              {/* Notes list or Today view */}
              <div className="flex-1 overflow-y-auto px-4 pb-4">
                {indexFilter === 'all' ? (
                  <div className="space-y-3 pt-2">
                    {indexItems.map((note, index) => (
                      <div 
                        key={note._id}
                        onClick={() => setSelectedNoteId(note._id)}
                        className="flex items-start gap-3 py-2 border-b border-black/5 cursor-pointer"
                      >
                        <span className="text-[12px] text-black/30 w-6">{String(index + 1).padStart(2, '0')}</span>
                        <div 
                          className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" 
                          style={{ backgroundColor: note.color }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-medium text-black truncate">{note.title}</p>
                          <p className="text-[12px] text-black/40">{note.timestamp}</p>
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={() => setIsCreatingNote(true)}
                      className="text-[14px] text-black/30 hover:text-black pt-2"
                    >
                      + New note
                    </button>
                  </div>
                ) : (
                  /* Today view for mobile */
                  <div className="pt-4">
                    <p className="text-[18px] font-medium text-black mb-6">
                      {currentTime.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </p>
                    <div className="space-y-4">
                      <div>
                        <p className="text-[12px] text-black/50 uppercase mb-2">Tasks</p>
                        {todayTasks.map((task, idx) => (
                          <div key={idx} className="flex items-center gap-2 py-1">
                            <button onClick={() => toggleTask(idx)} className="text-[14px] text-black/50">
                              [{task.completed ? '✓' : ' '}]
                            </button>
                            <span className={`text-[14px] ${task.completed ? 'text-black/40 line-through' : 'text-black'}`}>
                              {task.text}
                            </span>
                          </div>
                        ))}
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-[14px] text-black/30">[+]</span>
                          <input
                            type="text"
                            value={newTask}
                            onChange={(e) => setNewTask(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addTask()}
                            placeholder="Add task..."
                            className="flex-1 text-[14px] bg-transparent outline-none placeholder:text-black/30"
                          />
                        </div>
                      </div>
                      <div className="h-px bg-black/10" />
                      <div>
                        <p className="text-[12px] text-black/50 uppercase mb-2">Notes</p>
                        <textarea
                          value={todayNotes}
                          onChange={(e) => setTodayNotes(e.target.value)}
                          placeholder="Capture your thoughts..."
                          className="w-full text-[14px] bg-transparent outline-none resize-none placeholder:text-black/30 overflow-y-auto"
                          style={{ height: 'calc(100vh - 420px)' }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Mobile Note Detail View */}
          {activeView === 'index' && selectedNoteId && selectedNoteData && (
            <div className="absolute inset-0 flex flex-col bg-[#fffffc]">
              <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <button 
                  onClick={() => setSelectedNoteId(null)}
                  className="text-[14px] text-black/50 hover:text-black"
                >
                  ← back
                </button>
                <button
                  onClick={async () => {
                    if (selectedNoteId) {
                      setIsAnalyzing(true);
                      try {
                        await analyzeNoteAction({ noteId: selectedNoteId });
                      } finally {
                        setIsAnalyzing(false);
                      }
                    }
                  }}
                  disabled={isAnalyzing}
                  className="text-[12px] text-black/40 hover:text-black disabled:opacity-30"
                >
                  {isAnalyzing ? 'analyzing...' : 'analyze'}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 pb-6">
                <input
                  value={editingTitle ?? selectedNoteData.title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  className="text-[20px] font-semibold text-black w-full bg-transparent outline-none mb-2"
                />
                <p className="text-[12px] text-black/40 mb-4">{selectedNoteData.date}</p>
                <div className="flex flex-wrap gap-2 mb-6">
                  {selectedNoteData.tags.map(tag => (
                    <span key={tag} className="text-[10px] text-black/60 border border-black/20 rounded px-2 py-0.5 uppercase">
                      {tag}
                    </span>
                  ))}
                </div>
                {isEditingBody ? (
                  <textarea
                    value={editingBody ?? selectedNoteData.body ?? ''}
                    onChange={(e) => handleBodyChange(e.target.value)}
                    onBlur={() => setIsEditingBody(false)}
                    autoFocus
                    className="w-full text-[14px] text-black/80 leading-[1.7] bg-transparent outline-none resize-none overflow-y-auto"
                    style={{ height: 'calc(100vh - 320px)' }}
                  />
                ) : (
                  <div
                    onClick={() => {
                      setIsEditingBody(true);
                      setEditingBody(selectedNoteData.body ?? '');
                    }}
                    className="text-[14px] text-black/80 leading-[1.7] cursor-text overflow-y-auto"
                    style={{ height: 'calc(100vh - 320px)' }}
                    dangerouslySetInnerHTML={{ 
                      __html: selectedNoteData.body 
                        ? renderMarkdownToHtml(selectedNoteData.body)
                        : '<p class="text-black/30">Tap to start writing...</p>'
                    }}
                  />
                )}
                {/* AI Summary section for mobile */}
                {selectedNoteData.aiSummary && (
                  <div className="mt-6 pt-4 border-t border-black/10">
                    <p className="text-[12px] font-medium text-black mb-2">brief</p>
                    <p className="text-[12px] text-black/70">{selectedNoteData.aiSummary}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Mobile Ventures View */}
          {activeView === 'ventures' && (
            <div className="absolute inset-0 flex flex-col bg-[#fffffc]">
              <div className="flex items-center px-4 pt-4 pb-2">
                <button 
                  onClick={() => setActiveView('home')}
                  className="text-[14px] text-black/50 hover:text-black"
                >
                  ← back
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 pb-6">
                <div className="flex gap-4 mb-6 border-b border-black/10 pb-2">
                  {ventureKPIs.map((venture, idx) => (
                    <button
                      key={venture.name}
                      onClick={() => setSelectedFolder(idx)}
                      className={`text-[14px] pb-2 ${selectedFolder === idx ? 'text-black font-medium border-b-2 border-black -mb-[2px]' : 'text-black/40'}`}
                    >
                      {venture.name}
                    </button>
                  ))}
                </div>
                <div className="space-y-4">
                  {ventureKPIs[tabToKpiIndex[selectedFolder]]?.metrics.map((metric, idx) => (
                    <div key={idx}>
                      <div className="flex justify-between text-[12px] mb-1">
                        <span className="text-black/50 uppercase">{metric.label}</span>
                        <span className="text-black">{metric.display}</span>
                      </div>
                      <div className="h-2 bg-black/10 relative">
                        <div className="h-full bg-black" style={{ width: `${(metric.value / 100) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Mobile Archive View */}
          {activeView === 'archive' && !selectedArchiveImage && (
            <div className="absolute inset-0 flex flex-col bg-[#fffffc]">
              <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <button 
                  onClick={() => setActiveView('home')}
                  className="text-[14px] text-black/50 hover:text-black"
                >
                  ← back
                </button>
                <button
                  onClick={() => setIsUploadingImage(true)}
                  className="text-[18px] text-black/40 hover:text-black"
                >
                  +
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 pb-6">
                {/* Category filters */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {archiveCategories.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setArchiveFilter(cat === 'all' ? null : cat)}
                      className={`text-[12px] px-2 py-1 rounded ${
                        (cat === 'all' && !archiveFilter) || archiveFilter === cat
                          ? 'bg-black text-white'
                          : 'bg-black/5 text-black/60'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                {/* Image grid */}
                <div className="grid grid-cols-2 gap-2">
                  {archiveImagesData?.map((image) => (
                    <div
                      key={image._id}
                      onClick={() => setSelectedArchiveImage(image._id)}
                      className="aspect-square bg-black/5 cursor-pointer overflow-hidden"
                    >
                      <img
                        src={image.url || ''}
                        alt={image.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[12px] text-black/30 text-center mt-4">
                  {archiveImagesData?.length || 0} images
                </p>
              </div>
            </div>
          )}

          {/* Mobile Archive Image Detail */}
          {activeView === 'archive' && selectedArchiveImage && (() => {
            const mobileSelectedImage = archiveImagesData?.find(img => img._id === selectedArchiveImage);
            if (!mobileSelectedImage) return null;
            return (
              <div className="absolute inset-0 flex flex-col bg-[#fffffc]">
                <div className="flex items-center justify-between px-4 pt-4 pb-2">
                  <button 
                    onClick={() => setSelectedArchiveImage(null)}
                    className="text-[14px] text-black/50 hover:text-black"
                  >
                    ← back
                  </button>
                  <button
                    onClick={async () => {
                      if (confirm('Delete this image?') && selectedArchiveImage) {
                        await deleteImageMutation({ id: selectedArchiveImage as Id<"archiveImages"> });
                        setSelectedArchiveImage(null);
                      }
                    }}
                    className="text-[14px] text-red-500/50 hover:text-red-500"
                  >
                    delete
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-4 pb-6">
                  <img
                    src={mobileSelectedImage.url || ''}
                    alt={mobileSelectedImage.title}
                    className="w-full h-auto mb-4"
                  />
                  <p className="text-[16px] font-medium text-black">{mobileSelectedImage.title}</p>
                  {mobileSelectedImage.description && (
                    <p className="text-[14px] text-black/60 mt-1">{mobileSelectedImage.description}</p>
                  )}
                  <p className="text-[12px] text-black/40 mt-2">{formatDate(mobileSelectedImage.uploadedAt)}</p>
                </div>
              </div>
            );
          })()}

          {/* Mobile Upload Modal */}
          {isUploadingImage && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#fffffc]/95 px-6">
              <div className="w-full max-w-sm">
                <div className="flex justify-between items-center mb-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <span className="text-[14px] text-black">{selectedFile ? selectedFile.name : 'choose file'}</span>
                    <input type="file" accept="image/*" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} className="hidden" />
                  </label>
                  <button onClick={() => { setIsUploadingImage(false); setSelectedFile(null); }} className="text-[12px] text-black/30">✕</button>
                </div>
                <input type="text" placeholder="title" value={uploadForm.title} onChange={(e) => setUploadForm(p => ({ ...p, title: e.target.value }))} className="w-full text-[14px] border-b border-black/10 pb-2 mb-4 outline-none bg-transparent placeholder:text-black/30" />
                <select value={uploadForm.category} onChange={(e) => setUploadForm(p => ({ ...p, category: e.target.value }))} className="w-full text-[14px] border-b border-black/10 pb-2 mb-6 outline-none bg-transparent">
                  {archiveCategories.filter(c => c !== 'all').map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
                <button onClick={handleImageUpload} disabled={!selectedFile || !uploadForm.title.trim()} className="text-[12px] text-black/50 hover:text-black disabled:opacity-30">
                  {uploadStatus === 'uploading' ? 'uploading...' : 'upload →'}
                </button>
              </div>
            </div>
          )}

          {/* Mobile New Note Modal */}
          {isCreatingNote && (
            <div className="absolute inset-0 z-20 flex flex-col bg-[#fffffc] px-4 pt-4">
              <div className="flex justify-between items-center mb-4">
                <span className="text-[14px] font-medium">New note</span>
                <button onClick={() => { setIsCreatingNote(false); setNewNoteTitle(''); setNewNoteTags([]); }} className="text-[12px] text-black/30">✕</button>
              </div>
              <input type="text" placeholder="Title" value={newNoteTitle} onChange={(e) => setNewNoteTitle(e.target.value)} className="w-full text-[16px] border-b border-black/10 pb-2 mb-4 outline-none bg-transparent placeholder:text-black/30" />
              <div className="flex flex-wrap gap-2 mb-4">
                {tagCategories && Object.values(tagCategories).flat().map((tag: string) => (
                  <button
                    key={tag}
                    onClick={() => setNewNoteTags(prev => prev.includes(tag.replace('#', '')) ? prev.filter(t => t !== tag.replace('#', '')) : [...prev, tag.replace('#', '')])}
                    className={`text-[11px] px-2 py-1 rounded ${newNoteTags.includes(tag.replace('#', '')) ? 'bg-black text-white' : 'bg-black/5 text-black/60'}`}
                  >
                    {tag.replace('#', '')}
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  if (newNoteTitle.trim()) {
                    createNoteMutation({
                      title: newNoteTitle.trim(),
                      body: '',
                      color: ['#4A7CFF', '#E85454', '#B8B8B8', '#E8E854'][Math.floor(Math.random() * 4)],
                      tags: newNoteTags,
                      order: (notesData?.length || 0) + 1,
                    });
                    setIsCreatingNote(false);
                    setNewNoteTitle('');
                    setNewNoteTags([]);
                  }
                }}
                disabled={!newNoteTitle.trim()}
                className="text-[14px] text-black/50 hover:text-black disabled:opacity-30 mt-auto mb-8"
              >
                create →
              </button>
            </div>
          )}
        </>
      )}

      {/* ==================== DESKTOP LAYOUT ==================== */}
      {/* Left column - Stage 2 layout (Desktop only) */}
      {!isMobile && stage === 'second' && (
        <div 
          className="absolute top-0 bottom-0 left-0 flex flex-col"
          style={{ width: '32%' }}
        >
          {/* Vertical divider line - fades in with content */}
          <div 
            className="absolute top-0 bottom-0 right-0 w-px bg-black"
            style={{
              opacity: showAbout ? 1 : 0,
              transition: 'opacity 0.5s ease-in',
            }}
          />
          {/* Header - date/time and urav */}
          <div 
            className="w-full px-[10%] pt-4 flex justify-between items-center"
            style={{
              opacity: showAbout ? 1 : 0,
              transition: 'opacity 0.5s ease-in',
            }}
          >
            <p className="text-[14px] text-black/50 tabular-nums">
              {currentTime.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })}
              {' '}
              {currentTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </p>
            <button 
              onClick={handleLogout}
              className="text-[14px] font-medium text-black hover:text-black/60 transition-colors cursor-pointer"
            >
              urav
            </button>
          </div>

          {/* Character - positioned near top */}
          <div className="flex items-start justify-center px-[10%] pt-4 pb-8">
            <PixelCharacter 
              pixelSize={1.5} 
              startPhase="entering_left"
              startOffset={-150}
              walkSpeed={4}
              onPhaseChange={handlePhaseChange}
            />
          </div>

          {/* Horizontal divider - extends from left padding to right edge (meets vertical line) */}
          <div 
            className="w-full pl-[10%]"
            style={{
              opacity: showAbout ? 1 : 0,
              transition: 'opacity 0.5s ease-in',
            }}
          >
            <div className="w-full h-px bg-black" />
          </div>

          {/* About section - shows when activeView is 'home' */}
          {activeView === 'home' && (
            <div 
              className="w-full px-[10%] pt-8 pb-8"
              style={{
                opacity: showAbout ? 1 : 0,
                transition: 'opacity 0.5s ease-in',
              }}
            >
              <p className="text-[14px] font-medium text-black text-right mb-2">
                about
              </p>
              <p className="text-[14px] font-normal text-[rgba(30,30,30,0.8)] leading-[1.6] text-right">
                Evos autonomously assesses your operations, designs the highest-ROI AI employees for your team, and deploys them to work within your existing stack and team. Each system is specialised to your company, your workflows, and your operational context. Multiplying the capability of your team and systems.
              </p>
            </div>
          )}
          
          {/* Ventures KPI section - shows when activeView is 'ventures' */}
          {activeView === 'ventures' && (
            <div 
              className="w-full px-[10%] pt-6 pb-8"
              style={{
                opacity: showAbout ? 1 : 0,
                transition: 'opacity 0.5s ease-in',
              }}
            >
              <p className="text-[12px] text-black/40 uppercase tracking-wider text-right mb-6">
                {ventureKPIs[tabToKpiIndex[selectedFolder]].name}
              </p>
              
              <div className="space-y-5">
                {ventureKPIs[tabToKpiIndex[selectedFolder]].metrics.map((metric, idx) => (
                  <div key={idx}>
                    <div className="flex items-baseline gap-2 mb-2 justify-end">
                      <span className="text-[11px] text-black/40 uppercase tracking-wide">
                        {metric.label}
                      </span>
                      <span className="text-[14px] text-black font-medium">
                        {metric.display}
                      </span>
                    </div>
                    {/* Dotted pixel progress bar */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-[20px] relative flex">
                        {/* Filled portion - dense dots */}
                        <div 
                          className="h-full relative overflow-hidden"
                          style={{ 
                            width: `${metric.value}%`,
                            background: `
                              radial-gradient(circle, black 1.5px, transparent 1.5px)
                            `,
                            backgroundSize: '5px 5px',
                          }}
                        />
                        {/* Divider line */}
                        <div className="w-[2px] h-full bg-black" />
                        {/* Unfilled portion - sparse dots */}
                        <div 
                          className="flex-1 h-full relative overflow-hidden"
                          style={{ 
                            background: `
                              radial-gradient(circle, rgba(0,0,0,0.2) 1.5px, transparent 1.5px)
                            `,
                            backgroundSize: '5px 5px',
                          }}
                        />
                      </div>
                      {/* Percentage */}
                      <span className="text-[14px] text-black/60 w-[45px] text-right">
                        {metric.value}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Index section - shows when activeView is 'index' */}
          {activeView === 'index' && (
            <div 
              className="w-full px-[10%] pt-6 pb-8 text-[12px] overflow-y-auto"
              style={{
                opacity: showAbout ? 1 : 0,
                transition: 'opacity 0.5s ease-in',
              }}
            >
              {/* Search by tags header */}
              <button 
                onClick={() => setTagsExpanded(!tagsExpanded)}
                className="flex items-center gap-1 text-black hover:opacity-60 transition-opacity mb-4"
              >
                <span>[{tagsExpanded ? '-' : '+'}]</span>
                <span>SEARCH BY TAGS</span>
              </button>
              
              {tagsExpanded && (
                <div className="grid grid-cols-2 gap-x-6 gap-y-0">
                  {Object.entries(displayTagCategories).map(([letter, tags]) => (
                    <div key={letter} className="mb-3">
                      {(tags as string[]).map((tag, idx) => (
                        <div key={tag} className="flex items-center gap-2 whitespace-nowrap">
                          {idx === 0 && <span className="w-3 text-black/50 flex-shrink-0">{letter}</span>}
                          {idx !== 0 && <span className="w-3 flex-shrink-0"></span>}
                          <button
                            onClick={() => toggleTag(tag)}
                            className="flex items-center gap-1 hover:opacity-60 transition-opacity whitespace-nowrap"
                          >
                            <span className="text-black/70 flex-shrink-0">[{selectedTags.includes(tag) ? '•' : ' '}]</span>
                            <span className="text-black">{tag}</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              
              {selectedTags.length > 0 && (
                <div className="mt-4 pt-4 border-t border-black/10">
                  <p className="text-black/50 mb-2">selected:</p>
                  <p className="text-black">{selectedTags.join(' ')}</p>
                </div>
              )}
            </div>
          )}
          
          {/* Archive section - shows when activeView is 'archive' */}
          {activeView === 'archive' && (
            <div 
              className="w-full px-[10%] pt-6 pb-8 text-[12px]"
              style={{
                opacity: showAbout ? 1 : 0,
                transition: 'opacity 0.5s ease-in',
              }}
            >
              {/* Filter header */}
              <button 
                onClick={() => setArchiveFilterExpanded(!archiveFilterExpanded)}
                className="flex items-center gap-1 text-black hover:opacity-60 transition-opacity mb-4"
              >
                <span>[{archiveFilterExpanded ? '-' : '+'}]</span>
                <span>FILTER BY TYPE</span>
              </button>
              
              {archiveFilterExpanded && (
                <div className="flex flex-col gap-1">
                  {archiveCategories.map(category => (
                    <button
                      key={category}
                      onClick={() => setArchiveFilter(category === 'all' ? null : category)}
                      className="flex items-center gap-2 hover:opacity-60 transition-opacity"
                    >
                      <span className="text-black/70">[{(archiveFilter === category) || (category === 'all' && !archiveFilter) ? '•' : ' '}]</span>
                      <span className="text-black/70">{category}</span>
                    </button>
                  ))}
                </div>
              )}
              
              {archiveFilter && (
                <div className="mt-4 pt-4 border-t border-black/10">
                  <p className="text-black/50 mb-2">selected:</p>
                  <p className="text-black">{archiveFilter}</p>
                </div>
              )}
            </div>
          )}

          {/* Spacer to push nav to bottom */}
          <div className="flex-1" />

          {/* Bottom navigation */}
          <div 
            className="w-full px-[10%] pb-6"
            style={{
              opacity: showAbout ? 1 : 0,
              transition: 'opacity 0.5s ease-in',
            }}
          >
            <div className="flex justify-end gap-4">
              <button 
                onClick={() => setActiveView('home')} 
                className={`text-[14px] font-medium transition-opacity ${activeView === 'home' ? 'text-black' : 'text-black/40 hover:text-black/60'}`}
              >
                home
              </button>
              <button 
                onClick={() => setActiveView('index')} 
                className={`text-[14px] font-medium transition-opacity ${activeView === 'index' ? 'text-black' : 'text-black/40 hover:text-black/60'}`}
              >
                index
              </button>
              <button 
                onClick={() => setActiveView('ventures')} 
                className={`text-[14px] font-medium transition-opacity ${activeView === 'ventures' ? 'text-black' : 'text-black/40 hover:text-black/60'}`}
              >
                ventures
              </button>
              <button 
                onClick={() => setActiveView('archive')} 
                className={`text-[14px] font-medium transition-opacity ${activeView === 'archive' ? 'text-black' : 'text-black/40 hover:text-black/60'}`}
              >
                archive
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Right section - Index list view (hide when note is selected) - Desktop only */}
      {!isMobile && stage === 'second' && activeView === 'index' && !selectedNoteId && (
        <div 
          className="absolute top-0 bottom-0 right-0 flex flex-col"
          style={{ 
            left: '32%',
            opacity: showAbout ? 1 : 0,
            transition: 'opacity 0.5s ease-in',
          }}
        >
          {/* Header row - changes based on filter */}
          <div className="flex justify-between items-end px-8 pt-6 pb-4">
            {/* Left side - search bar or date */}
            {indexFilter === 'all' ? (
              <div className="flex items-center gap-4 flex-1 max-w-md">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={indexSearch}
                    onChange={(e) => setIndexSearch(e.target.value)}
                    onFocus={() => setIsSearchFocused(true)}
                    onBlur={() => setIsSearchFocused(false)}
                    placeholder="index"
                    className="w-full text-[24px] font-normal text-black bg-transparent outline-none placeholder:text-black border-b border-black pb-1"
                  />
                </div>
                {/* Magnifying glass icon */}
                <svg 
                  className="w-5 h-5 text-black flex-shrink-0 mb-1" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <circle cx="11" cy="11" r="8" strokeWidth="2"/>
                  <path strokeLinecap="round" strokeWidth="2" d="M21 21l-4.35-4.35"/>
                </svg>
              </div>
            ) : (
              <h1 className="text-[24px] font-normal text-black">
                {formatTodayDate()}
          </h1>
            )}
            
            {/* Filters */}
            <div className="flex gap-6">
              <button
                onClick={() => setIndexFilter('all')}
                className={`text-[14px] font-medium transition-opacity ${indexFilter === 'all' ? 'text-black' : 'text-black/40 hover:text-black/60'}`}
              >
                All
              </button>
              <button
                onClick={() => setIndexFilter('today')}
                className={`text-[14px] font-medium transition-opacity ${indexFilter === 'today' ? 'text-black' : 'text-black/40 hover:text-black/60'}`}
              >
                Today
              </button>
            </div>
          </div>
          
          {/* All view - Index items list */}
          {indexFilter === 'all' && (
          <div className="flex-1 overflow-y-auto px-8 pt-6">
            {indexItems
              .filter(item => {
                if (!indexSearch.trim()) return true;
                const search = indexSearch.toLowerCase();
                return (
                  item.title.toLowerCase().includes(search) ||
                  item.body.toLowerCase().includes(search) ||
                  item.aiSummary.toLowerCase().includes(search) ||
                  item.tags.some(tag => tag.toLowerCase().includes(search))
                );
              })
              .map((item, idx) => (
              <div key={item._id}>
                {/* Item row */}
                <div 
                  onClick={() => setSelectedNoteId(item._id)}
                  className="group flex items-center py-3 gap-4 cursor-pointer hover:bg-black/[0.02] transition-colors -mx-2 px-2 rounded"
                >
                  {/* Number */}
                  <span className="text-[14px] text-black/50 w-6 flex-shrink-0">{item.id}</span>
                  
                  {/* Color indicator */}
                  <div 
                    className="w-3 h-3 flex-shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  
                  {/* Title and timestamp */}
                  <div className="flex-1 min-w-0">
                    <span className="text-[14px] font-medium text-black">{item.title}</span>
                    <span className="text-[14px] text-black/40"> — {item.timestamp}</span>
                  </div>
                  
                  {/* Tags - clickable to filter */}
                  <div className="flex gap-2 flex-shrink-0">
                    {item.tags.map(tag => (
                      <button 
                        key={tag}
                        onClick={(e) => handleTagClick(tag, e)}
                        className="text-[10px] text-black/60 border border-black/20 rounded px-2 py-0.5 uppercase hover:bg-black/5 transition-colors"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                  
                  {/* Delete button - appears on hover */}
                  <button
                    onClick={(e) => handleDeleteNote(item._id, e)}
                    className="opacity-0 group-hover:opacity-100 text-[12px] text-black/30 hover:text-red-500 transition-all flex-shrink-0"
                  >
                    ✕
                  </button>
                </div>
                
                {/* Divider line */}
                <div className="h-px bg-black/10" />
              </div>
            ))}
            
            {/* Bottom border */}
            <div className="h-px bg-black/10" />
            
            {/* Create new note */}
            <div className="py-3">
              {isCreatingNote ? (
                <div className="space-y-3">
                  {/* Title input row */}
                  <div className="flex items-center gap-4">
                    <span className="text-[14px] text-black/50 w-6">+</span>
                    <div className="w-3 h-3 bg-black/20 rounded-sm" />
                    <input
                      type="text"
                      value={newNoteTitle}
                      onChange={(e) => setNewNoteTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newNoteTitle.trim()) handleCreateNote();
                        if (e.key === 'Escape') {
                          setIsCreatingNote(false);
                          setNewNoteTitle('');
                          setNewNoteTags([]);
                        }
                      }}
                      placeholder="Note title..."
                      className="flex-1 text-[14px] bg-transparent outline-none placeholder:text-black/30"
                      autoFocus
                    />
                    <button
                      onClick={handleCreateNote}
                      disabled={!newNoteTitle.trim()}
                      className="text-[12px] text-black/50 hover:text-black transition-colors disabled:opacity-30"
                    >
                      create
                    </button>
                    <button
                      onClick={() => {
                        setIsCreatingNote(false);
                        setNewNoteTitle('');
                        setNewNoteTags([]);
                        setIsAddingTag(false);
                        setNewTagInput('');
                      }}
                      className="text-[12px] text-black/30 hover:text-black/50 transition-colors"
                    >
                      cancel
                    </button>
                  </div>
                  
                  {/* Tags selection - combine existing and custom tags */}
                  <div className="pl-10 flex flex-wrap gap-2">
                    {/* Show all existing tags from library */}
                    {Object.values(displayTagCategories).flat().slice(0, 20).map((tag) => {
                      const tagName = (tag as string).replace('#', '');
                      const isSelected = newNoteTags.includes(tagName);
                      return (
                        <button
                          key={tag as string}
                          onClick={() => toggleNewNoteTag(tag as string)}
                          className={`text-[10px] border rounded px-2 py-0.5 transition-colors ${
                            isSelected 
                              ? 'bg-black text-white border-black' 
                              : 'text-black/50 border-black/20 hover:border-black/40'
                          }`}
                        >
                          {tagName}
                        </button>
                      );
                    })}
                    
                    {/* Show custom tags that aren't in the library */}
                    {newNoteTags
                      .filter(tag => !Object.values(displayTagCategories).flat().some(t => (t as string).replace('#', '') === tag))
                      .map(tag => (
                        <button
                          key={`custom-${tag}`}
                          onClick={() => toggleNewNoteTag(tag)}
                          className="text-[10px] border rounded px-2 py-0.5 transition-colors bg-black text-white border-black"
                        >
                          {tag}
                        </button>
                      ))
                    }
                    
                    {/* Add custom tag button/input */}
                    {isAddingTag ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={newTagInput}
                          onChange={(e) => setNewTagInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleAddCustomTag();
                            if (e.key === 'Escape') {
                              setIsAddingTag(false);
                              setNewTagInput('');
                            }
                          }}
                          placeholder="tag name"
                          className="text-[10px] border border-black rounded px-2 py-0.5 w-20 outline-none"
                          autoFocus
                        />
                        <button
                          onClick={handleAddCustomTag}
                          className="text-[10px] text-black/50 hover:text-black"
                        >
                          ✓
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setIsAddingTag(true)}
                        className="text-[10px] border border-black rounded px-2 py-0.5 text-black hover:bg-black hover:text-white transition-colors"
                      >
                        +
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setIsCreatingNote(true)}
                  className="flex items-center gap-4 text-black/40 hover:text-black/60 transition-colors"
                >
                  <span className="text-[14px] w-6">+</span>
                  <span className="text-[14px]">New note</span>
                </button>
              )}
            </div>
          </div>
          )}
          
          {/* Today view - Daily notepad */}
          {indexFilter === 'today' && (
            <div className="flex-1 flex flex-col px-8 pt-6 pb-6">
              {/* Scrollable content area */}
              <div className="flex-1 overflow-y-auto">
                {/* Tasks section */}
                <div className="mb-8">
                  <p className="text-[12px] font-medium text-black/50 uppercase tracking-wide mb-4">Tasks</p>
                  
                  {/* Task list */}
                  <div className="space-y-2 mb-4">
                    {todayTasks.map((task, idx) => (
                      <div 
                        key={idx} 
                        className="flex items-center gap-3 group"
                      >
                        <button
                          onClick={() => toggleTask(idx)}
                          className="text-[14px] text-black/50 hover:text-black transition-colors"
                        >
                          [{task.completed ? '✓' : ' '}]
                        </button>
                        <span className={`text-[14px] ${task.completed ? 'text-black/40 line-through' : 'text-black'}`}>
                          {task.text}
                        </span>
                      </div>
                    ))}
                  </div>
                  
                  {/* Add task input */}
                  <div className="flex items-center gap-3">
                    <span className="text-[14px] text-black/30">[+]</span>
                    <input
                      type="text"
                      value={newTask}
                      onChange={(e) => setNewTask(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addTask()}
                      placeholder="Add a task..."
                      className="flex-1 text-[14px] bg-transparent outline-none placeholder:text-black/30"
                    />
                  </div>
                </div>
                
                {/* Divider */}
                <div className="h-px bg-black/10 mb-8" />
                
                {/* Notes section */}
                <div>
                  <p className="text-[12px] font-medium text-black/50 uppercase tracking-wide mb-4">Notes</p>
                  <textarea
                    value={todayNotes}
                    onChange={(e) => setTodayNotes(e.target.value)}
                    placeholder="Capture your thoughts..."
                    className="w-full text-[14px] text-black bg-transparent outline-none resize-none placeholder:text-black/30 leading-relaxed overflow-y-auto"
                    style={{ height: 'calc(100vh - 400px)' }}
                  />
                </div>
              </div>
              
              {/* Save to Index section - fixed at bottom */}
              <div className="pt-3 border-t border-black/10 flex items-center justify-between mt-auto">
                <p className="text-[11px] text-black/30">
                  auto-saves at 11pm
                </p>
                <button
                  onClick={saveDailyToIndex}
                  disabled={!todayNotes.trim() && todayTasks.length === 0}
                  className="text-[11px] text-black/50 hover:text-black transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {dailySaved ? '✓ saved' : 'save to index →'}
                </button>
        </div>
            </div>
          )}
        </div>
      )}
      
      {/* Right section - Ventures stacked cards - Desktop only */}
      {!isMobile && stage === 'second' && activeView === 'ventures' && (
        <div 
          className="absolute top-0 bottom-0 right-0"
          style={{ 
            left: '32%',
            opacity: showAbout ? 1 : 0,
            transition: 'opacity 0.5s ease-in',
          }}
        >
          {/* Single card view with tabs */}
          <div className="absolute top-6 left-0 right-0 bottom-8">
            {/* Navigation tabs */}
            <div className="flex gap-6 px-8 mb-4">
              <button
                onClick={() => setSelectedFolder(0)}
                className={`text-[16px] font-medium tracking-tight transition-colors ${
                  selectedFolder === 0 ? 'text-black' : 'text-black/30 hover:text-black/50'
                }`}
              >
                holding
              </button>
              <button
                onClick={() => setSelectedFolder(1)}
                className={`text-[16px] font-medium tracking-tight transition-colors ${
                  selectedFolder === 1 ? 'text-black' : 'text-black/30 hover:text-black/50'
                }`}
              >
                intelligence
              </button>
              <button
                onClick={() => setSelectedFolder(2)}
                className={`text-[16px] font-medium tracking-tight transition-colors ${
                  selectedFolder === 2 ? 'text-black' : 'text-black/30 hover:text-black/50'
                }`}
              >
                application
              </button>
            </div>
            
            {/* Cards container - one visible at a time, slide in/out */}
            <div className="relative w-full h-[calc(100%-50px)] overflow-hidden mx-8" style={{ width: 'calc(100% - 64px)' }}>
              {/* Card 0 - Holding/Labs */}
              <div 
                className="absolute inset-0 rounded-xl overflow-hidden transition-all duration-500 ease-out"
                style={{
                  background: 'rgba(30, 30, 30, 0.4)',
                  backdropFilter: 'blur(20px)',
                  transform: selectedFolder === 0 
                    ? 'translateX(0)' 
                    : selectedFolder > 0 
                      ? 'translateX(-110%)' 
                      : 'translateX(110%)',
                  opacity: selectedFolder === 0 ? 1 : 0,
                }}
              >
                {/* Background image */}
                <div 
                  className="absolute inset-0 opacity-60"
                  style={{ 
                    backgroundImage: 'url(/venture-mountains.png)',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center bottom',
                  }}
                />
                {/* Company name */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <span 
                    className="text-[140px] font-light text-white/80"
                    style={{ letterSpacing: '-10px' }}
                  >
                    xa Labs
                  </span>
                </div>
              </div>
              
              {/* Card 1 - Intelligence */}
              <div 
                className="absolute inset-0 rounded-xl overflow-hidden transition-all duration-500 ease-out"
                style={{
                  background: 'rgba(255, 255, 252, 0.2)',
                  backdropFilter: 'blur(20px)',
                  transform: selectedFolder === 1 
                    ? 'translateX(0)' 
                    : selectedFolder > 1 
                      ? 'translateX(-110%)' 
                      : 'translateX(110%)',
                  opacity: selectedFolder === 1 ? 1 : 0,
                }}
              >
                {/* Inner card */}
                <div className="absolute inset-6 rounded-xl overflow-hidden bg-[#e8e8e3]">
                  <div 
                    className="absolute inset-0"
                    style={{ 
                      backgroundImage: 'url(/venture-port.png)',
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  />
                  <div className="absolute inset-0 bg-black/30" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span 
                      className="text-[140px] font-light text-white/90"
                      style={{ letterSpacing: '-10px' }}
                    >
                      Evos
                    </span>
                  </div>
                </div>
              </div>
              
              {/* Card 2 - Application */}
              <div 
                className="absolute inset-0 rounded-xl overflow-hidden transition-all duration-500 ease-out"
                style={{
                  background: 'rgba(255, 255, 252, 0.2)',
                  backdropFilter: 'blur(20px)',
                  transform: selectedFolder === 2 
                    ? 'translateX(0)' 
                    : selectedFolder > 2 
                      ? 'translateX(-110%)' 
                      : 'translateX(110%)',
                  opacity: selectedFolder === 2 ? 1 : 0,
                }}
              >
                {/* Inner card */}
                <div className="absolute inset-6 rounded-xl overflow-hidden bg-[#e8e8e3]">
                  <div 
                    className="absolute inset-0"
                    style={{ 
                      backgroundImage: 'url(/venture-market.png)',
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  />
                  <div className="absolute inset-0 bg-black/30" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span 
                      className="text-[140px] font-light text-white/90"
                      style={{ letterSpacing: '-10px' }}
                    >
                      Evos
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Right section - Archive image grid - Desktop only */}
      {!isMobile && stage === 'second' && activeView === 'archive' && (
        <div 
          className="absolute top-0 bottom-0 right-0 flex flex-col"
          style={{ 
            left: '32%',
            opacity: showAbout ? 1 : 0,
            transition: 'opacity 0.5s ease-in',
          }}
        >
          {/* Header with upload button */}
          {!selectedArchiveImage && (
            <div className="flex justify-end items-center px-8 pt-4">
              <button
                onClick={() => setIsUploadingImage(true)}
                className="text-[18px] text-black/40 hover:text-black transition-colors"
              >
                +
              </button>
            </div>
          )}
          
          {/* Upload modal */}
          {isUploadingImage && (
            <div className="absolute inset-0 z-10 flex items-center justify-center" style={{ backgroundColor: 'rgba(255, 255, 252, 0.95)' }}>
              <div className="w-full max-w-sm px-8">
                <div className="flex justify-between items-center mb-4">
                  {/* Combined upload icon + button + file selector */}
                  <label className="flex items-center gap-2 cursor-pointer hover:opacity-70 transition-opacity">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-black">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <span className="text-[14px] text-black">
                      {selectedFile ? selectedFile.name : 'choose file'}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                      className="hidden"
                    />
                  </label>
                  <button
                    onClick={() => {
                      setIsUploadingImage(false);
                      setSelectedFile(null);
                      setUploadForm({ title: '', description: '', category: 'design' });
                    }}
                    className="text-[12px] text-black/30 hover:text-black"
                  >
                    ✕
                  </button>
                </div>
                
                {/* Title */}
                <input
                  type="text"
                  placeholder="title"
                  value={uploadForm.title}
                  onChange={(e) => setUploadForm(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full text-[14px] text-black bg-transparent border-b border-black/10 pb-2 mb-4 outline-none focus:border-black/30 placeholder:text-black/30"
                />
                
                {/* Description */}
                <input
                  type="text"
                  placeholder="description (optional)"
                  value={uploadForm.description}
                  onChange={(e) => setUploadForm(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full text-[14px] text-black bg-transparent border-b border-black/10 pb-2 mb-4 outline-none focus:border-black/30 placeholder:text-black/30"
                />
                
                {/* Category */}
                <select
                  value={uploadForm.category}
                  onChange={(e) => setUploadForm(prev => ({ ...prev, category: e.target.value }))}
                  className="w-full text-[14px] text-black bg-transparent border-b border-black/10 pb-2 mb-6 outline-none"
                >
                  {archiveCategories.filter(c => c !== 'all').map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                
                {/* Upload button */}
                {/* Upload button and status */}
                <div className="flex items-center gap-4">
                  <button
                    onClick={handleImageUpload}
                    disabled={!selectedFile || !uploadForm.title.trim() || uploadStatus === 'uploading'}
                    className="text-[12px] text-black/50 hover:text-black transition-colors disabled:opacity-30"
                  >
                    {uploadStatus === 'uploading' ? 'uploading...' : 'upload →'}
                  </button>
                  
                  {uploadStatus === 'success' && (
                    <span className="text-[12px] text-green-600">✓ uploaded</span>
                  )}
                  {uploadStatus === 'error' && (
                    <span className="text-[12px] text-red-500">✕ failed</span>
                  )}
                </div>
              </div>
            </div>
          )}
          
          {/* Image detail view */}
          {selectedArchiveImage && (() => {
            const image = archiveImagesData?.find(img => img._id === selectedArchiveImage);
            if (!image) return null;
            return (
              <div className="flex-1 flex flex-col items-center justify-center px-8 py-8">
                {/* Back button */}
                <button
                  onClick={() => setSelectedArchiveImage(null)}
                  className="absolute top-4 left-8 text-[12px] text-black/40 hover:text-black transition-colors"
                >
                  ← back
                </button>
                
                {/* Delete button */}
                <button
                  onClick={async () => {
                    if (confirm('Delete this image?')) {
                      await deleteImageMutation({ id: image._id });
                      setSelectedArchiveImage(null);
                    }
                  }}
                  className="absolute top-4 right-8 text-[12px] text-black/30 hover:text-red-500 transition-colors"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
                
                {/* Large centered image */}
                <div className="max-w-[70%] max-h-[70vh]">
                  {image.url && (
                    <img 
                      src={image.url} 
                      alt={image.title}
                      className="max-w-full max-h-[70vh] object-contain"
                    />
                  )}
                </div>
                
                {/* Title and description - right aligned */}
                <div className="w-full max-w-[70%] mt-3 text-right">
                  <h2 className="text-[14px] text-black">{image.title}</h2>
                  {image.description && (
                    <p className="text-[12px] text-black/50 mt-0.5">{image.description}</p>
                  )}
                  <p className="text-[11px] text-black/30 mt-1">
                    {new Date(image.uploadedAt).toLocaleDateString('en-GB', { 
                      day: '2-digit', 
                      month: '2-digit', 
                      year: 'numeric' 
                    })}
                  </p>
                </div>
              </div>
            );
          })()}
          
          {/* Image grid - clean rows */}
          {!selectedArchiveImage && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto px-8 pt-4 pb-4">
                <div className="grid grid-cols-3 gap-4 items-end">
                  {(archiveImagesData || []).map((image) => (
                    <div 
                      key={image._id}
                      onClick={() => setSelectedArchiveImage(image._id)}
                      className="hover:opacity-70 transition-opacity cursor-pointer overflow-hidden"
                      style={{ 
                        maxHeight: '280px',
                      }}
                    >
                      {image.url && (
                        <img 
                          src={image.url} 
                          alt={image.title}
                          className="w-full h-auto object-contain"
                          style={{
                            maxHeight: '280px',
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Image count at bottom - fixed */}
              {(archiveImagesData?.length || 0) > 0 && (
                <div className="px-8 pb-6 pt-2">
                  <p className="text-[12px] text-black/30 text-center">
                    {archiveImagesData?.length} images
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      
      {/* Note detail view - Desktop only */}
      {!isMobile && stage === 'second' && activeView === 'index' && selectedNoteId && selectedNoteData && (
        <div 
          className="absolute top-0 bottom-0 right-0 flex"
          style={{ 
            left: '32%',
            opacity: showAbout ? 1 : 0,
            transition: 'opacity 0.3s ease-in',
          }}
        >
          {/* Back button / close */}
          <button
            onClick={() => setSelectedNoteId(null)}
            className="absolute top-4 left-8 text-[12px] text-black/50 hover:text-black transition-colors"
          >
            ← back
          </button>
          
          {/* Main content - left side */}
          <div className="flex-1 px-8 pt-16 pr-8">
            {/* Editable Title - always editable, seamless */}
            <input
              type="text"
              value={editingTitle ?? selectedNoteData.title}
              onChange={(e) => handleTitleChange(e.target.value)}
              className="text-[18px] font-semibold text-black uppercase tracking-wide mb-2 w-full bg-transparent outline-none"
            />
            
            {/* Tags row - in containers like table */}
            <div className="flex gap-2 mb-8">
              {selectedNoteData.tags.map(tag => (
                <button 
                  key={tag} 
                  onClick={() => {
                    const tagWithHash = `#${tag}`;
                    if (!selectedTags.includes(tagWithHash)) {
                      setSelectedTags(prev => [...prev, tagWithHash]);
                    }
                    setSelectedNoteId(null);
                  }}
                  className="text-[10px] text-black/60 border border-black/20 rounded px-2 py-0.5 uppercase hover:bg-black/5 transition-colors"
                >
                  {tag}
                </button>
              ))}
            </div>
            
            {/* Note body - click to edit, renders markdown when not editing */}
            {isEditingBody ? (
              <textarea
                value={editingBody ?? selectedNoteData.body ?? ''}
                onChange={(e) => handleBodyChange(e.target.value)}
                onBlur={() => setIsEditingBody(false)}
                autoFocus
                placeholder="Start writing..."
                className="text-[14px] text-black/80 leading-[1.7] w-full max-w-[600px] bg-transparent outline-none resize-none placeholder:text-black/30 overflow-y-auto"
                style={{ height: 'calc(100vh - 220px)' }}
              />
            ) : (
              <div
                onClick={() => {
                  setIsEditingBody(true);
                  setEditingBody(selectedNoteData.body ?? '');
                }}
                className="text-[14px] text-black/80 leading-[1.7] w-full max-w-[600px] cursor-text overflow-y-auto"
                style={{ height: 'calc(100vh - 220px)' }}
                dangerouslySetInnerHTML={{ 
                  __html: selectedNoteData.body 
                    ? renderMarkdownToHtml(selectedNoteData.body)
                    : '<p class="text-black/30">Click to start writing...</p>'
                }}
              />
            )}
          </div>
          
          {/* Sidebar toggle button */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="absolute top-4 right-4 text-[12px] text-black/40 hover:text-black transition-colors z-10"
          >
            {sidebarCollapsed ? '←' : '→'}
          </button>
          
          {/* Sidebar - right side (collapsible) */}
          <div 
            className={`flex flex-col gap-4 border-l border-black/5 transition-all duration-300 overflow-y-auto ${
              sidebarCollapsed ? 'w-0 px-0 opacity-0' : 'w-56 px-4 opacity-100'
            }`}
            style={{ paddingTop: sidebarCollapsed ? 0 : '1rem', paddingBottom: '1rem' }}
          >
            {/* Date and timestamp */}
            <div className="min-w-[200px]">
              <p className="text-[14px] font-medium text-black">
                {selectedNoteData.date}
              </p>
              <p className="text-[12px] text-black/50">
                {selectedNoteData.timestamp}
              </p>
            </div>
            
            {/* Analyze Button */}
            <button
              onClick={handleAnalyzeNote}
              disabled={isAnalyzing}
              className="w-full py-2 text-[11px] font-medium border border-black/20 rounded hover:bg-black/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAnalyzing ? 'analyzing...' : selectedNoteData.lastAnalyzed ? 're-analyze' : 'analyze'}
            </button>
            
            {/* Bullets */}
            <div className="min-w-[200px]">
              <p className="text-[12px] font-medium text-black mb-2">bullets</p>
              {selectedNoteData.bullets && selectedNoteData.bullets.length > 0 ? (
                <div className="space-y-1">
                  {selectedNoteData.bullets.map((bullet, idx) => (
                    <p key={idx} className="text-[11px] text-black/70">• {renderMarkdown(bullet)}</p>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-black/30">click analyze to extract</p>
              )}
            </div>
            
            {/* Questions */}
            <div className="min-w-[200px]">
              <p className="text-[12px] font-medium text-black mb-2">questions</p>
              {selectedNoteData.furtherQuestions && selectedNoteData.furtherQuestions.length > 0 ? (
                <div className="space-y-1">
                  {selectedNoteData.furtherQuestions.map((q, idx) => (
                    <p key={idx} className="text-[11px] text-black/70">• {renderMarkdown(q)}</p>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-black/30">none yet</p>
              )}
            </div>
            
            {/* Brief */}
            <div className="min-w-[200px]">
              <p className="text-[12px] font-medium text-black mb-2">brief</p>
              {selectedNoteData.aiSummary ? (
                <p className="text-[11px] text-black/70 leading-relaxed">{renderMarkdown(selectedNoteData.aiSummary)}</p>
              ) : (
                <p className="text-[11px] text-black/30">none yet</p>
              )}
            </div>
            
            {/* Related */}
            <div className="min-w-[200px]">
              <p className="text-[12px] font-medium text-black mb-2">related</p>
              {selectedNoteData.relatedNotes && selectedNoteData.relatedNotes.length > 0 ? (
                <div className="space-y-1">
                  {selectedNoteData.relatedNotes.map((noteId, idx) => {
                    const relatedNote = indexItems.find(item => item._id === noteId);
                    return (
                      <button
                        key={idx}
                        onClick={() => setSelectedNoteId(noteId)}
                        className="text-[11px] text-black/70 hover:text-black transition-colors block text-left"
                      >
                        • {relatedNote?.title || 'Related note'}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] text-black/30">none found</p>
              )}
            </div>
            
            {/* Links */}
            <div className="min-w-[200px]">
              <p className="text-[12px] font-medium text-black mb-2">links</p>
              {selectedNoteData.links && selectedNoteData.links.length > 0 ? (
                <div className="space-y-1">
                  {selectedNoteData.links.map((link, idx) => (
                    <a
                      key={idx}
                      href={link.url}
            target="_blank"
            rel="noopener noreferrer"
                      className="text-[11px] text-blue-600 hover:underline block truncate"
          >
                      {link.title || link.url}
          </a>
                  ))}
        </div>
              ) : (
                <p className="text-[11px] text-black/30">none detected</p>
              )}
    </div>
          </div>
        </div>
      )}

      {/* Character container - Stage 1: Center of screen, walks off right */}
      {stage === 'first' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <PixelCharacter 
            pixelSize={3} 
            onPhaseChange={handlePhaseChange}
            startPhase="walking_right"
          />
        </div>
      )}
      </main>
  );
}
