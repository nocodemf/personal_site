"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { PixelCharacter, AnimationPhase } from "@/components/PixelCharacter";
import { KnowledgeHeatmap } from "@/components/KnowledgeHeatmap";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";

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
const PASSKEY_SESSION_KEY = 'urav_passkey_session';

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
  
  // Passkey authentication state
  const [isRegistering, setIsRegistering] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  
  // Passkey queries and actions
  const hasPasskeys = useQuery(api.passkey.hasPasskeys);
  const getRegistrationOptions = useAction(api.passkey.getRegistrationOptions);
  const verifyRegistration = useAction(api.passkey.verifyRegistration);
  const getAuthenticationOptions = useAction(api.passkey.getAuthenticationOptions);
  const verifyAuthentication = useAction(api.passkey.verifyAuthentication);
  const validateSession = useQuery(api.passkey.validateSession, 
    typeof window !== 'undefined' && localStorage.getItem(PASSKEY_SESSION_KEY)
      ? { token: localStorage.getItem(PASSKEY_SESSION_KEY)! }
      : "skip"
  );
  
  // Check session on mount (passkey session first, then legacy session)
  // Only auto-login if still on password stage - don't interrupt animation!
  useEffect(() => {
    // Skip if animation is already in progress
    if (stage !== 'password') {
      setIsHydrated(true);
      return;
    }
    
    // Check passkey session from localStorage
    const passkeyToken = localStorage.getItem(PASSKEY_SESSION_KEY);
    if (passkeyToken && validateSession?.valid) {
      setStage('second');
      setShowAbout(true);
      setIsHydrated(true);
      return;
    }
    
    // Fallback to legacy session
    const isAuthenticated = sessionStorage.getItem(SESSION_KEY);
    if (isAuthenticated === 'true') {
      setStage('second');
      setShowAbout(true);
    }
    setIsHydrated(true);
  }, [validateSession, stage]);
  
  // Save session when authenticated
  useEffect(() => {
    if (stage === 'second') {
      sessionStorage.setItem(SESSION_KEY, 'true');
    }
  }, [stage]);
  
  // Measure horizontal divider position so right-section cards align with it
  useEffect(() => {
    if (stage !== 'second' || !showAbout) return;
    const measure = () => {
      if (dividerLineRef.current) {
        const rect = dividerLineRef.current.getBoundingClientRect();
        setDividerTop(rect.top);
      }
    };
    // Measure after a short delay to let layout settle
    const timer = setTimeout(measure, 100);
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', measure);
    };
  }, [stage, showAbout]);
  
  // Handle biometric authentication (arrow click)
  const handleBiometricAuth = async () => {
    setAuthError(null);
    setIsAuthenticating(true);
    
    try {
      // Get authentication options from server (pass origin for domain matching)
      const optionsResponse = await getAuthenticationOptions({ origin: window.location.origin });
      if ('error' in optionsResponse && optionsResponse.error) {
        setAuthError(optionsResponse.error);
        setIsAuthenticating(false);
        return;
      }
      
      if (!optionsResponse.options) {
        setAuthError('Failed to get authentication options');
        setIsAuthenticating(false);
        return;
      }
      
      // Trigger biometric prompt
      const authResponse = await startAuthentication({ optionsJSON: optionsResponse.options });
      
      // Verify with server (pass origin for domain matching)
      const verification = await verifyAuthentication({ 
        response: authResponse,
        origin: window.location.origin,
      });
      
      if (verification.success && verification.sessionToken) {
        // Store session token
        localStorage.setItem(PASSKEY_SESSION_KEY, verification.sessionToken);
        // Start the animation
        setStage('first');
      } else {
        setAuthError(verification.error || 'Authentication failed');
      }
    } catch (error: unknown) {
      console.error('Biometric auth error:', error);
      if (error instanceof Error && error.name === 'NotAllowedError') {
        setAuthError('Authentication cancelled');
      } else {
        setAuthError('Authentication failed');
      }
    }
    
    setIsAuthenticating(false);
  };
  
  // Handle device registration (after PIN verification)
  const handleRegisterDevice = async () => {
    setAuthError(null);
    setIsRegistering(true);
    
    try {
      // Detect device name
      const userAgent = navigator.userAgent;
      let deviceName = 'Unknown Device';
      if (/iPhone/.test(userAgent)) deviceName = 'iPhone';
      else if (/iPad/.test(userAgent)) deviceName = 'iPad';
      else if (/Macintosh/.test(userAgent)) deviceName = 'MacBook';
      else if (/Android/.test(userAgent)) deviceName = 'Android';
      else if (/Windows/.test(userAgent)) deviceName = 'Windows PC';
      
      // Get registration options from server (pass origin for domain matching)
      const { options } = await getRegistrationOptions({ deviceName, origin: window.location.origin });
      
      // Trigger biometric enrollment
      const regResponse = await startRegistration({ optionsJSON: options });
      
      // Verify and store with server (pass origin for domain matching)
      const verification = await verifyRegistration({ 
        response: regResponse, 
        deviceName,
        origin: window.location.origin 
      });
      
      if (verification.success && verification.sessionToken) {
        // Store session token
        localStorage.setItem(PASSKEY_SESSION_KEY, verification.sessionToken);
        // Start the animation
        setStage('first');
      } else {
        setAuthError(verification.error || 'Registration failed');
      }
    } catch (error: unknown) {
      console.error('Registration error:', error);
      if (error instanceof Error && error.name === 'NotAllowedError') {
        setAuthError('Registration cancelled');
      } else {
        setAuthError('Registration failed');
      }
    }
    
    setIsRegistering(false);
  };
  const [selectedFolder, setSelectedFolder] = useState<number>(0);
  const [flippedCards, setFlippedCards] = useState<Record<number, boolean>>({});
  
  // Toggle card flip
  const toggleCardFlip = (cardIndex: number) => {
    setFlippedCards(prev => ({
      ...prev,
      [cardIndex]: !prev[cardIndex]
    }));
  };
  
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
  const [indexFilter, setIndexFilter] = useState<'all' | 'today' | 'graph'>('all');
  const [selectedNoteId, setSelectedNoteId] = useState<Id<"notes"> | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [indexSearch, setIndexSearch] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isSemanticSearch, setIsSemanticSearch] = useState(true); // Default to semantic search
  const [semanticResults, setSemanticResults] = useState<Array<{
    _id: Id<"notes">;
    title: string;
    body: string;
    tags: string[];
    aiSummary?: string;
    score: number;
  }> | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const semanticSearchAction = useAction(api.embeddings.semanticSearch);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);
  
  // Today notes - stored in Convex (server-side)
  const todayData = useQuery(api.dailyNotes.getToday, {});
  const updateTodayNotesMutation = useMutation(api.dailyNotes.updateNotes);
  const manualSaveToIndexAction = useAction(api.dailyNotes.manualSaveToIndex);
  
  // Task Bank - persistent task storage
  const todayTasks = useQuery(api.taskBank.getTodayTasks, {});
  const backlogTasks = useQuery(api.taskBank.getBacklog, {});
  
  // AI-generated today summary (updated every 30 min)
  const todaySummary = useQuery(api.dailyNotes.getTodaySummary, {});
  const addTaskMutation = useMutation(api.taskBank.addTask);
  const completeTaskMutation = useMutation(api.taskBank.completeTask);
  const uncompleteTaskMutation = useMutation(api.taskBank.uncompleteTask);
  const scheduleForTodayMutation = useMutation(api.taskBank.scheduleForToday);
  const dismissTaskMutation = useMutation(api.taskBank.dismissTask);
  const [showBacklog, setShowBacklog] = useState(false);
  
  // Local state for optimistic UI (syncs with Convex)
  const [localTodayNotes, setLocalTodayNotes] = useState('');
  const [dailySaved, setDailySaved] = useState(false);
  const todayNotesDebounceRef = useRef<NodeJS.Timeout | null>(null);
  
  // Sync local state with Convex data ONLY on initial load (not during typing)
  // Track which date we've initialized to handle day changes
  const initializedDateRef = useRef<string | null>(null);
  useEffect(() => {
    if (todayData) {
      // Initialize if we haven't, or if the date changed (new day)
      if (initializedDateRef.current !== todayData.date) {
        setLocalTodayNotes(todayData.notes);
        initializedDateRef.current = todayData.date;
      }
      // Always update savedToIndex flag from server (this doesn't affect cursor)
      setDailySaved(todayData.savedToIndex);
    }
  }, [todayData]);
  
  // Debounced save to Convex when notes change
  const handleTodayNotesChange = (newNotes: string) => {
    setLocalTodayNotes(newNotes);
    
    if (todayNotesDebounceRef.current) {
      clearTimeout(todayNotesDebounceRef.current);
    }
    
    todayNotesDebounceRef.current = setTimeout(() => {
      updateTodayNotesMutation({ notes: newNotes });
    }, 500); // Save after 500ms of no typing
  };
  const [currentTime, setCurrentTime] = useState(new Date());
  const [archiveFilter, setArchiveFilter] = useState<string | null>(null);
  const [archiveFilterExpanded, setArchiveFilterExpanded] = useState(true);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  // Multiple file upload support
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileMetadata, setFileMetadata] = useState<{ title: string; description: string }[]>([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [uploadCategory, setUploadCategory] = useState('design');
  const [selectedArchiveImage, setSelectedArchiveImage] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  
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
  
  // Ref to measure horizontal divider position for right-section alignment
  const dividerLineRef = useRef<HTMLDivElement>(null);
  const [dividerTop, setDividerTop] = useState<number>(0);

  // Chat interface (home dashboard)
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; role: 'user' | 'assistant'; text: string }>>([]);
  const [chatStatus, setChatStatus] = useState<'ready' | 'submitted' | 'error'>('ready');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [chatInput, setChatInput] = useState('');
  const chatAction = useAction(api.chat.sendMessage);

  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleChatSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || chatStatus !== 'ready') return;
    setChatInput('');

    // Add user message
    const userMsg = { id: `user-${Date.now()}`, role: 'user' as const, text };
    const assistantId = `assistant-${Date.now()}`;
    setChatMessages(prev => [...prev, userMsg]);
    setChatStatus('submitted');

    // Build messages for the Convex action (history + new message)
    const apiMessages = [...chatMessages, userMsg].map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.text,
    }));

    try {
      const reply = await chatAction({ messages: apiMessages });
      setChatMessages(prev => [...prev, { id: assistantId, role: 'assistant', text: reply }]);
      setChatStatus('ready');
    } catch (err: unknown) {
      console.error('Chat error:', err);
      setChatStatus('error');
      setChatMessages(prev => [
        ...prev,
        { id: assistantId, role: 'assistant', text: 'Something went wrong. Try again.' },
      ]);
      setTimeout(() => setChatStatus('ready'), 2000);
    }
  }, [chatInput, chatStatus, chatMessages, chatAction]);
  
  // Reset editing mode when switching notes (the actual values are set in the other useEffect)
  useEffect(() => {
    setIsEditingBody(false);
  }, [selectedNoteId]);
  
  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  
  // Semantic search with debounce
  useEffect(() => {
    // Clear previous timer
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    // If search is empty or semantic search is disabled, clear results
    if (!indexSearch.trim() || !isSemanticSearch) {
      setSemanticResults(null);
      setIsSearching(false);
      return;
    }

    // Debounce the search
    setIsSearching(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const results = await semanticSearchAction({
          query: indexSearch,
          limit: 20,
          tags: selectedTags.length > 0 ? selectedTags.map(t => t.replace('#', '')) : undefined,
        });
        setSemanticResults(results);
      } catch (error) {
        console.error('Semantic search failed:', error);
        setSemanticResults(null);
      } finally {
        setIsSearching(false);
      }
    }, 300); // 300ms debounce

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [indexSearch, isSemanticSearch, selectedTags, semanticSearchAction]);
  
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
      addTaskMutation({ text: newTask.trim() });
      setNewTask('');
    }
  };
  
  const toggleTask = (taskId: Id<"taskBank">, isCompleted: boolean) => {
    if (isCompleted) {
      uncompleteTaskMutation({ taskId });
    } else {
      completeTaskMutation({ taskId });
    }
  };
  
  // Fetch notes and tags from Convex
  const notesData = useQuery(api.content.getNotes, { tags: selectedTags.length > 0 ? selectedTags : undefined });
  const tagCategories = useQuery(api.content.getTagsByCategory);
  const createNoteMutation = useMutation(api.content.createNote);
  
  // Fetch backlinks for selected note
  const backlinksData = useQuery(
    api.knowledgeGraph.getBacklinks, 
    selectedNoteId ? { noteId: selectedNoteId } : "skip"
  );
  
  // Fetch heatmap data for graph view
  const heatmapData = useQuery(api.heatmap.getHeatmapData, {});
  
  // Initialize editing state when note is selected
  const prevNoteIdRef = useRef<Id<"notes"> | null>(null);
  useEffect(() => {
    if (selectedNoteId && notesData && selectedNoteId !== prevNoteIdRef.current) {
      const note = notesData.find(n => n._id === selectedNoteId);
      if (note) {
        setEditingTitle(note.title || '');
        setEditingBody(note.body || '');
        prevNoteIdRef.current = selectedNoteId;
      }
    }
  }, [selectedNoteId, notesData]);
  const updateNoteMutation = useMutation(api.updateNotes.updateNote);
  const deleteNoteMutation = useMutation(api.updateNotes.deleteNote);
  const removeTagMutation = useMutation(api.updateNotes.removeTagFromNote);
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
  
  const handleRemoveTag = async (tag: string) => {
    if (!selectedNoteId) return;
    await removeTagMutation({ noteId: selectedNoteId, tag });
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
  
  // Save daily note to index (manual button) - uses Convex mutation
  const saveDailyToIndex = async () => {
    const hasTasks = todayTasks && todayTasks.length > 0;
    if (!localTodayNotes.trim() && !hasTasks) return;
    
    const result = await manualSaveToIndexAction({});
    
    if (result.saved) {
      // Clear local notes state
      setLocalTodayNotes('');
      setDailySaved(true);
      
      // Reset saved status after a moment
      setTimeout(() => setDailySaved(false), 3000);
    }
  };
  
  // Cleanup debounce timers on unmount
  useEffect(() => {
    return () => {
      if (todayNotesDebounceRef.current) clearTimeout(todayNotesDebounceRef.current);
    };
  }, []);
  
  // Handle multiple file selection
  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    const fileArray = Array.from(files);
    setSelectedFiles(fileArray);
    setFileMetadata(fileArray.map(() => ({ title: '', description: '' })));
    setCurrentFileIndex(0);
  };

  // Update metadata for current file
  const updateCurrentFileMetadata = (field: 'title' | 'description', value: string) => {
    setFileMetadata(prev => {
      const updated = [...prev];
      updated[currentFileIndex] = { ...updated[currentFileIndex], [field]: value };
      return updated;
    });
  };

  // Navigate between files
  const goToPrevFile = () => {
    if (currentFileIndex > 0) {
      setCurrentFileIndex(currentFileIndex - 1);
    }
  };

  const goToNextFile = () => {
    if (currentFileIndex < selectedFiles.length - 1) {
      setCurrentFileIndex(currentFileIndex + 1);
    }
  };

  // Compress and resize image to reduce storage usage
  const compressImage = async (file: File, maxDimension = 2000, quality = 0.85): Promise<{ blob: Blob; width: number; height: number }> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      
      img.onload = () => {
        URL.revokeObjectURL(objectUrl); // Clean up immediately
        
        let { width, height } = img;
        
        // Scale down if larger than maxDimension
        if (width > maxDimension || height > maxDimension) {
          const ratio = Math.min(maxDimension / width, maxDimension / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        
        // Draw to canvas and compress
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve({ blob, width, height });
            } else {
              reject(new Error('Failed to compress image'));
            }
          },
          'image/jpeg',
          quality
        );
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to load image'));
      };
      
      img.src = objectUrl;
    });
  };

  // Handle image upload - with compression, batching, and error resilience
  const handleImageUpload = async () => {
    if (selectedFiles.length === 0) return;
    
    setUploadStatus('uploading');
    setUploadProgress({ current: 0, total: selectedFiles.length });
    
    let successCount = 0;
    const failedFiles: string[] = [];
    const BATCH_SIZE = 10;
    
    // Process in batches to avoid memory issues
    for (let batchStart = 0; batchStart < selectedFiles.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, selectedFiles.length);
      
      for (let i = batchStart; i < batchEnd; i++) {
        const file = selectedFiles[i];
        const metadata = fileMetadata[i];
        
        setUploadProgress({ current: i + 1, total: selectedFiles.length });
        
        try {
          // Compress image (reduces 5MB → ~300KB, saves storage)
          const { blob, width, height } = await compressImage(file);
          
          // Get upload URL
          const uploadUrl = await generateUploadUrl();
          
          // Upload the compressed file
          const result = await fetch(uploadUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'image/jpeg' },
            body: blob,
          });
          
          if (!result.ok) throw new Error(`HTTP ${result.status}`);
          
          const { storageId } = await result.json();
          
          // Save to database
          await saveImageMutation({
            storageId,
            title: metadata.title.trim() || undefined,
            description: metadata.description.trim() || undefined,
            category: uploadCategory,
            width,
            height,
          });
          
          successCount++;
          
          // Small delay between uploads to avoid rate limits
          await new Promise(r => setTimeout(r, 50));
          
        } catch (error) {
          console.error(`Failed to upload ${file.name}:`, error);
          failedFiles.push(file.name);
          // Continue with next file
        }
      }
      
      // Pause between batches to let browser breathe
      if (batchEnd < selectedFiles.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    
    // Show result
    if (failedFiles.length === 0) {
      setUploadStatus('success');
    } else if (successCount > 0) {
      console.log(`Uploaded ${successCount}/${selectedFiles.length}. Failed: ${failedFiles.join(', ')}`);
      setUploadStatus('success'); // Partial success
    } else {
      setUploadStatus('error');
    }
    
    // Reset form after delay
    setTimeout(() => {
      setSelectedFiles([]);
      setFileMetadata([]);
      setCurrentFileIndex(0);
      setUploadCategory('design');
      setIsUploadingImage(false);
      setUploadStatus('idle');
      setUploadProgress({ current: 0, total: 0 });
    }, 1500);
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
    // When second character starts entering, show the UI immediately
    // (UI fades in while character is still walking to position)
    if (phase === 'entering_left' && stage === 'second') {
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
      // If no passkeys registered, trigger registration after correct PIN
      if (hasPasskeys === false) {
        handleRegisterDevice();
      } else {
        // Fallback: allow PIN login if passkeys exist but biometric fails
        setStage('first');
      }
    }
  };

  // Handle logout - clears session but keeps data in Convex
  const handleLogout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(PASSKEY_SESSION_KEY);
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
      {/* Password stage - character centered with arrow or password input */}
      {stage === 'password' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-4">
          <PixelCharacter 
            pixelSize={isMobile ? 2.5 : 3}
            startPhase="idle"
            autoWalk={false}
          />
          <div className="mt-8 flex flex-col items-center">
            {/* Show arrow for biometric auth if passkeys exist */}
            {hasPasskeys === true ? (
              <button
                onClick={handleBiometricAuth}
                disabled={isAuthenticating}
                className="text-[24px] text-black/40 hover:text-black transition-colors disabled:opacity-50"
                aria-label="Authenticate with Face ID or Touch ID"
              >
                {isAuthenticating ? '...' : '→'}
              </button>
            ) : hasPasskeys === false ? (
              // No passkeys - show PIN input for first-time registration
              <div className="flex flex-col items-center gap-2">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handlePasswordKeyDown}
                  placeholder="enter pin to setup"
                  className="px-4 py-2 text-[14px] text-center bg-transparent border-b border-black/20 focus:border-black/40 outline-none transition-colors w-48 placeholder:text-black/30 focus:placeholder:text-transparent"
                  autoFocus
                  disabled={isRegistering}
                />
                {isRegistering && (
                  <span className="text-[12px] text-black/40">registering device...</span>
                )}
              </div>
            ) : (
              // Loading state while checking passkeys
              <span className="text-[14px] text-black/30">...</span>
            )}
            
            {/* Error message */}
            {authError && (
              <p className="mt-2 text-[12px] text-red-500">{authError}</p>
            )}
          </div>
        </div>
      )}

      {/* ==================== MOBILE LAYOUT ==================== */}
      {isMobile && stage === 'second' && (
        <>
          {/* Mobile Home - Character + dashboard */}
          {activeView === 'home' && (
            <div className="absolute inset-0 flex flex-col overflow-y-auto">
              {/* Character area */}
              <div className="flex flex-col items-center pt-8 pb-4 px-6 flex-shrink-0">
                <PixelCharacter 
                  pixelSize={2} 
                  startPhase="entering_left"
                  startOffset={-150}
                  walkSpeed={4}
                  onPhaseChange={handlePhaseChange}
                />
              </div>

              {/* Navigation underneath character */}
              <div 
                className="flex flex-col items-center gap-4 pb-6 flex-shrink-0"
                style={{
                  opacity: showAbout ? 1 : 0,
                  transition: 'opacity 0.5s ease-in',
                }}
              >
                <button 
                  onClick={handleLogout}
                  className="text-[14px] font-medium text-black mb-1 hover:text-black/60 transition-colors"
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

              {/* Divider */}
              <div 
                className="mx-6 h-px bg-black flex-shrink-0"
                style={{
                  opacity: showAbout ? 1 : 0,
                  transition: 'opacity 0.5s ease-in',
                }}
              />

              {/* Dashboard content */}
              <div 
                className="flex-1 px-6 pt-6 pb-8 space-y-6"
                style={{
                  opacity: showAbout ? 1 : 0,
                  transition: 'opacity 0.5s ease-in',
                }}
              >
                {/* AI Summary */}
                <div>
                  <p className="text-[11px] text-black/40 uppercase tracking-wider mb-3">today</p>
                  <p className="text-[14px] text-black/70 leading-[1.6]">
                    {todaySummary?.summary || "Start adding notes and tasks to get your daily summary."}
                  </p>
                </div>

                {/* Tasks */}
                <div>
                  <p className="text-[11px] text-black/40 uppercase tracking-wider mb-3">tasks</p>
                  {(todayTasks ?? []).length === 0 ? (
                    <p className="text-[13px] text-black/30">No tasks for today yet.</p>
                  ) : (
                    <div>
                      {(todayTasks ?? []).map((task, idx) => (
                        <div 
                          key={task._id}
                          className="flex items-center gap-3 py-2.5 border-b border-black/5 cursor-pointer"
                          onClick={() => toggleTask(task._id, task.status === 'completed')}
                        >
                          <span className="text-[12px] text-black/25 w-5 text-right tabular-nums flex-shrink-0 font-medium">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <div 
                            className="w-[6px] h-[6px] flex-shrink-0"
                            style={{ backgroundColor: task.status === 'completed' ? '#4ade80' : '#1a1a1a' }}
                          />
                          <span className={`text-[13px] flex-1 ${task.status === 'completed' ? 'text-black/35 line-through' : 'text-black'}`}>
                            {task.text}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Date + Events card */}
                <div className="border border-black p-5">
                  <div className="flex items-center gap-2 text-[12px] text-black/40 mb-4">
                    <span className="tabular-nums">{currentTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="text-black/20">|</span>
                    <span>London, England</span>
                  </div>
                  
                  <div className="mb-6">
                    <p className="text-[36px] text-black leading-[0.95] font-medium tracking-[-2px]">
                      {(() => {
                        const day = currentTime.getDate();
                        const suffix = day === 1 || day === 21 || day === 31 ? 'st' 
                          : day === 2 || day === 22 ? 'nd' 
                          : day === 3 || day === 23 ? 'rd' : 'th';
                        return `${day}${suffix}`;
                      })()}
                    </p>
                    <p className="text-[36px] text-black leading-[0.95] font-medium tracking-[-2px]">
                      {currentTime.toLocaleDateString('en-GB', { month: 'long' })}
                    </p>
                  </div>

                  <div className="h-px bg-black/10 mb-4" />

                  <p className="text-[11px] text-black/40 uppercase tracking-wider mb-3">events</p>
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex items-center gap-3">
                        <div className="w-[5px] h-[5px] bg-black/15 flex-shrink-0" />
                        <p className="text-[13px] text-black/25">Event name - time</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Chat interface */}
                <div className="border border-black/10 flex flex-col" style={{ minHeight: '300px' }}>
                  {/* Chat messages */}
                  <div className="flex-1 overflow-y-auto px-5 py-4" style={{ maxHeight: '400px' }}>
                    {chatMessages.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-center">
                        <p className="text-[13px] text-black/25 mb-1">ask me anything.</p>
                        <p className="text-[11px] text-black/15">i know your notes, tasks, and ideas.</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {chatMessages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`max-w-[85%] ${
                                msg.role === 'user'
                                  ? 'bg-black/[0.04] px-3.5 py-2 rounded-lg'
                                  : ''
                              }`}
                            >
                              <p
                                className={`text-[13px] leading-[1.7] whitespace-pre-wrap ${
                                  msg.role === 'user' ? 'text-black' : 'text-black/80'
                                }`}
                              >
                                {msg.text}
                              </p>
                            </div>
                          </div>
                        ))}

                        {chatStatus === 'submitted' && 
                          chatMessages[chatMessages.length - 1]?.role === 'user' && (
                          <div className="flex justify-start">
                            <div className="flex items-center gap-1.5 py-2">
                              <span className="chat-dot w-[5px] h-[5px] bg-black/30 rounded-full" style={{ animationDelay: '0ms' }} />
                              <span className="chat-dot w-[5px] h-[5px] bg-black/30 rounded-full" style={{ animationDelay: '150ms' }} />
                              <span className="chat-dot w-[5px] h-[5px] bg-black/30 rounded-full" style={{ animationDelay: '300ms' }} />
                            </div>
                          </div>
                        )}

                        <div ref={chatEndRef} />
                      </div>
                    )}
                  </div>

                  {/* Input */}
                  <form onSubmit={handleChatSubmit} className="flex-shrink-0 border-t border-black/10 px-5 py-3 flex items-center gap-3">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="message..."
                      disabled={chatStatus !== 'ready' && chatStatus !== 'error'}
                      className="flex-1 text-[13px] text-black bg-transparent outline-none placeholder:text-black/25 disabled:opacity-50"
                    />
                    <button
                      type="submit"
                      disabled={!chatInput.trim() || (chatStatus !== 'ready' && chatStatus !== 'error')}
                      className="text-black/30 hover:text-black transition-colors disabled:opacity-20 flex-shrink-0"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                      </svg>
                    </button>
                  </form>
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
                <div className="flex gap-2">
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
                  <button
                    onClick={() => setIndexFilter('graph')}
                    className={`text-[14px] ${indexFilter === 'graph' ? 'text-black font-medium' : 'text-black/40'}`}
                  >
                    Graph
                  </button>
                </div>
              </div>
              
              {/* Notes list, Today view, or Graph view */}
              {indexFilter === 'all' && (
                <div className="flex-1 overflow-y-auto px-4 pb-4">
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
                </div>
              )}
              
              {indexFilter === 'today' && (
                <div className="flex-1 flex flex-col px-4 pb-4 min-h-0">
                  {/* Today view for mobile */}
                  <div className="pt-4 flex-shrink-0">
                    <p className="text-[18px] font-medium text-black mb-6">
                      {currentTime.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </p>
                    <div>
                      <p className="text-[12px] text-black/50 uppercase mb-2">Tasks</p>
                      {(todayTasks ?? []).map((task) => (
                        <div key={task._id} className="flex items-center gap-2 py-1">
                          <button onClick={() => toggleTask(task._id, task.status === 'completed')} className="text-[14px] text-black/50">
                            [{task.status === 'completed' ? '✓' : ' '}]
                          </button>
                          <span className={`text-[14px] ${task.status === 'completed' ? 'text-black/40 line-through' : 'text-black'}`}>
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
                    
                    {/* Backlog section */}
                    {backlogTasks && backlogTasks.length > 0 && (
                      <div className="mt-4">
                        <button
                          onClick={() => setShowBacklog(!showBacklog)}
                          className="text-[12px] text-black/40 hover:text-black/60 transition-colors flex items-center gap-1"
                        >
                          <span className="text-[10px]">{showBacklog ? '▼' : '▶'}</span>
                          Backlog ({backlogTasks.length})
                        </button>
                        {showBacklog && (
                          <div className="mt-2 pl-2 border-l border-black/10 space-y-1">
                            {backlogTasks.map((task) => (
                              <div key={task._id} className="flex items-center gap-2 py-0.5 group">
                                <button
                                  onClick={() => scheduleForTodayMutation({ taskId: task._id })}
                                  className="text-[12px] text-black/30 hover:text-black transition-colors"
                                  title="Add to today"
                                >
                                  +
                                </button>
                                <span className="text-[13px] text-black/50 flex-1">{task.text}</span>
                                <button
                                  onClick={() => dismissTaskMutation({ taskId: task._id })}
                                  className="text-[12px] text-black/20 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                                  title="Dismiss"
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="h-px bg-black/10 my-4 flex-shrink-0" />
                  <div className="flex-1 flex flex-col min-h-0">
                    <p className="text-[12px] text-black/50 uppercase mb-2 flex-shrink-0">Notes</p>
                    <textarea
                      value={localTodayNotes}
                      onChange={(e) => handleTodayNotesChange(e.target.value)}
                      placeholder="Capture your thoughts..."
                      className="flex-1 w-full text-[14px] bg-transparent outline-none resize-none placeholder:text-black/30 overflow-y-auto min-h-0"
                    />
                  </div>
                </div>
              )}
              
              {indexFilter === 'graph' && (
                <div className="flex-1 overflow-hidden">
                  {heatmapData && heatmapData.length > 0 ? (
                    <KnowledgeHeatmap
                      notes={heatmapData}
                      onNoteClick={(noteId) => {
                        setSelectedNoteId(noteId);
                        setIndexFilter('all');
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-black/40 text-[14px]">
                      {heatmapData === undefined ? 'Loading...' : 'Computing note positions...'}
                    </div>
                  )}
                </div>
              )}
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
                  value={editingTitle || ''}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  className="text-[20px] font-semibold text-black w-full bg-transparent outline-none mb-2"
                />
                <p className="text-[12px] text-black/40 mb-4">{selectedNoteData.date}</p>
                <div className="flex flex-wrap gap-2 mb-6">
                  {selectedNoteData.tags.map(tag => (
                    <span key={tag} className="text-[10px] text-black/60 border border-black/20 rounded px-2 py-0.5 uppercase flex items-center gap-1 group">
                      {tag}
                      <button 
                        onClick={() => handleRemoveTag(tag)}
                        className="text-black/30 hover:text-black/60 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                {isEditingBody ? (
                  <textarea
                    value={editingBody || ''}
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
                        alt={image.title || 'Untitled image'}
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
                    alt={mobileSelectedImage.title || 'Untitled image'}
                    className="w-full h-auto mb-4"
                  />
                  <p className={`text-[16px] font-medium ${mobileSelectedImage.title ? 'text-black' : 'text-black/40 italic'}`}>
                    {mobileSelectedImage.title || '[untitled]'}
                  </p>
                  <p className={`text-[14px] mt-1 ${mobileSelectedImage.description ? 'text-black/60' : 'text-black/30 italic'}`}>
                    {mobileSelectedImage.description || '[no text]'}
                  </p>
                  <p className="text-[12px] text-black/40 mt-2">{formatDate(mobileSelectedImage.uploadedAt)}</p>
                </div>
              </div>
            );
          })()}

          {/* Mobile Upload Modal */}
          {isUploadingImage && (
            <div className="absolute inset-0 z-20 flex flex-col bg-[#fffffc]/95 px-4 pt-4">
              <div className="flex justify-between items-center mb-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span className="text-[14px] text-black">
                    {selectedFiles.length > 0 ? `${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''}` : 'choose files'}
                  </span>
                  <input 
                    type="file" 
                    accept="image/*" 
                    multiple
                    onChange={(e) => handleFilesSelected(e.target.files)} 
                    className="hidden" 
                  />
                </label>
                <button 
                  onClick={() => { 
                    setIsUploadingImage(false); 
                    setSelectedFiles([]); 
                    setFileMetadata([]);
                    setCurrentFileIndex(0);
                  }} 
                  className="text-[12px] text-black/30"
                >
                  ✕
                </button>
              </div>
              
              {/* Preview and navigation */}
              {selectedFiles.length > 0 && (
                <div className="flex-1 overflow-y-auto">
                  <div className="relative mb-4">
                    <img 
                      src={URL.createObjectURL(selectedFiles[currentFileIndex])} 
                      alt="Preview"
                      className="w-full h-auto max-h-[40vh] object-contain bg-black/5 rounded"
                    />
                    {selectedFiles.length > 1 && (
                      <>
                        <button
                          onClick={goToPrevFile}
                          disabled={currentFileIndex === 0}
                          className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/80 flex items-center justify-center disabled:opacity-30"
                        >
                          ←
                        </button>
                        <button
                          onClick={goToNextFile}
                          disabled={currentFileIndex === selectedFiles.length - 1}
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/80 flex items-center justify-center disabled:opacity-30"
                        >
                          →
                        </button>
                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 text-white text-[11px] px-2 py-1 rounded">
                          {currentFileIndex + 1} / {selectedFiles.length}
                        </div>
                      </>
                    )}
                  </div>
                  
                  <p className="text-[11px] text-black/40 mb-3 truncate">{selectedFiles[currentFileIndex].name}</p>
                  
                  <input 
                    type="text" 
                    placeholder="title (optional)" 
                    value={fileMetadata[currentFileIndex]?.title || ''} 
                    onChange={(e) => updateCurrentFileMetadata('title', e.target.value)} 
                    className="w-full text-[14px] border-b border-black/10 pb-2 mb-4 outline-none bg-transparent placeholder:text-black/30" 
                  />
                  
                  <input 
                    type="text" 
                    placeholder="description (optional)" 
                    value={fileMetadata[currentFileIndex]?.description || ''} 
                    onChange={(e) => updateCurrentFileMetadata('description', e.target.value)} 
                    className="w-full text-[14px] border-b border-black/10 pb-2 mb-4 outline-none bg-transparent placeholder:text-black/30" 
                  />
                </div>
              )}
              
              <div className="mt-auto pb-6">
                <select 
                  value={uploadCategory} 
                  onChange={(e) => setUploadCategory(e.target.value)} 
                  className="w-full text-[14px] border-b border-black/10 pb-2 mb-4 outline-none bg-transparent"
                >
                  {archiveCategories.filter(c => c !== 'all').map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
                
                <button 
                  onClick={handleImageUpload} 
                  disabled={selectedFiles.length === 0 || uploadStatus === 'uploading'} 
                  className="text-[12px] text-black/50 hover:text-black disabled:opacity-30"
                >
                  {uploadStatus === 'uploading' 
                    ? `uploading ${uploadProgress.current}/${uploadProgress.total}...` 
                    : `upload ${selectedFiles.length > 1 ? 'all' : ''} →`}
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
            ref={dividerLineRef}
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

      {/* Right section - Home dashboard - Desktop only */}
      {!isMobile && stage === 'second' && activeView === 'home' && (
        <div 
          className="absolute top-0 right-0"
          style={{ 
            left: '32%',
            height: dividerTop > 0 ? `${dividerTop}px` : '50%',
            opacity: showAbout ? 1 : 0,
            transition: 'opacity 0.5s ease-in',
          }}
        >
          {/* Bottom black line — continuation of the horizontal divider under the character */}
          <div className="absolute bottom-0 left-0 right-0 h-px bg-black" />

          {/* Two sections side by side filling the full height */}
          <div className="flex h-full">
            {/* LEFT: Today summary + tasks */}
            <div className="flex-1 flex flex-col p-8 min-h-0">
              {/* Section label */}
              <p className="text-[11px] text-black/40 uppercase tracking-wider mb-5">today</p>
              
              {/* AI Summary */}
              <p className="text-[14px] text-black/70 leading-[1.6] mb-8">
                {todaySummary?.summary || "Start adding notes and tasks to get your daily summary."}
              </p>
              
              {/* Tasks label */}
              <p className="text-[11px] text-black/40 uppercase tracking-wider mb-3">tasks</p>
              
              {/* Tasks table */}
              <div className="flex-1 overflow-y-auto min-h-0">
                {(todayTasks ?? []).length === 0 ? (
                  <p className="text-[13px] text-black/30">No tasks for today yet.</p>
                ) : (
                  <div>
                    {(todayTasks ?? []).map((task, idx) => (
                      <div 
                        key={task._id}
                        className="flex items-center gap-3 py-3 border-b border-black/5 group cursor-pointer hover:bg-black/[0.02] transition-colors -mx-2 px-2"
                        onClick={() => toggleTask(task._id, task.status === 'completed')}
                      >
                        {/* Number */}
                        <span className="text-[12px] text-black/25 w-5 text-right tabular-nums flex-shrink-0 font-medium">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        
                        {/* Status dot */}
                        <div 
                          className="w-[7px] h-[7px] flex-shrink-0 transition-colors"
                          style={{ 
                            backgroundColor: task.status === 'completed' ? '#4ade80' : '#1a1a1a',
                          }}
                        />
                        
                        {/* Task text */}
                        <span className={`text-[13px] flex-1 tracking-[-0.01em] ${task.status === 'completed' ? 'text-black/35 line-through' : 'text-black'}`}>
                          {task.text}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            
            {/* RIGHT: Date + Events — clean bordered card */}
            <div className="flex-shrink-0 w-[33%] flex items-stretch p-4 pl-0">
              <div className="flex-1 border border-black flex flex-col p-6 overflow-hidden">
                {/* Time + Location */}
                <div className="flex items-center gap-2 text-[12px] text-black/40 mb-5">
                  <span className="tabular-nums">{currentTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="text-black/20">|</span>
                  <span>London, England</span>
                </div>
                
                {/* Large date */}
                <div className="mb-8">
                  <p className="text-[42px] text-black leading-[0.95] font-medium tracking-[-2px]">
                    {(() => {
                      const day = currentTime.getDate();
                      const suffix = day === 1 || day === 21 || day === 31 ? 'st' 
                        : day === 2 || day === 22 ? 'nd' 
                        : day === 3 || day === 23 ? 'rd' : 'th';
                      return `${day}${suffix}`;
                    })()}
                  </p>
                  <p className="text-[42px] text-black leading-[0.95] font-medium tracking-[-2px]">
                    {currentTime.toLocaleDateString('en-GB', { month: 'long' })}
                  </p>
                </div>

                {/* Divider */}
                <div className="h-px bg-black/10 mb-5" />
                
                {/* Events label */}
                <p className="text-[11px] text-black/40 uppercase tracking-wider mb-4">events</p>
                
                {/* Events list - placeholder */}
                <div className="space-y-3 flex-1 overflow-y-auto">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-[5px] h-[5px] bg-black/15 flex-shrink-0" />
                      <p className="text-[13px] text-black/25">Event name - time</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Right section - Chat interface below dashboard - Desktop only */}
      {!isMobile && stage === 'second' && activeView === 'home' && (
        <div
          className="absolute bottom-0 right-0 flex flex-col"
          style={{
            left: '32%',
            top: dividerTop > 0 ? `${dividerTop + 1}px` : '50%',
            opacity: showAbout ? 1 : 0,
            transition: 'opacity 0.5s ease-in',
          }}
        >
          {/* Messages area */}
          <div className="flex-1 overflow-y-auto px-8 py-6 min-h-0">
            {chatMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <p className="text-[13px] text-black/25 mb-1">ask me anything about your notes, tasks, or ideas.</p>
                <p className="text-[11px] text-black/15">i have access to your entire knowledge base.</p>
              </div>
            ) : (
              <div className="space-y-5">
                {chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] ${
                        msg.role === 'user'
                          ? 'bg-black/[0.04] px-4 py-2.5 rounded-lg'
                          : ''
                      }`}
                    >
                      <p
                        className={`text-[13px] leading-[1.7] whitespace-pre-wrap ${
                          msg.role === 'user' ? 'text-black' : 'text-black/80'
                        }`}
                      >
                        {msg.text}
                      </p>
                    </div>
                  </div>
                ))}

                {/* Thinking indicator */}
                {chatStatus === 'submitted' && 
                  chatMessages[chatMessages.length - 1]?.role === 'user' && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-1.5 py-2">
                      <span className="chat-dot w-[5px] h-[5px] bg-black/30 rounded-full" style={{ animationDelay: '0ms' }} />
                      <span className="chat-dot w-[5px] h-[5px] bg-black/30 rounded-full" style={{ animationDelay: '150ms' }} />
                      <span className="chat-dot w-[5px] h-[5px] bg-black/30 rounded-full" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>
            )}
          </div>

          {/* Input bar */}
          <form onSubmit={handleChatSubmit} className="flex-shrink-0 border-t border-black/10 px-8 py-4 flex items-center gap-3">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="message..."
              disabled={chatStatus !== 'ready' && chatStatus !== 'error'}
              className="flex-1 text-[13px] text-black bg-transparent outline-none placeholder:text-black/25 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!chatInput.trim() || (chatStatus !== 'ready' && chatStatus !== 'error')}
              className="text-black/30 hover:text-black transition-colors disabled:opacity-20 disabled:hover:text-black/30 flex-shrink-0"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </form>
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
                {/* Semantic/Keyword toggle */}
                <button
                  onClick={() => setIsSemanticSearch(!isSemanticSearch)}
                  className={`text-[10px] px-2 py-1 rounded border transition-colors flex-shrink-0 mb-1 ${
                    isSemanticSearch 
                      ? 'bg-black text-white border-black' 
                      : 'bg-transparent text-black/60 border-black/20 hover:border-black/40'
                  }`}
                  title={isSemanticSearch ? 'Semantic search (by meaning)' : 'Keyword search (exact match)'}
                >
                  {isSemanticSearch ? 'AI' : 'KW'}
                </button>
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
                {indexFilter === 'graph' ? 'Knowledge Graph' : formatTodayDate()}
          </h1>
            )}
            
            {/* Filters */}
            <div className="flex gap-3">
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
              <button
                onClick={() => setIndexFilter('graph')}
                className={`text-[14px] font-medium transition-opacity ${indexFilter === 'graph' ? 'text-black' : 'text-black/40 hover:text-black/60'}`}
              >
                Graph
              </button>
            </div>
          </div>
          
          {/* All view - Index items list */}
          {indexFilter === 'all' && (
          <div className="flex-1 overflow-y-auto px-8 pt-6">
            {/* Loading indicator for semantic search */}
            {isSearching && (
              <div className="text-[12px] text-black/40 mb-4">searching...</div>
            )}
            
            {/* Use semantic results if available, otherwise fall back to filtered indexItems */}
            {isSemanticSearch && semanticResults && indexSearch.trim() ? (
              <>
                {semanticResults.map((result) => {
                  const item = indexItems.find(i => i._id === result._id);
                  if (!item) return null;
                  const relevancePercent = Math.round(result.score * 100);
                  return (
                    <div key={item._id}>
                      <div 
                        onClick={() => setSelectedNoteId(item._id)}
                        className="group flex items-center py-3 gap-4 cursor-pointer hover:bg-black/[0.02] transition-colors -mx-2 px-2 rounded"
                      >
                        <span className="text-[12px] text-black/40 w-8 flex-shrink-0 font-mono">{relevancePercent}%</span>
                        <div className="w-3 h-3 flex-shrink-0" style={{ backgroundColor: item.color }} />
                        <div className="flex-1 min-w-0">
                          <span className="text-[14px] font-medium text-black">{item.title}</span>
                          <span className="text-[14px] text-black/40"> — {item.timestamp}</span>
                        </div>
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
                        <button
                          onClick={(e) => handleDeleteNote(item._id, e)}
                          className="opacity-0 group-hover:opacity-100 text-[12px] text-black/30 hover:text-red-500 transition-all flex-shrink-0"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="h-px bg-black/10" />
                    </div>
                  );
                })}
              </>
            ) : (
              <>
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
                  .map((item) => (
                    <div key={item._id}>
                      <div 
                        onClick={() => setSelectedNoteId(item._id)}
                        className="group flex items-center py-3 gap-4 cursor-pointer hover:bg-black/[0.02] transition-colors -mx-2 px-2 rounded"
                      >
                        <span className="text-[14px] text-black/50 w-6 flex-shrink-0">{item.id}</span>
                        <div className="w-3 h-3 flex-shrink-0" style={{ backgroundColor: item.color }} />
                        <div className="flex-1 min-w-0">
                          <span className="text-[14px] font-medium text-black">{item.title}</span>
                          <span className="text-[14px] text-black/40"> — {item.timestamp}</span>
                        </div>
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
                        <button
                          onClick={(e) => handleDeleteNote(item._id, e)}
                          className="opacity-0 group-hover:opacity-100 text-[12px] text-black/30 hover:text-red-500 transition-all flex-shrink-0"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="h-px bg-black/10" />
                    </div>
                  ))}
              </>
            )}
            
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
            <div className="flex-1 flex flex-col px-8 pt-6 pb-6 min-h-0">
              {/* Tasks section - fixed at top */}
              <div className="flex-shrink-0 mb-6">
                <p className="text-[12px] font-medium text-black/50 uppercase tracking-wide mb-4">Tasks</p>
                
                {/* Task list */}
                <div className="space-y-2 mb-4">
                  {(todayTasks ?? []).map((task) => (
                    <div 
                      key={task._id} 
                      className="flex items-center gap-3 group"
                    >
                      <button
                        onClick={() => toggleTask(task._id, task.status === 'completed')}
                        className="text-[14px] text-black/50 hover:text-black transition-colors"
                      >
                        [{task.status === 'completed' ? '✓' : ' '}]
                      </button>
                      <span className={`text-[14px] ${task.status === 'completed' ? 'text-black/40 line-through' : 'text-black'}`}>
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
                
                {/* Backlog section - collapsible */}
                {backlogTasks && backlogTasks.length > 0 && (
                  <div className="mt-6">
                    <button
                      onClick={() => setShowBacklog(!showBacklog)}
                      className="text-[12px] text-black/40 hover:text-black/60 transition-colors flex items-center gap-1.5"
                    >
                      <span className="text-[10px]">{showBacklog ? '▼' : '▶'}</span>
                      <span className="uppercase tracking-wide">Backlog</span>
                      <span className="text-black/30">({backlogTasks.length})</span>
                    </button>
                    {showBacklog && (
                      <div className="mt-3 pl-3 border-l border-black/10 space-y-1.5">
                        {backlogTasks.map((task) => (
                          <div key={task._id} className="flex items-center gap-3 py-0.5 group">
                            <button
                              onClick={() => scheduleForTodayMutation({ taskId: task._id })}
                              className="text-[13px] text-black/30 hover:text-black transition-colors"
                              title="Add to today"
                            >
                              +
                            </button>
                            <span className="text-[13px] text-black/50 flex-1">{task.text}</span>
                            <button
                              onClick={() => dismissTaskMutation({ taskId: task._id })}
                              className="text-[12px] text-black/20 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                              title="Dismiss permanently"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              {/* Divider */}
              <div className="h-px bg-black/10 mb-6 flex-shrink-0" />
              
              {/* Notes section - fills remaining space */}
              <div className="flex-1 flex flex-col min-h-0">
                <p className="text-[12px] font-medium text-black/50 uppercase tracking-wide mb-4 flex-shrink-0">Notes</p>
                <textarea
                  value={localTodayNotes}
                  onChange={(e) => handleTodayNotesChange(e.target.value)}
                  placeholder="Capture your thoughts..."
                  className="flex-1 w-full text-[14px] text-black bg-transparent outline-none resize-none placeholder:text-black/30 leading-relaxed overflow-y-auto min-h-0"
                />
              </div>
              
              {/* Save to Index section - fixed at bottom */}
              <div className="pt-3 border-t border-black/10 flex items-center justify-between flex-shrink-0">
                <p className="text-[11px] text-black/30">
                  auto-saves at 11:45pm
                </p>
                <button
                  onClick={saveDailyToIndex}
                  disabled={!localTodayNotes.trim() && (!todayTasks || todayTasks.length === 0)}
                  className="text-[11px] text-black/50 hover:text-black transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {dailySaved ? '✓ saved' : 'save to index →'}
                </button>
              </div>
            </div>
          )}
          
          {/* Graph view - Knowledge graph heat map */}
          {indexFilter === 'graph' && (
            <div className="flex-1 overflow-hidden">
              {heatmapData && heatmapData.length > 0 ? (
                <KnowledgeHeatmap
                  notes={heatmapData}
                  onNoteClick={(noteId) => {
                    setSelectedNoteId(noteId);
                    setIndexFilter('all');
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-black/40 text-[14px]">
                  {heatmapData === undefined ? 'Loading...' : 'Computing note positions...'}
                </div>
              )}
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
                onClick={() => { setSelectedFolder(0); setFlippedCards({}); }}
                className={`text-[16px] font-medium tracking-tight transition-colors ${
                  selectedFolder === 0 ? 'text-black' : 'text-black/30 hover:text-black/50'
                }`}
              >
                holding
              </button>
              <button
                onClick={() => { setSelectedFolder(1); setFlippedCards({}); }}
                className={`text-[16px] font-medium tracking-tight transition-colors ${
                  selectedFolder === 1 ? 'text-black' : 'text-black/30 hover:text-black/50'
                }`}
              >
                intelligence
              </button>
              <button
                onClick={() => { setSelectedFolder(2); setFlippedCards({}); }}
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
                className="absolute inset-0 venture-card-container transition-all duration-500 ease-out"
                style={{
                  transform: selectedFolder === 0 
                    ? 'translateX(0)' 
                    : selectedFolder > 0 
                      ? 'translateX(-110%)' 
                      : 'translateX(110%)',
                  opacity: selectedFolder === 0 ? 1 : 0,
                  zIndex: selectedFolder === 0 ? 10 : 0,
                }}
              >
                <div 
                  className={`venture-card cursor-pointer ${flippedCards[0] ? 'flipped' : ''}`}
                  onClick={() => toggleCardFlip(0)}
                >
                  {/* Front Face */}
                  <div 
                    className="venture-card-face"
                    style={{
                      background: 'rgba(30, 30, 30, 0.4)',
                      backdropFilter: 'blur(20px)',
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
                    {/* Company name - Xanh Mono */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span 
                        className="text-[140px] text-white/80"
                        style={{ letterSpacing: '-10px', fontFamily: 'var(--font-xanh-mono)' }}
                      >
                        Exa Labs
                      </span>
                    </div>
                  </div>
                  
                  {/* Back Face - Goals & Outcomes */}
                  <div className="venture-card-face venture-card-back p-10 flex flex-col bg-[#fafaf8]">
                    {/* Header */}
                    <div className="flex items-baseline justify-between mb-8">
                      <h2 
                        className="text-[56px] text-[#1a1a1a] leading-[0.9] tracking-[-0.03em]"
                        style={{ fontFamily: 'var(--font-xanh-mono)' }}
                      >
                        Exa Labs
                      </h2>
                      <span className="text-[12px] uppercase tracking-[0.2em] text-black/30">Q1 2026</span>
                    </div>
                    
                    {/* Weekly Focus */}
                    <div className="mb-8">
                      <h3 className="text-[11px] uppercase tracking-[0.2em] text-black/40 mb-4">This Week</h3>
                      <div className="space-y-4">
                        <div className="border-l-2 border-black pl-4">
                          <p className="text-[20px] text-black leading-tight mb-1">Ship the prototype</p>
                          <p className="text-[13px] text-black/50">Get v2 in users' hands for feedback</p>
                        </div>
                        <div className="border-l-2 border-black/20 pl-4">
                          <p className="text-[20px] text-black/80 leading-tight mb-1">5 user interviews</p>
                          <p className="text-[13px] text-black/40">Deep dive on onboarding friction</p>
                        </div>
                      </div>
                    </div>
                    
                    {/* Wins */}
                    <div className="mb-8">
                      <h3 className="text-[11px] uppercase tracking-[0.2em] text-black/40 mb-4">Recent Wins</h3>
                      <div className="flex gap-3 flex-wrap">
                        <span className="px-3 py-1.5 bg-black text-white text-[13px] rounded-full">API v1 shipped ✓</span>
                        <span className="px-3 py-1.5 bg-black text-white text-[13px] rounded-full">First customer ✓</span>
                      </div>
                    </div>
                    
                    {/* Quarter Goals */}
                    <div className="flex-1 border-t border-black/10 pt-6">
                      <h3 className="text-[11px] uppercase tracking-[0.2em] text-black/40 mb-4">Quarter Goals</h3>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="text-center">
                          <p className="text-[32px] font-light text-black leading-none mb-1">100</p>
                          <p className="text-[12px] text-black/50">active users</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[32px] font-light text-black leading-none mb-1">$500K</p>
                          <p className="text-[12px] text-black/50">seed round</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[32px] font-light text-black leading-none mb-1">Beta</p>
                          <p className="text-[12px] text-black/50">public launch</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Card 1 - Intelligence */}
              <div 
                className="absolute inset-0 venture-card-container transition-all duration-500 ease-out"
                style={{
                  transform: selectedFolder === 1 
                    ? 'translateX(0)' 
                    : selectedFolder > 1 
                      ? 'translateX(-110%)' 
                      : 'translateX(110%)',
                  opacity: selectedFolder === 1 ? 1 : 0,
                  zIndex: selectedFolder === 1 ? 10 : 0,
                }}
              >
                <div 
                  className={`venture-card cursor-pointer ${flippedCards[1] ? 'flipped' : ''}`}
                  onClick={() => toggleCardFlip(1)}
                >
                  {/* Front Face */}
                  <div 
                    className="venture-card-face"
                    style={{
                      background: 'rgba(255, 255, 252, 0.2)',
                      backdropFilter: 'blur(20px)',
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
                      {/* Company name - Inter */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span 
                          className="text-[100px] font-light text-white/90 text-center"
                          style={{ letterSpacing: '-6px', fontFamily: 'var(--font-inter)' }}
                        >
                          Exa Intelligence
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Back Face - Goals & Outcomes */}
                  <div className="venture-card-face venture-card-back p-10 flex flex-col bg-[#fafaf8]">
                    {/* Header */}
                    <div className="flex items-baseline justify-between mb-8">
                      <h2 
                        className="text-[48px] text-[#1a1a1a] leading-[0.9] font-light tracking-[-0.02em]"
                        style={{ fontFamily: 'var(--font-inter)' }}
                      >
                        Exa Intelligence
                      </h2>
                      <span className="text-[12px] uppercase tracking-[0.2em] text-black/30">Q1 2026</span>
                    </div>
                    
                    {/* Weekly Focus */}
                    <div className="mb-8">
                      <h3 className="text-[11px] uppercase tracking-[0.2em] text-black/40 mb-4">This Week</h3>
                      <div className="space-y-4">
                        <div className="border-l-2 border-black pl-4">
                          <p className="text-[20px] text-black leading-tight mb-1">Train model v3</p>
                          <p className="text-[13px] text-black/50">Push accuracy past 95% threshold</p>
                        </div>
                        <div className="border-l-2 border-black/20 pl-4">
                          <p className="text-[20px] text-black/80 leading-tight mb-1">Optimize inference</p>
                          <p className="text-[13px] text-black/40">Sub-100ms latency target</p>
                        </div>
                      </div>
                    </div>
                    
                    {/* Wins */}
                    <div className="mb-8">
                      <h3 className="text-[11px] uppercase tracking-[0.2em] text-black/40 mb-4">Recent Wins</h3>
                      <div className="flex gap-3 flex-wrap">
                        <span className="px-3 py-1.5 bg-black text-white text-[13px] rounded-full">95% accuracy ✓</span>
                        <span className="px-3 py-1.5 bg-black text-white text-[13px] rounded-full">&lt;100ms latency ✓</span>
                      </div>
                    </div>
                    
                    {/* Quarter Goals */}
                    <div className="flex-1 border-t border-black/10 pt-6">
                      <h3 className="text-[11px] uppercase tracking-[0.2em] text-black/40 mb-4">Quarter Goals</h3>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="text-center">
                          <p className="text-[32px] font-light text-black leading-none mb-1">Prod</p>
                          <p className="text-[12px] text-black/50">deployment</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[32px] font-light text-black leading-none mb-1">10M</p>
                          <p className="text-[12px] text-black/50">tokens/day</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[32px] font-light text-black leading-none mb-1">Multi</p>
                          <p className="text-[12px] text-black/50">modal</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Card 2 - Application */}
              <div 
                className="absolute inset-0 venture-card-container transition-all duration-500 ease-out"
                style={{
                  transform: selectedFolder === 2 
                    ? 'translateX(0)' 
                    : selectedFolder > 2 
                      ? 'translateX(-110%)' 
                      : 'translateX(110%)',
                  opacity: selectedFolder === 2 ? 1 : 0,
                  zIndex: selectedFolder === 2 ? 10 : 0,
                }}
              >
                <div 
                  className={`venture-card cursor-pointer ${flippedCards[2] ? 'flipped' : ''}`}
                  onClick={() => toggleCardFlip(2)}
                >
                  {/* Front Face */}
                  <div 
                    className="venture-card-face"
                    style={{
                      background: 'rgba(255, 255, 252, 0.2)',
                      backdropFilter: 'blur(20px)',
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
                      {/* Company name - Source Serif Pro */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span 
                          className="text-[140px] text-white/90"
                          style={{ letterSpacing: '-8px', fontFamily: 'var(--font-source-serif)' }}
                        >
                          Evos
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Back Face - Goals & Outcomes */}
                  <div className="venture-card-face venture-card-back p-10 flex flex-col bg-[#fafaf8]">
                    {/* Header */}
                    <div className="flex items-baseline justify-between mb-8">
                      <h2 
                        className="text-[56px] text-[#1a1a1a] leading-[0.9] tracking-[-0.03em]"
                        style={{ fontFamily: 'var(--font-source-serif)' }}
                      >
                        Evos
                      </h2>
                      <span className="text-[12px] uppercase tracking-[0.2em] text-black/30">Q1 2026</span>
                    </div>
                    
                    {/* Weekly Focus */}
                    <div className="mb-8">
                      <h3 className="text-[11px] uppercase tracking-[0.2em] text-black/40 mb-4">This Week</h3>
                      <div className="space-y-4">
                        <div className="border-l-2 border-black pl-4">
                          <p className="text-[20px] text-black leading-tight mb-1">Close 3 enterprise deals</p>
                          <p className="text-[13px] text-black/50">Pipeline is hot — execute</p>
                        </div>
                        <div className="border-l-2 border-black/20 pl-4">
                          <p className="text-[20px] text-black/80 leading-tight mb-1">Hire senior engineer</p>
                          <p className="text-[13px] text-black/40">Final interviews this week</p>
                        </div>
                      </div>
                    </div>
                    
                    {/* Wins */}
                    <div className="mb-8">
                      <h3 className="text-[11px] uppercase tracking-[0.2em] text-black/40 mb-4">Recent Wins</h3>
                      <div className="flex gap-3 flex-wrap">
                        <span className="px-3 py-1.5 bg-black text-white text-[13px] rounded-full">$240K MRR ✓</span>
                        <span className="px-3 py-1.5 bg-black text-white text-[13px] rounded-full">Series A term sheet ✓</span>
                      </div>
                    </div>
                    
                    {/* Quarter Goals */}
                    <div className="flex-1 border-t border-black/10 pt-6">
                      <h3 className="text-[11px] uppercase tracking-[0.2em] text-black/40 mb-4">Quarter Goals</h3>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="text-center">
                          <p className="text-[32px] font-light text-black leading-none mb-1">$500K</p>
                          <p className="text-[12px] text-black/50">ARR</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[32px] font-light text-black leading-none mb-1">3</p>
                          <p className="text-[12px] text-black/50">markets</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[32px] font-light text-black leading-none mb-1">10</p>
                          <p className="text-[12px] text-black/50">team size</p>
                        </div>
                      </div>
                    </div>
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
              <div className="w-full max-w-md px-8">
                {/* Header */}
                <div className="flex justify-between items-center mb-4">
                  <label className="flex items-center gap-2 cursor-pointer hover:opacity-70 transition-opacity">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-black">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <span className="text-[14px] text-black">
                      {selectedFiles.length > 0 ? `${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''} selected` : 'choose files'}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => handleFilesSelected(e.target.files)}
                      className="hidden"
                    />
                  </label>
                  <button
                    onClick={() => {
                      setIsUploadingImage(false);
                      setSelectedFiles([]);
                      setFileMetadata([]);
                      setCurrentFileIndex(0);
                      setUploadCategory('design');
                    }}
                    className="text-[12px] text-black/30 hover:text-black"
                  >
                    ✕
                  </button>
                </div>
                
                {/* Image preview and navigation */}
                {selectedFiles.length > 0 && (
                  <>
                    <div className="relative mb-4">
                      {/* Preview */}
                      <div className="aspect-video bg-black/5 rounded flex items-center justify-center overflow-hidden">
                        <img 
                          src={URL.createObjectURL(selectedFiles[currentFileIndex])} 
                          alt="Preview"
                          className="max-w-full max-h-full object-contain"
                        />
                      </div>
                      
                      {/* Navigation arrows */}
                      {selectedFiles.length > 1 && (
                        <>
                          <button
                            onClick={goToPrevFile}
                            disabled={currentFileIndex === 0}
                            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/80 flex items-center justify-center text-black/60 hover:text-black disabled:opacity-30 transition-colors"
                          >
                            ←
                          </button>
                          <button
                            onClick={goToNextFile}
                            disabled={currentFileIndex === selectedFiles.length - 1}
                            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/80 flex items-center justify-center text-black/60 hover:text-black disabled:opacity-30 transition-colors"
                          >
                            →
                          </button>
                        </>
                      )}
                      
                      {/* File counter */}
                      {selectedFiles.length > 1 && (
                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 text-white text-[11px] px-2 py-1 rounded">
                          {currentFileIndex + 1} / {selectedFiles.length}
                        </div>
                      )}
                    </div>
                    
                    {/* File name */}
                    <p className="text-[11px] text-black/40 mb-3 truncate">{selectedFiles[currentFileIndex].name}</p>
                    
                    {/* Title (optional) */}
                    <input
                      type="text"
                      placeholder="title (optional)"
                      value={fileMetadata[currentFileIndex]?.title || ''}
                      onChange={(e) => updateCurrentFileMetadata('title', e.target.value)}
                      className="w-full text-[14px] text-black bg-transparent border-b border-black/10 pb-2 mb-4 outline-none focus:border-black/30 placeholder:text-black/30"
                    />
                    
                    {/* Description (optional) */}
                    <input
                      type="text"
                      placeholder="description (optional)"
                      value={fileMetadata[currentFileIndex]?.description || ''}
                      onChange={(e) => updateCurrentFileMetadata('description', e.target.value)}
                      className="w-full text-[14px] text-black bg-transparent border-b border-black/10 pb-2 mb-4 outline-none focus:border-black/30 placeholder:text-black/30"
                    />
                  </>
                )}
                
                {/* Category (applies to all) */}
                <select
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value)}
                  className="w-full text-[14px] text-black bg-transparent border-b border-black/10 pb-2 mb-6 outline-none"
                >
                  {archiveCategories.filter(c => c !== 'all').map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                
                {/* Upload button and status */}
                <div className="flex items-center gap-4">
                  <button
                    onClick={handleImageUpload}
                    disabled={selectedFiles.length === 0 || uploadStatus === 'uploading'}
                    className="text-[12px] text-black/50 hover:text-black transition-colors disabled:opacity-30"
                  >
                    {uploadStatus === 'uploading' 
                      ? `uploading ${uploadProgress.current}/${uploadProgress.total}...` 
                      : `upload ${selectedFiles.length > 1 ? 'all' : ''} →`}
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
                      alt={image.title || 'Untitled image'}
                      className="max-w-full max-h-[70vh] object-contain"
                    />
                  )}
                </div>
                
                {/* Title and description - right aligned */}
                <div className="w-full max-w-[70%] mt-3 text-right">
                  <h2 className={`text-[14px] ${image.title ? 'text-black' : 'text-black/40 italic'}`}>
                    {image.title || '[untitled]'}
                  </h2>
                  <p className={`text-[12px] mt-0.5 ${image.description ? 'text-black/50' : 'text-black/30 italic'}`}>
                    {image.description || '[no text]'}
                  </p>
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
                          alt={image.title || 'Untitled image'}
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
              value={editingTitle || ''}
              onChange={(e) => handleTitleChange(e.target.value)}
              className="text-[18px] font-semibold text-black uppercase tracking-wide mb-2 w-full bg-transparent outline-none"
            />
            
            {/* Tags row - in containers like table */}
            <div className="flex gap-2 mb-8">
              {selectedNoteData.tags.map(tag => (
                <span 
                  key={tag} 
                  className="text-[10px] text-black/60 border border-black/20 rounded px-2 py-0.5 uppercase flex items-center gap-1.5 group"
                >
                  <button
                    onClick={() => {
                      const tagWithHash = `#${tag}`;
                      if (!selectedTags.includes(tagWithHash)) {
                        setSelectedTags(prev => [...prev, tagWithHash]);
                      }
                      setSelectedNoteId(null);
                    }}
                    className="hover:text-black transition-colors"
                  >
                    {tag}
                  </button>
                  <button 
                    onClick={() => handleRemoveTag(tag)}
                    className="text-black/30 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    ×
                  </button>
                </span>
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
            
            {/* Backlinks - notes that link TO this note */}
            <div className="min-w-[200px]">
              <p className="text-[12px] font-medium text-black mb-2">
                backlinks
                {backlinksData && backlinksData.length > 0 && (
                  <span className="ml-1 text-[10px] text-black/40">({backlinksData.length})</span>
                )}
              </p>
              {backlinksData && backlinksData.length > 0 ? (
                <div className="space-y-1">
                  {backlinksData.map((backlink) => (
                    <button
                      key={backlink._id}
                      onClick={() => setSelectedNoteId(backlink._id)}
                      className="text-[11px] text-black/70 hover:text-black transition-colors block text-left"
                    >
                      ← {backlink.title}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-black/30">no notes link here</p>
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
