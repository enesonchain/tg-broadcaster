'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// ==================== TYPES ====================
interface BotInfo {
  id: number;
  first_name: string;
  username: string;
  can_join_groups: boolean;
  can_read_all_group_messages: boolean;
}

interface Chat {
  id: number;
  title: string;
  type: 'group' | 'supergroup' | 'channel' | 'private';
  username?: string;
  memberCount?: number;
  botKicked?: boolean;
}

interface LogEntry {
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
  timestamp: string;
}

interface DiscoveredChat {
  id: number;
  title: string;
  type: 'group' | 'supergroup' | 'channel' | 'private';
  username?: string;
  source: 'message' | 'register_command' | 'bot_added';
}

interface ChatList {
  id: string;
  name: string;
  color: string;
  icon: string;
  chatIds: number[];
  parentId: string | null; // For nested lists
  stats: {
    sent: number;
    failed: number;
    lastBroadcast: string | null;
  };
}

interface MessageTemplate {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  lastUsed: string | null;
}

const LIST_COLORS = [
  '#2AABEE', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1'
];

const LIST_ICONS = ['📁', '🎮', '💰', '🎯', '🔥', '⭐', '💎', '🚀', '📢', '👥'];

type Step = 'setup' | 'connected';
type Tab = 'chats' | 'compose' | 'settings' | 'logs';

// ==================== CONSTANTS ====================
const TELEGRAM_API = 'https://api.telegram.org/bot';

const SAFETY_CONFIG = {
  DELAY_BETWEEN_MESSAGES: 50,     // 50ms (can do 30/sec safely)
  DELAY_FOR_GROUPS: 100,          // 100ms for groups
  MAX_PER_BROADCAST: 500,         // High limit since bots are safe
  BATCH_SIZE: 30,                 // Send in batches
  BATCH_DELAY: 1000,              // 1 second between batches
};

// ==================== MAIN COMPONENT ====================
export default function TelegramBotBroadcaster() {
  // State
  const [step, setStep] = useState<Step>('setup');
  const [activeTab, setActiveTab] = useState<Tab>('chats');
  const [botToken, setBotToken] = useState('');
  const [botInfo, setBotInfo] = useState<BotInfo | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChats, setSelectedChats] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [sendingProgress, setSendingProgress] = useState<{ sent: number; total: number; failed: number } | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [newChatId, setNewChatId] = useState('');
  
  // Settings state
  const [parseMode, setParseMode] = useState<'HTML' | 'Markdown' | 'none'>('HTML');
  const [disableNotification, setDisableNotification] = useState(false);
  const [protectContent, setProtectContent] = useState(false);

  // Discovery state
  const [discoveredChats, setDiscoveredChats] = useState<DiscoveredChat[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [lastUpdateId, setLastUpdateId] = useState<number | null>(null);
  const [rememberToken, setRememberToken] = useState(false);

  // Lists state
  const [lists, setLists] = useState<ChatList[]>([]);
  const [selectedLists, setSelectedLists] = useState<Set<string>>(new Set());
  const [excludedLists, setExcludedLists] = useState<Set<string>>(new Set());
  const [showListManager, setShowListManager] = useState(false);
  const [editingList, setEditingList] = useState<ChatList | null>(null);
  const [listSearchQuery, setListSearchQuery] = useState('');
  const [expandedLists, setExpandedLists] = useState<Set<string>>(new Set());

  // Templates state
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const hasAutoRefreshed = useRef(false);

  // ==================== VALIDATION HELPERS ====================
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isValidChat = (c: any): c is Chat => {
    return (
      typeof c === 'object' &&
      c !== null &&
      typeof c.id === 'number' &&
      typeof c.title === 'string' &&
      ['group', 'supergroup', 'channel', 'private'].includes(c.type)
    );
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isValidList = (l: any): l is ChatList => {
    return (
      typeof l === 'object' &&
      l !== null &&
      typeof l.id === 'string' &&
      typeof l.name === 'string' &&
      typeof l.color === 'string' &&
      typeof l.icon === 'string' &&
      Array.isArray(l.chatIds) &&
      typeof l.stats === 'object'
    );
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isValidTemplate = (t: any): t is MessageTemplate => {
    return (
      typeof t === 'object' &&
      t !== null &&
      typeof t.id === 'string' &&
      typeof t.name === 'string' &&
      typeof t.content === 'string' &&
      typeof t.createdAt === 'string'
    );
  };

  // ==================== HELPERS ====================
  const addLog = useCallback((msg: string, type: LogEntry['type'] = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-200), { message: msg, type, timestamp }]);
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Load saved data
  useEffect(() => {
    // Check if user opted to remember token (localStorage) or session only (sessionStorage)
    const remembered = localStorage.getItem('tg_remember_token') === 'true';
    setRememberToken(remembered);

    const savedToken = remembered
      ? localStorage.getItem('tg_bot_token')
      : sessionStorage.getItem('tg_bot_token');

    // Chats follow the same storage as token for consistency
    const savedChats = remembered
      ? localStorage.getItem('tg_bot_chats')
      : sessionStorage.getItem('tg_bot_chats');

    // Lists follow the same storage as token
    const savedLists = remembered
      ? localStorage.getItem('tg_bot_lists')
      : sessionStorage.getItem('tg_bot_lists');

    // Templates follow the same storage as token
    const savedTemplates = remembered
      ? localStorage.getItem('tg_bot_templates')
      : sessionStorage.getItem('tg_bot_templates');

    if (savedToken) {
      setBotToken(savedToken);
    }
    if (savedChats) {
      try {
        const parsed = JSON.parse(savedChats);
        // Validate the parsed data is an array of valid chat objects
        if (Array.isArray(parsed) && parsed.every(isValidChat)) {
          setChats(parsed);
        }
      } catch {}
    }
    if (savedLists) {
      try {
        const parsed = JSON.parse(savedLists);
        if (Array.isArray(parsed) && parsed.every(isValidList)) {
          setLists(parsed);
        }
      } catch {}
    }
    if (savedTemplates) {
      try {
        const parsed = JSON.parse(savedTemplates);
        if (Array.isArray(parsed) && parsed.every(isValidTemplate)) {
          setTemplates(parsed);
        }
      } catch {}
    }
  }, []);

  // Save chats whenever they change (follows token storage setting)
  useEffect(() => {
    if (chats.length > 0) {
      const chatData = JSON.stringify(chats);
      if (rememberToken) {
        localStorage.setItem('tg_bot_chats', chatData);
        sessionStorage.removeItem('tg_bot_chats');
      } else {
        sessionStorage.setItem('tg_bot_chats', chatData);
        localStorage.removeItem('tg_bot_chats');
      }
    } else {
      // Clear both when no chats
      localStorage.removeItem('tg_bot_chats');
      sessionStorage.removeItem('tg_bot_chats');
    }
  }, [chats, rememberToken]);

  // Save lists whenever they change (follows token storage setting)
  useEffect(() => {
    if (lists.length > 0) {
      const listData = JSON.stringify(lists);
      if (rememberToken) {
        localStorage.setItem('tg_bot_lists', listData);
        sessionStorage.removeItem('tg_bot_lists');
      } else {
        sessionStorage.setItem('tg_bot_lists', listData);
        localStorage.removeItem('tg_bot_lists');
      }
    } else {
      localStorage.removeItem('tg_bot_lists');
      sessionStorage.removeItem('tg_bot_lists');
    }
  }, [lists, rememberToken]);

  // Save templates whenever they change (follows token storage setting)
  useEffect(() => {
    if (templates.length > 0) {
      const templateData = JSON.stringify(templates);
      if (rememberToken) {
        localStorage.setItem('tg_bot_templates', templateData);
        sessionStorage.removeItem('tg_bot_templates');
      } else {
        sessionStorage.setItem('tg_bot_templates', templateData);
        localStorage.removeItem('tg_bot_templates');
      }
    } else {
      localStorage.removeItem('tg_bot_templates');
      sessionStorage.removeItem('tg_bot_templates');
    }
  }, [templates, rememberToken]);

  // ==================== API CALLS ====================
  const callBotApi = async (method: string, params: Record<string, any> = {}) => {
    const url = `${TELEGRAM_API}${botToken}/${method}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    
    const data = await response.json();
    
    if (!data.ok) {
      throw new Error(data.description || 'API call failed');
    }
    
    return data.result;
  };

  // ==================== ACTIONS ====================
  const connectBot = async () => {
    if (!botToken.trim()) {
      setError('Please enter your bot token');
      return;
    }

    // Validate bot token format (number:alphanumeric)
    const tokenRegex = /^\d+:[A-Za-z0-9_-]+$/;
    if (!tokenRegex.test(botToken.trim())) {
      setError('Invalid token format. Expected format: 123456789:ABCdefGHI...');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const me = await callBotApi('getMe');
      setBotInfo(me);

      // Save token based on user preference
      if (rememberToken) {
        localStorage.setItem('tg_bot_token', botToken);
        localStorage.setItem('tg_remember_token', 'true');
        sessionStorage.removeItem('tg_bot_token');
      } else {
        sessionStorage.setItem('tg_bot_token', botToken);
        localStorage.removeItem('tg_bot_token');
        localStorage.removeItem('tg_remember_token');
      }

      setStep('connected');
      addLog(`Connected as @${me.username}`, 'success');
    } catch (err: any) {
      setError(err.message || 'Failed to connect');
      addLog(`Connection failed: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const addChat = async () => {
    if (!newChatId.trim()) return;
    
    setIsLoading(true);
    setError('');
    
    try {
      // Try to get chat info
      const chat = await callBotApi('getChat', { chat_id: newChatId.trim() });
      
      // Check if already exists
      if (chats.some(c => c.id === chat.id)) {
        setError('Chat already added');
        return;
      }
      
      const newChat: Chat = {
        id: chat.id,
        title: chat.title || chat.first_name || chat.username || `Chat ${chat.id}`,
        type: chat.type,
        username: chat.username,
      };
      
      // Try to get member count for groups/channels
      try {
        const count = await callBotApi('getChatMemberCount', { chat_id: chat.id });
        newChat.memberCount = count;
      } catch {}
      
      setChats(prev => [...prev, newChat]);
      setNewChatId('');
      addLog(`Added: ${newChat.title}`, 'success');
    } catch (err: any) {
      setError(err.message || 'Failed to add chat. Make sure the bot is a member.');
      addLog(`Failed to add chat: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const removeChat = (chatId: number) => {
    setChats(prev => prev.filter(c => c.id !== chatId));
    setSelectedChats(prev => {
      const newSet = new Set(prev);
      newSet.delete(chatId);
      return newSet;
    });
    addLog(`Removed chat ${chatId}`, 'info');
  };

  const toggleChat = (chatId: number) => {
    setSelectedChats(prev => {
      const newSet = new Set(prev);
      if (newSet.has(chatId)) {
        newSet.delete(chatId);
      } else {
        newSet.add(chatId);
      }
      return newSet;
    });
  };

  const selectAll = () => {
    const filtered = getFilteredChats();
    const allSelected = filtered.every(c => selectedChats.has(c.id));
    
    if (allSelected) {
      setSelectedChats(new Set());
    } else {
      setSelectedChats(new Set(filtered.map(c => c.id)));
    }
  };

  const getFilteredChats = () => {
    return chats.filter(chat => {
      const matchesType = filterType === 'all' || chat.type === filterType ||
        (filterType === 'group' && (chat.type === 'group' || chat.type === 'supergroup'));
      const matchesSearch = chat.title.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesType && matchesSearch;
    });
  };

  // ==================== LIST MANAGEMENT ====================
  const createList = (name: string, color: string = LIST_COLORS[0], icon: string = LIST_ICONS[0], parentId: string | null = null) => {
    const newList: ChatList = {
      id: `list_${Date.now()}`,
      name,
      color,
      icon,
      chatIds: [],
      parentId,
      stats: { sent: 0, failed: 0, lastBroadcast: null },
    };
    setLists(prev => [...prev, newList]);
    addLog(`Created list: ${name}`, 'success');
    return newList;
  };

  const updateList = (listId: string, updates: Partial<ChatList>) => {
    setLists(prev => prev.map(list =>
      list.id === listId ? { ...list, ...updates } : list
    ));
  };

  const deleteList = (listId: string) => {
    // Also delete child lists
    const childIds = lists.filter(l => l.parentId === listId).map(l => l.id);
    setLists(prev => prev.filter(l => l.id !== listId && !childIds.includes(l.id)));
    setSelectedLists(prev => {
      const newSet = new Set(prev);
      newSet.delete(listId);
      childIds.forEach(id => newSet.delete(id));
      return newSet;
    });
    setExcludedLists(prev => {
      const newSet = new Set(prev);
      newSet.delete(listId);
      childIds.forEach(id => newSet.delete(id));
      return newSet;
    });
    addLog(`Deleted list`, 'info');
  };

  const addChatToList = (listId: string, chatId: number) => {
    setLists(prev => prev.map(list => {
      if (list.id === listId && !list.chatIds.includes(chatId)) {
        return { ...list, chatIds: [...list.chatIds, chatId] };
      }
      return list;
    }));
  };

  const removeChatFromList = (listId: string, chatId: number) => {
    setLists(prev => prev.map(list => {
      if (list.id === listId) {
        return { ...list, chatIds: list.chatIds.filter(id => id !== chatId) };
      }
      return list;
    }));
  };

  const moveListUp = (listId: string) => {
    setLists(prev => {
      const index = prev.findIndex(l => l.id === listId);
      if (index <= 0) return prev;
      const newLists = [...prev];
      [newLists[index - 1], newLists[index]] = [newLists[index], newLists[index - 1]];
      return newLists;
    });
  };

  const moveListDown = (listId: string) => {
    setLists(prev => {
      const index = prev.findIndex(l => l.id === listId);
      if (index === -1 || index >= prev.length - 1) return prev;
      const newLists = [...prev];
      [newLists[index], newLists[index + 1]] = [newLists[index + 1], newLists[index]];
      return newLists;
    });
  };

  const toggleListSelection = (listId: string) => {
    setSelectedLists(prev => {
      const newSet = new Set(prev);
      if (newSet.has(listId)) {
        newSet.delete(listId);
      } else {
        newSet.add(listId);
        // Remove from excluded if it was there
        setExcludedLists(exc => {
          const newExc = new Set(exc);
          newExc.delete(listId);
          return newExc;
        });
      }
      return newSet;
    });
  };

  const toggleListExclusion = (listId: string) => {
    setExcludedLists(prev => {
      const newSet = new Set(prev);
      if (newSet.has(listId)) {
        newSet.delete(listId);
      } else {
        newSet.add(listId);
        // Remove from selected if it was there
        setSelectedLists(sel => {
          const newSel = new Set(sel);
          newSel.delete(listId);
          return newSel;
        });
      }
      return newSet;
    });
  };

  const getChatsFromLists = (): number[] => {
    // Get all chat IDs from selected lists (including nested)
    const getAllChatIds = (listId: string): number[] => {
      const list = lists.find(l => l.id === listId);
      if (!list) return [];
      const childLists = lists.filter(l => l.parentId === listId);
      const childChatIds = childLists.flatMap(child => getAllChatIds(child.id));
      return [...list.chatIds, ...childChatIds];
    };

    const includedIds = new Set<number>();
    selectedLists.forEach(listId => {
      getAllChatIds(listId).forEach(id => includedIds.add(id));
    });

    // Remove excluded list chat IDs
    excludedLists.forEach(listId => {
      getAllChatIds(listId).forEach(id => includedIds.delete(id));
    });

    return Array.from(includedIds);
  };

  const selectChatsFromLists = () => {
    const chatIds = getChatsFromLists();
    setSelectedChats(new Set(chatIds));
    addLog(`Selected ${chatIds.length} chats from lists`, 'info');
  };

  const getListSuccessRate = (list: ChatList): number => {
    const total = list.stats.sent + list.stats.failed;
    if (total === 0) return 0;
    return Math.round((list.stats.sent / total) * 100);
  };

  const findDuplicateChats = (): Map<number, string[]> => {
    const chatToLists = new Map<number, string[]>();
    lists.forEach(list => {
      list.chatIds.forEach(chatId => {
        if (!chatToLists.has(chatId)) {
          chatToLists.set(chatId, []);
        }
        chatToLists.get(chatId)!.push(list.name);
      });
    });
    // Filter to only duplicates (in more than one list)
    const duplicates = new Map<number, string[]>();
    chatToLists.forEach((listNames, chatId) => {
      if (listNames.length > 1) {
        duplicates.set(chatId, listNames);
      }
    });
    return duplicates;
  };

  const autoCleanupLists = () => {
    const kickedChatIds = chats.filter(c => c.botKicked).map(c => c.id);
    if (kickedChatIds.length === 0) {
      addLog('No kicked chats to remove from lists', 'info');
      return;
    }

    setLists(prev => prev.map(list => ({
      ...list,
      chatIds: list.chatIds.filter(id => !kickedChatIds.includes(id))
    })));
    addLog(`Removed ${kickedChatIds.length} kicked chat(s) from all lists`, 'success');
  };

  const getChildLists = (parentId: string | null): ChatList[] => {
    return lists.filter(l => l.parentId === parentId);
  };

  const getRootLists = (): ChatList[] => {
    return lists.filter(l => l.parentId === null);
  };

  // ==================== TEMPLATE MANAGEMENT ====================
  const createTemplate = (name: string, content: string) => {
    const newTemplate: MessageTemplate = {
      id: `template_${Date.now()}`,
      name,
      content,
      createdAt: new Date().toISOString(),
      lastUsed: null,
    };
    setTemplates(prev => [...prev, newTemplate]);
    addLog(`Created template: ${name}`, 'success');
    return newTemplate;
  };

  const updateTemplate = (templateId: string, updates: Partial<MessageTemplate>) => {
    setTemplates(prev => prev.map(template =>
      template.id === templateId ? { ...template, ...updates } : template
    ));
  };

  const deleteTemplate = (templateId: string) => {
    setTemplates(prev => prev.filter(t => t.id !== templateId));
    addLog('Deleted template', 'info');
  };

  const useTemplate = (template: MessageTemplate) => {
    setMessage(template.content);
    updateTemplate(template.id, { lastUsed: new Date().toISOString() });
    addLog(`Loaded template: ${template.name}`, 'info');
  };

  const saveCurrentAsTemplate = () => {
    if (!message.trim()) return;
    setShowTemplateManager(true);
  };

  const broadcastMessage = async () => {
    if (!message.trim() || selectedChats.size === 0) return;
    
    setError('');
    setSendingProgress({ sent: 0, total: selectedChats.size, failed: 0 });
    setActiveTab('logs');
    addLog(`Starting broadcast to ${selectedChats.size} chats...`, 'info');
    
    let sent = 0;
    let failed = 0;
    const chatIds = Array.from(selectedChats);
    
    // Process in batches
    for (let i = 0; i < chatIds.length; i += SAFETY_CONFIG.BATCH_SIZE) {
      const batch = chatIds.slice(i, i + SAFETY_CONFIG.BATCH_SIZE);
      
      // Send batch
      const promises = batch.map(async (chatId) => {
        const chat = chats.find(c => c.id === chatId);
        
        try {
          const params: Record<string, any> = {
            chat_id: chatId,
            text: message,
          };
          
          if (parseMode !== 'none') {
            params.parse_mode = parseMode;
          }
          if (disableNotification) {
            params.disable_notification = true;
          }
          if (protectContent) {
            params.protect_content = true;
          }
          
          await callBotApi('sendMessage', params);
          sent++;
          addLog(`✓ ${chat?.title || chatId}`, 'success');
          return true;
        } catch (err: any) {
          failed++;
          addLog(`✗ ${chat?.title || chatId}: ${err.message}`, 'error');
          return false;
        }
      });
      
      await Promise.all(promises);
      setSendingProgress({ sent, total: selectedChats.size, failed });
      
      // Delay between batches
      if (i + SAFETY_CONFIG.BATCH_SIZE < chatIds.length) {
        await new Promise(r => setTimeout(r, SAFETY_CONFIG.BATCH_DELAY));
      }
    }
    
    const successRate = Math.round((sent / selectedChats.size) * 100);
    addLog(`\n✅ Broadcast complete: ${sent} sent, ${failed} failed (${successRate}%)`,
      successRate === 100 ? 'success' : 'warning');

    // Update list stats for all lists that contain the sent chats
    const now = new Date().toISOString();
    setLists(prev => prev.map(list => {
      const listChatIds = new Set(list.chatIds);
      const sentFromList = chatIds.filter(id => listChatIds.has(id));
      if (sentFromList.length > 0) {
        // Calculate how many succeeded/failed from this list
        const listSent = sentFromList.filter(id => {
          // We'd need to track per-chat results, for now estimate based on overall rate
          return true; // simplified: count all as attempted
        }).length;
        const listFailed = Math.round(listSent * (failed / selectedChats.size));
        const listSuccess = listSent - listFailed;
        return {
          ...list,
          stats: {
            sent: list.stats.sent + listSuccess,
            failed: list.stats.failed + listFailed,
            lastBroadcast: now,
          }
        };
      }
      return list;
    }));

    setTimeout(() => setSendingProgress(null), 3000);
  };

  const testMessage = async (chatId: number) => {
    const chat = chats.find(c => c.id === chatId);
    
    try {
      await callBotApi('sendMessage', {
        chat_id: chatId,
        text: '🔔 Test message from Bot Broadcaster',
      });
      addLog(`Test sent to ${chat?.title}`, 'success');
    } catch (err: any) {
      addLog(`Test failed for ${chat?.title}: ${err.message}`, 'error');
    }
  };

  const updateBotProfile = async (name: string) => {
    try {
      await callBotApi('setMyName', { name });
      addLog(`Bot name updated to: ${name}`, 'success');
      // Refresh bot info
      const me = await callBotApi('getMe');
      setBotInfo(me);
    } catch (err: any) {
      addLog(`Failed to update name: ${err.message}`, 'error');
    }
  };

  // ==================== AUTO-DISCOVER ====================
  const discoverChats = async () => {
    setIsDiscovering(true);
    addLog('Scanning for chats...', 'info');

    try {
      // Fetch recent updates from the bot
      const params: Record<string, any> = {
        limit: 100,
        allowed_updates: ['message', 'channel_post', 'my_chat_member'],
      };

      if (lastUpdateId) {
        params.offset = lastUpdateId + 1;
      }

      const updates = await callBotApi('getUpdates', params);

      if (updates.length === 0) {
        addLog('No new updates found. Try sending /register in a group where your bot is a member.', 'warning');
        setIsDiscovering(false);
        return;
      }

      // Track the last update ID
      const maxUpdateId = Math.max(...updates.map((u: any) => u.update_id));
      setLastUpdateId(maxUpdateId);

      // Extract unique chats from updates
      const chatMap = new Map<number, DiscoveredChat>();
      const existingChatIds = new Set(chats.map(c => c.id));

      for (const update of updates) {
        let chat: any = null;
        let source: DiscoveredChat['source'] = 'message';

        // Check for /register command
        if (update.message) {
          chat = update.message.chat;
          const text = update.message.text || '';
          if (text.toLowerCase().startsWith('/register')) {
            source = 'register_command';
          }
        } else if (update.channel_post) {
          chat = update.channel_post.chat;
          const text = update.channel_post.text || '';
          if (text.toLowerCase().startsWith('/register')) {
            source = 'register_command';
          }
        } else if (update.my_chat_member) {
          // Check if bot was added (not kicked/left)
          const newStatus = update.my_chat_member.new_chat_member?.status;
          if (newStatus === 'member' || newStatus === 'administrator') {
            chat = update.my_chat_member.chat;
            source = 'bot_added';
          }
          // Skip if bot was kicked or left
        }

        if (chat && !existingChatIds.has(chat.id) && !chatMap.has(chat.id)) {
          // Skip private chats unless it's from /register
          if (chat.type === 'private' && source !== 'register_command') {
            continue;
          }

          chatMap.set(chat.id, {
            id: chat.id,
            title: chat.title || chat.first_name || chat.username || `Chat ${chat.id}`,
            type: chat.type,
            username: chat.username,
            source,
          });
        }
      }

      const potentialChats = Array.from(chatMap.values());

      // Verify bot is still a member of each chat
      const verified: DiscoveredChat[] = [];
      for (const chat of potentialChats) {
        try {
          await callBotApi('getChat', { chat_id: chat.id });
          verified.push(chat);
        } catch {
          // Bot was kicked or chat deleted, skip it
          addLog(`Skipped ${chat.title}: bot no longer has access`, 'warning');
        }
      }

      // Prioritize /register commands at the top
      verified.sort((a, b) => {
        if (a.source === 'register_command' && b.source !== 'register_command') return -1;
        if (b.source === 'register_command' && a.source !== 'register_command') return 1;
        return 0;
      });

      setDiscoveredChats(verified);

      const registerCount = verified.filter(c => c.source === 'register_command').length;
      if (verified.length > 0) {
        addLog(`Found ${verified.length} new chat(s)${registerCount > 0 ? ` (${registerCount} via /register)` : ''}`, 'success');
      } else {
        addLog('No new chats found. All discovered chats are already added.', 'info');
      }
    } catch (err: any) {
      addLog(`Discovery failed: ${err.message}`, 'error');
    } finally {
      setIsDiscovering(false);
    }
  };

  const addDiscoveredChat = async (discovered: DiscoveredChat) => {
    setIsLoading(true);
    try {
      // Get full chat info and member count
      const chat = await callBotApi('getChat', { chat_id: discovered.id });

      const newChat: Chat = {
        id: chat.id,
        title: chat.title || chat.first_name || chat.username || `Chat ${chat.id}`,
        type: chat.type,
        username: chat.username,
      };

      // Try to get member count
      try {
        const count = await callBotApi('getChatMemberCount', { chat_id: chat.id });
        newChat.memberCount = count;
      } catch {}

      setChats(prev => [...prev, newChat]);
      setDiscoveredChats(prev => prev.filter(c => c.id !== discovered.id));
      addLog(`Added: ${newChat.title}`, 'success');
    } catch (err: any) {
      addLog(`Failed to add ${discovered.title}: ${err.message}`, 'error');
      // Remove from discovered list since bot likely doesn't have access
      setDiscoveredChats(prev => prev.filter(c => c.id !== discovered.id));
    } finally {
      setIsLoading(false);
    }
  };

  const addAllDiscoveredChats = async () => {
    for (const chat of discoveredChats) {
      await addDiscoveredChat(chat);
    }
  };

  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshChats = async () => {
    if (chats.length === 0) return;

    setIsRefreshing(true);
    addLog('Refreshing chat statuses...', 'info');

    let updated = 0;
    let kicked = 0;

    const updatedChats = await Promise.all(
      chats.map(async (chat) => {
        try {
          // Try to get chat info - if it fails, bot was kicked
          const chatInfo = await callBotApi('getChat', { chat_id: chat.id });

          // Try to get updated member count
          let memberCount = chat.memberCount;
          try {
            memberCount = await callBotApi('getChatMemberCount', { chat_id: chat.id });
          } catch {}

          updated++;
          return {
            ...chat,
            title: chatInfo.title || chatInfo.first_name || chat.title,
            memberCount,
            botKicked: false,
          };
        } catch (err: any) {
          // Bot was likely kicked or chat was deleted
          kicked++;
          addLog(`Bot no longer in: ${chat.title}`, 'warning');
          return {
            ...chat,
            botKicked: true,
          };
        }
      })
    );

    setChats(updatedChats);
    addLog(`Refresh complete: ${updated} active, ${kicked} kicked/removed`, kicked > 0 ? 'warning' : 'success');
    setIsRefreshing(false);
  };

  // Auto-refresh saved chats after connecting
  useEffect(() => {
    if (step === 'connected' && chats.length > 0 && botInfo && !hasAutoRefreshed.current) {
      hasAutoRefreshed.current = true;
      addLog('Validating saved chats...', 'info');
      refreshChats();
    }
    // Reset when disconnected
    if (step === 'setup') {
      hasAutoRefreshed.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, botInfo]);

  const disconnect = () => {
    // Clear all stored data from both storages
    localStorage.removeItem('tg_bot_token');
    localStorage.removeItem('tg_remember_token');
    localStorage.removeItem('tg_bot_chats');
    localStorage.removeItem('tg_bot_lists');
    localStorage.removeItem('tg_bot_templates');
    sessionStorage.removeItem('tg_bot_token');
    sessionStorage.removeItem('tg_bot_chats');
    sessionStorage.removeItem('tg_bot_lists');
    sessionStorage.removeItem('tg_bot_templates');

    // Reset state
    setBotToken('');
    setBotInfo(null);
    setChats([]);
    setSelectedChats(new Set());
    setLists([]);
    setSelectedLists(new Set());
    setExcludedLists(new Set());
    setTemplates([]);
    setStep('setup');
    setRememberToken(false);
    addLog('Disconnected - all data cleared', 'info');
  };

  const filteredChats = getFilteredChats();

  // ==================== RENDER ====================
  return (
    <div className="min-h-screen bg-[#07070a] text-white">
      {/* Background Effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-30%] left-[-15%] w-[700px] h-[700px] rounded-full bg-[#2AABEE]/5 blur-[150px] animate-pulse-slow" />
        <div className="absolute bottom-[-30%] right-[-15%] w-[600px] h-[600px] rounded-full bg-emerald-500/5 blur-[130px] animate-pulse-slow" style={{ animationDelay: '-2s' }} />
        <div className="absolute inset-0 opacity-[0.015]" style={{
          backgroundImage: `radial-gradient(rgba(255,255,255,0.3) 1px, transparent 1px)`,
          backgroundSize: '30px 30px'
        }} />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto p-4 md:p-8">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative group">
                <div className="absolute inset-0 bg-gradient-to-br from-[#2AABEE] to-emerald-500 blur-xl opacity-50 group-hover:opacity-75 transition-opacity" />
                <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-[#2AABEE] to-emerald-500 flex items-center justify-center shadow-2xl text-2xl">
                  🤖
                </div>
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold">
                  Bot <span className="gradient-text">Broadcaster</span>
                </h1>
                <p className="text-white/40 text-sm">Fast & safe message broadcasting</p>
              </div>
            </div>
            
            {botInfo && (
              <div className="flex items-center gap-4">
                <div className="hidden sm:flex items-center gap-2 px-4 py-2 glass rounded-xl">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-sm">@{botInfo.username}</span>
                </div>
                <button
                  onClick={disconnect}
                  className="p-2 text-white/40 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                  title="Disconnect"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Setup Step */}
        {step === 'setup' && (
          <div className="max-w-xl mx-auto mt-12 space-y-6">
            {/* Info Card */}
            <div className="glass rounded-2xl p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span>📋</span> How to Get Your Bot Token
              </h2>
              <ol className="space-y-3 text-sm text-white/70">
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#2AABEE]/20 text-[#2AABEE] flex items-center justify-center text-xs font-bold">1</span>
                  <span>Open Telegram and search for <code className="px-1.5 py-0.5 bg-white/10 rounded text-[#2AABEE]">@BotFather</code></span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#2AABEE]/20 text-[#2AABEE] flex items-center justify-center text-xs font-bold">2</span>
                  <span>Send <code className="px-1.5 py-0.5 bg-white/10 rounded text-[#2AABEE]">/newbot</code> and follow the prompts</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#2AABEE]/20 text-[#2AABEE] flex items-center justify-center text-xs font-bold">3</span>
                  <span>Copy the token (looks like <code className="px-1.5 py-0.5 bg-white/10 rounded text-xs">123456:ABC-xyz...</code>)</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#2AABEE]/20 text-[#2AABEE] flex items-center justify-center text-xs font-bold">4</span>
                  <span>Paste it below and connect!</span>
                </li>
              </ol>
            </div>

            {/* Token Input */}
            <div className="glass rounded-2xl p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span>🔑</span> Connect Your Bot
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-white/60 mb-2">Bot Token</label>
                  <input
                    type="password"
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && connectBot()}
                    placeholder="123456789:ABCdefGHI..."
                    className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl text-white placeholder-white/20 focus-ring font-mono text-sm"
                  />
                </div>

                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => setRememberToken(!rememberToken)}
                    className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                      rememberToken
                        ? 'bg-[#2AABEE] border-[#2AABEE]'
                        : 'border-white/20 hover:border-white/40'
                    }`}
                  >
                    {rememberToken && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <div>
                    <p className="text-sm text-white/80">Remember token</p>
                  </div>
                </div>

                {error && (
                  <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                    {error}
                  </div>
                )}

                <button
                  onClick={connectBot}
                  disabled={isLoading || !botToken.trim()}
                  className="w-full py-3 bg-gradient-to-r from-[#2AABEE] to-emerald-500 hover:from-[#3bb5f5] hover:to-emerald-400 rounded-xl font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed btn-glow"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Connecting...
                    </span>
                  ) : 'Connect Bot'}
                </button>
              </div>
            </div>

            {/* Features Card */}
            <div className="glass rounded-2xl p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span>⚡</span> Why Use a Bot?
              </h2>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-start gap-2">
                  <span className="text-emerald-500">✓</span>
                  <span className="text-white/70">30 messages/second</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-emerald-500">✓</span>
                  <span className="text-white/70">No account risk</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-emerald-500">✓</span>
                  <span className="text-white/70">100% free</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-emerald-500">✓</span>
                  <span className="text-white/70">Official API</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Connected Step */}
        {step === 'connected' && (
          <div className="space-y-6">
            {/* Stats Bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="glass rounded-xl p-4">
                <p className="text-white/40 text-xs mb-1">Total Chats</p>
                <p className="text-2xl font-bold">{chats.length}</p>
              </div>
              <div className="glass rounded-xl p-4">
                <p className="text-white/40 text-xs mb-1">Selected</p>
                <p className="text-2xl font-bold text-[#2AABEE]">{selectedChats.size}</p>
              </div>
              <div className="glass rounded-xl p-4">
                <p className="text-white/40 text-xs mb-1">Rate Limit</p>
                <p className="text-2xl font-bold text-emerald-500">30/s</p>
              </div>
              <div className="glass rounded-xl p-4">
                <p className="text-white/40 text-xs mb-1">Status</p>
                <p className="text-2xl font-bold text-emerald-500">Ready</p>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 p-1 glass rounded-xl">
              {[
                { id: 'chats', label: '💬 Chats', count: chats.length },
                { id: 'compose', label: '✏️ Compose' },
                { id: 'settings', label: '⚙️ Settings' },
                { id: 'logs', label: '📋 Logs' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as Tab)}
                  className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                    activeTab === tab.id ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'
                  }`}
                >
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className="px-1.5 py-0.5 bg-white/10 rounded text-xs">{tab.count}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="glass rounded-2xl overflow-hidden">
              {/* Chats Tab */}
              {activeTab === 'chats' && (
                <div>
                  {/* Auto-Discover Section */}
                  <div className="p-4 border-b border-white/5 bg-gradient-to-r from-[#2AABEE]/5 to-emerald-500/5">
                    <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
                      <div>
                        <h4 className="font-medium flex items-center gap-2">
                          <span>🔍</span> Auto-Discover Chats
                        </h4>
                        <p className="text-xs text-white/40 mt-1">
                          Scan for groups/channels where your bot received messages or /register command
                        </p>
                      </div>
                      <button
                        onClick={discoverChats}
                        disabled={isDiscovering}
                        className="px-4 py-2.5 bg-[#2AABEE] hover:bg-[#3bb5f5] rounded-xl text-sm font-medium disabled:opacity-50 transition-colors flex items-center gap-2 whitespace-nowrap"
                      >
                        {isDiscovering ? (
                          <>
                            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Scanning...
                          </>
                        ) : (
                          <>
                            <span>🔍</span> Discover Chats
                          </>
                        )}
                      </button>
                    </div>

                    {/* Discovered Chats */}
                    {discoveredChats.length > 0 && (
                      <div className="mt-4">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm text-white/60">
                            Found {discoveredChats.length} new chat(s)
                          </p>
                          <button
                            onClick={addAllDiscoveredChats}
                            disabled={isLoading}
                            className="text-xs text-[#2AABEE] hover:text-[#3bb5f5] transition-colors"
                          >
                            Add All
                          </button>
                        </div>
                        <div className="space-y-2 max-h-[200px] overflow-y-auto">
                          {discoveredChats.map(chat => (
                            <div
                              key={chat.id}
                              className="flex items-center gap-3 p-3 bg-black/20 rounded-xl"
                            >
                              <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-sm">
                                {chat.type === 'channel' ? '📢' : chat.type === 'private' ? '👤' : '👥'}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm truncate">{chat.title}</p>
                                <p className="text-xs text-white/40">
                                  {chat.type}
                                  {chat.source === 'register_command' && (
                                    <span className="ml-2 px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-[10px]">
                                      /register
                                    </span>
                                  )}
                                  {chat.source === 'bot_added' && (
                                    <span className="ml-2 px-1.5 py-0.5 bg-[#2AABEE]/20 text-[#2AABEE] rounded text-[10px]">
                                      bot added
                                    </span>
                                  )}
                                </p>
                              </div>
                              <button
                                onClick={() => addDiscoveredChat(chat)}
                                disabled={isLoading}
                                className="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                              >
                                + Add
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Quick Add Bot Links */}
                  {botInfo?.username && (
                    <div className="p-4 border-b border-white/5">
                      <h4 className="font-medium flex items-center gap-2 mb-3">
                        <span>⚡</span> Quick Add Bot to Chats
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={`https://t.me/${botInfo.username}?startgroup=true`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-xl text-sm text-emerald-400 transition-colors"
                        >
                          <span>👥</span> Add to Group
                        </a>
                        <a
                          href={`https://t.me/${botInfo.username}?startchannel=true`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 px-4 py-2.5 bg-[#2AABEE]/10 hover:bg-[#2AABEE]/20 border border-[#2AABEE]/20 rounded-xl text-sm text-[#2AABEE] transition-colors"
                        >
                          <span>📢</span> Add to Channel
                        </a>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(`https://t.me/${botInfo.username}?startgroup=true`);
                            addLog('Group invite link copied!', 'success');
                          }}
                          className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-sm text-white/60 transition-colors"
                        >
                          <span>📋</span> Copy Link
                        </button>
                      </div>
                      <p className="text-xs text-white/40 mt-2">
                        Click to open Telegram and select chats. After adding, click "Discover Chats" above.
                      </p>
                    </div>
                  )}

                  {/* Lists Section */}
                  <div className="p-4 border-b border-white/5">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-medium flex items-center gap-2">
                        <span>📁</span> Chat Lists
                        {lists.length > 0 && (
                          <span className="px-1.5 py-0.5 bg-white/10 rounded text-xs">{lists.length}</span>
                        )}
                      </h4>
                      <div className="flex gap-2">
                        {lists.length > 0 && (
                          <>
                            <button
                              onClick={autoCleanupLists}
                              className="px-3 py-1.5 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 rounded-lg text-xs transition-colors"
                              title="Remove kicked chats from all lists"
                            >
                              🧹 Cleanup
                            </button>
                            <button
                              onClick={() => {
                                const dupes = findDuplicateChats();
                                if (dupes.size === 0) {
                                  addLog('No duplicate chats found across lists', 'info');
                                } else {
                                  dupes.forEach((listNames, chatId) => {
                                    const chat = chats.find(c => c.id === chatId);
                                    addLog(`Duplicate: ${chat?.title || chatId} in ${listNames.join(', ')}`, 'warning');
                                  });
                                }
                              }}
                              className="px-3 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 rounded-lg text-xs transition-colors"
                              title="Find chats in multiple lists"
                            >
                              🔍 Duplicates
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => setShowListManager(true)}
                          className="px-3 py-1.5 bg-[#2AABEE]/20 hover:bg-[#2AABEE]/30 text-[#2AABEE] rounded-lg text-xs font-medium transition-colors"
                        >
                          + New List
                        </button>
                      </div>
                    </div>

                    {lists.length === 0 ? (
                      <p className="text-xs text-white/40">
                        Create lists to organize your chats (e.g., Gaming Influencers, DeFi Channels)
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {/* List Selection for Broadcasting */}
                        {(selectedLists.size > 0 || excludedLists.size > 0) && (
                          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl mb-3">
                            <div className="flex items-center justify-between">
                              <div className="text-xs">
                                <span className="text-emerald-400">
                                  {selectedLists.size} list(s) selected
                                </span>
                                {excludedLists.size > 0 && (
                                  <span className="text-red-400 ml-2">
                                    {excludedLists.size} excluded
                                  </span>
                                )}
                                <span className="text-white/40 ml-2">
                                  = {getChatsFromLists().length} chats
                                </span>
                              </div>
                              <button
                                onClick={selectChatsFromLists}
                                className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-medium transition-colors"
                              >
                                Apply Selection
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Render root lists */}
                        {getRootLists().map((list, index) => (
                          <div key={list.id}>
                            <div
                              className={`p-3 rounded-xl border transition-colors ${
                                selectedLists.has(list.id)
                                  ? 'bg-emerald-500/10 border-emerald-500/30'
                                  : excludedLists.has(list.id)
                                    ? 'bg-red-500/10 border-red-500/30'
                                    : 'bg-black/20 border-white/5 hover:border-white/10'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <div
                                  className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
                                  style={{ backgroundColor: list.color + '30' }}
                                >
                                  {list.icon}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="font-medium text-sm truncate">{list.name}</p>
                                    <span className="px-1.5 py-0.5 bg-white/10 rounded text-[10px] text-white/60">
                                      {list.chatIds.length} chats
                                    </span>
                                    {getListSuccessRate(list) > 0 && (
                                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                        getListSuccessRate(list) >= 90 ? 'bg-emerald-500/20 text-emerald-400' :
                                        getListSuccessRate(list) >= 70 ? 'bg-yellow-500/20 text-yellow-400' :
                                        'bg-red-500/20 text-red-400'
                                      }`}>
                                        {getListSuccessRate(list)}% success
                                      </span>
                                    )}
                                  </div>
                                  {list.stats.lastBroadcast && (
                                    <p className="text-[10px] text-white/40">
                                      Last: {new Date(list.stats.lastBroadcast).toLocaleDateString()}
                                    </p>
                                  )}
                                </div>
                                <div className="flex items-center gap-1">
                                  {/* Move up/down */}
                                  <button
                                    onClick={() => moveListUp(list.id)}
                                    disabled={index === 0}
                                    className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-all disabled:opacity-30"
                                    title="Move up"
                                  >
                                    ↑
                                  </button>
                                  <button
                                    onClick={() => moveListDown(list.id)}
                                    disabled={index === getRootLists().length - 1}
                                    className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-all disabled:opacity-30"
                                    title="Move down"
                                  >
                                    ↓
                                  </button>
                                  {/* Include */}
                                  <button
                                    onClick={() => toggleListSelection(list.id)}
                                    className={`p-1.5 rounded-lg transition-all ${
                                      selectedLists.has(list.id)
                                        ? 'text-emerald-400 bg-emerald-500/20'
                                        : 'text-white/40 hover:text-emerald-400 hover:bg-emerald-500/10'
                                    }`}
                                    title="Include in broadcast"
                                  >
                                    ✓
                                  </button>
                                  {/* Exclude */}
                                  <button
                                    onClick={() => toggleListExclusion(list.id)}
                                    className={`p-1.5 rounded-lg transition-all ${
                                      excludedLists.has(list.id)
                                        ? 'text-red-400 bg-red-500/20'
                                        : 'text-white/40 hover:text-red-400 hover:bg-red-500/10'
                                    }`}
                                    title="Exclude from broadcast"
                                  >
                                    ✗
                                  </button>
                                  {/* Expand/collapse children */}
                                  {getChildLists(list.id).length > 0 && (
                                    <button
                                      onClick={() => setExpandedLists(prev => {
                                        const newSet = new Set(prev);
                                        if (newSet.has(list.id)) newSet.delete(list.id);
                                        else newSet.add(list.id);
                                        return newSet;
                                      })}
                                      className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-all"
                                    >
                                      {expandedLists.has(list.id) ? '▼' : '▶'}
                                    </button>
                                  )}
                                  {/* Edit */}
                                  <button
                                    onClick={() => setEditingList(list)}
                                    className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-all"
                                    title="Edit list"
                                  >
                                    ✏️
                                  </button>
                                  {/* Delete */}
                                  <button
                                    onClick={() => deleteList(list.id)}
                                    className="p-1.5 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                                    title="Delete list"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </div>

                              {/* Child lists */}
                              {expandedLists.has(list.id) && getChildLists(list.id).length > 0 && (
                                <div className="ml-6 mt-2 space-y-2 border-l-2 border-white/10 pl-3">
                                  {getChildLists(list.id).map(childList => (
                                    <div
                                      key={childList.id}
                                      className={`p-2 rounded-lg border transition-colors ${
                                        selectedLists.has(childList.id)
                                          ? 'bg-emerald-500/10 border-emerald-500/30'
                                          : excludedLists.has(childList.id)
                                            ? 'bg-red-500/10 border-red-500/30'
                                            : 'bg-black/20 border-white/5'
                                      }`}
                                    >
                                      <div className="flex items-center gap-2">
                                        <span>{childList.icon}</span>
                                        <span className="text-xs flex-1">{childList.name}</span>
                                        <span className="text-[10px] text-white/40">{childList.chatIds.length}</span>
                                        <button
                                          onClick={() => toggleListSelection(childList.id)}
                                          className={`p-1 rounded ${selectedLists.has(childList.id) ? 'text-emerald-400' : 'text-white/40'}`}
                                        >
                                          ✓
                                        </button>
                                        <button
                                          onClick={() => toggleListExclusion(childList.id)}
                                          className={`p-1 rounded ${excludedLists.has(childList.id) ? 'text-red-400' : 'text-white/40'}`}
                                        >
                                          ✗
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="p-4 border-b border-white/5">
                    <div className="flex flex-col sm:flex-row gap-3">
                      {/* Add Chat */}
                      <div className="flex-1 flex gap-2">
                        <input
                          type="text"
                          value={newChatId}
                          onChange={(e) => setNewChatId(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && addChat()}
                          placeholder="Chat ID, @username, or invite link"
                          className="flex-1 px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm focus-ring"
                        />
                        <button
                          onClick={addChat}
                          disabled={isLoading || !newChatId.trim()}
                          className="px-4 py-2.5 bg-[#2AABEE] hover:bg-[#3bb5f5] rounded-xl text-sm font-medium disabled:opacity-50 transition-colors"
                        >
                          Add
                        </button>
                      </div>

                      {/* Filter */}
                      <div className="flex gap-2">
                        <select
                          value={filterType}
                          onChange={(e) => setFilterType(e.target.value)}
                          className="px-3 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm focus-ring"
                        >
                          <option value="all">All Types</option>
                          <option value="channel">Channels</option>
                          <option value="group">Groups</option>
                          <option value="private">Private</option>
                        </select>
                        <button
                          onClick={refreshChats}
                          disabled={isRefreshing || chats.length === 0}
                          className="px-4 py-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
                          title="Refresh chat statuses"
                        >
                          <span className={isRefreshing ? 'animate-spin' : ''}>🔄</span>
                          {isRefreshing ? 'Refreshing...' : 'Refresh'}
                        </button>
                        <button
                          onClick={selectAll}
                          className="px-4 py-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-sm transition-colors"
                        >
                          {filteredChats.length > 0 && filteredChats.every(c => selectedChats.has(c.id)) ? 'Deselect' : 'Select'} All
                        </button>
                      </div>
                    </div>

                    {error && (
                      <div className="mt-3 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                        {error}
                      </div>
                    )}
                  </div>

                  <div className="max-h-[400px] overflow-y-auto">
                    {chats.length === 0 ? (
                      <div className="p-12 text-center">
                        <div className="text-4xl mb-3">📭</div>
                        <p className="text-white/60 mb-2">No chats added yet</p>
                        <p className="text-white/40 text-sm">Add your bot to groups/channels, then add them here</p>
                      </div>
                    ) : filteredChats.length === 0 ? (
                      <div className="p-12 text-center text-white/40">No matching chats</div>
                    ) : (
                      <div className="divide-y divide-white/5">
                        {filteredChats.map(chat => (
                          <div
                            key={chat.id}
                            onClick={() => toggleChat(chat.id)}
                            className={`p-4 flex items-center gap-4 transition-colors cursor-pointer ${
                              chat.botKicked
                                ? 'bg-red-500/10 hover:bg-red-500/15'
                                : selectedChats.has(chat.id)
                                  ? 'bg-[#2AABEE]/10 hover:bg-[#2AABEE]/15'
                                  : 'hover:bg-white/[0.02]'
                            }`}
                          >
                            <div
                              className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl transition-colors ${
                                chat.botKicked
                                  ? 'bg-red-500/20'
                                  : selectedChats.has(chat.id)
                                    ? 'bg-[#2AABEE]'
                                    : 'bg-white/5'
                              }`}
                            >
                              {chat.botKicked ? '⛔' : chat.type === 'channel' ? '📢' : chat.type === 'private' ? '👤' : '👥'}
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className={`font-medium truncate ${chat.botKicked ? 'text-red-400' : ''}`}>
                                {chat.title}
                                {chat.botKicked && (
                                  <span className="ml-2 px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded text-[10px]">
                                    Bot Kicked
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-white/40">
                                {chat.type} • ID: {chat.id}
                                {chat.memberCount && ` • ${chat.memberCount.toLocaleString()} members`}
                              </p>
                            </div>

                            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => testMessage(chat.id)}
                                className="p-2 text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-all"
                                title="Send test message"
                              >
                                📤
                              </button>
                              <button
                                onClick={() => removeChat(chat.id)}
                                className="p-2 text-white/40 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                                title="Remove"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Compose Tab */}
              {activeTab === 'compose' && (
                <div className="p-6">
                  <h3 className="font-semibold mb-4">Compose Message</h3>

                  <div className="space-y-4">
                    {/* Templates Section */}
                    <div className="p-4 bg-gradient-to-r from-purple-500/5 to-pink-500/5 border border-white/5 rounded-xl">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-medium flex items-center gap-2 text-sm">
                          <span>📝</span> Message Templates
                          {templates.length > 0 && (
                            <span className="px-1.5 py-0.5 bg-white/10 rounded text-xs">{templates.length}</span>
                          )}
                        </h4>
                        {message.trim() && (
                          <button
                            onClick={() => setShowTemplateManager(true)}
                            className="px-3 py-1.5 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 rounded-lg text-xs font-medium transition-colors"
                          >
                            💾 Save as Template
                          </button>
                        )}
                      </div>

                      {templates.length === 0 ? (
                        <p className="text-xs text-white/40">
                          No templates yet. Type a message and click "Save as Template" to create one.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {templates.map(template => (
                            <div
                              key={template.id}
                              className="group flex items-center gap-1 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                            >
                              <button
                                onClick={() => useTemplate(template)}
                                className="text-xs text-white/80 hover:text-white"
                                title={template.content.substring(0, 100) + (template.content.length > 100 ? '...' : '')}
                              >
                                {template.name}
                              </button>
                              <button
                                onClick={() => setEditingTemplate(template)}
                                className="p-0.5 text-white/30 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Edit template"
                              >
                                ✏️
                              </button>
                              <button
                                onClick={() => deleteTemplate(template.id)}
                                className="p-0.5 text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Delete template"
                              >
                                ✗
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm text-white/60 mb-2">Message</label>
                      <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder={parseMode === 'HTML'
                          ? "Type your message...\n\nSupports HTML:\n<b>bold</b>, <i>italic</i>, <code>code</code>, <a href='url'>link</a>"
                          : parseMode === 'Markdown'
                          ? "Type your message...\n\nSupports Markdown:\n**bold**, _italic_, `code`, [link](url)"
                          : "Type your message (plain text)..."
                        }
                        rows={8}
                        className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl text-white placeholder-white/20 focus-ring resize-none"
                      />
                      <p className="mt-2 text-xs text-white/30">{message.length} characters</p>
                    </div>

                    {/* Progress */}
                    {sendingProgress && (
                      <div className="p-4 bg-[#2AABEE]/10 border border-[#2AABEE]/20 rounded-xl">
                        <div className="flex justify-between mb-2 text-sm">
                          <span>Broadcasting...</span>
                          <span className="text-[#2AABEE]">{sendingProgress.sent}/{sendingProgress.total}</span>
                        </div>
                        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-[#2AABEE] to-emerald-500 transition-all"
                            style={{ width: `${(sendingProgress.sent / sendingProgress.total) * 100}%` }}
                          />
                        </div>
                        {sendingProgress.failed > 0 && (
                          <p className="mt-2 text-xs text-red-400">{sendingProgress.failed} failed</p>
                        )}
                      </div>
                    )}

                    <button
                      onClick={broadcastMessage}
                      disabled={!message.trim() || selectedChats.size === 0 || !!sendingProgress}
                      className="w-full py-4 bg-gradient-to-r from-[#2AABEE] to-emerald-500 hover:from-[#3bb5f5] hover:to-emerald-400 rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed btn-glow flex items-center justify-center gap-2 transition-all"
                    >
                      <span>📤</span>
                      Send to {selectedChats.size} Chat{selectedChats.size !== 1 ? 's' : ''}
                    </button>

                    {selectedChats.size === 0 && (
                      <p className="text-center text-white/40 text-sm">
                        Select chats in the Chats tab first
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Settings Tab */}
              {activeTab === 'settings' && (
                <div className="p-6 space-y-6">
                  <div>
                    <h3 className="font-semibold mb-4">Message Settings</h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm text-white/60 mb-2">Parse Mode</label>
                        <select
                          value={parseMode}
                          onChange={(e) => setParseMode(e.target.value as any)}
                          className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl focus-ring"
                        >
                          <option value="HTML">HTML (recommended)</option>
                          <option value="Markdown">Markdown</option>
                          <option value="none">Plain Text</option>
                        </select>
                      </div>
                      
                      <div className="flex items-center justify-between py-3 border-b border-white/5">
                        <div>
                          <p className="font-medium">Silent Messages</p>
                          <p className="text-sm text-white/40">Recipients won't receive notification</p>
                        </div>
                        <button
                          onClick={() => setDisableNotification(!disableNotification)}
                          className={`w-12 h-7 rounded-full transition-colors ${disableNotification ? 'bg-[#2AABEE]' : 'bg-white/10'}`}
                        >
                          <div className={`w-5 h-5 bg-white rounded-full transition-transform ${disableNotification ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>
                      
                      <div className="flex items-center justify-between py-3">
                        <div>
                          <p className="font-medium">Protect Content</p>
                          <p className="text-sm text-white/40">Prevent forwarding & saving</p>
                        </div>
                        <button
                          onClick={() => setProtectContent(!protectContent)}
                          className={`w-12 h-7 rounded-full transition-colors ${protectContent ? 'bg-[#2AABEE]' : 'bg-white/10'}`}
                        >
                          <div className={`w-5 h-5 bg-white rounded-full transition-transform ${protectContent ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-4">Bot Info</h3>
                    {botInfo && (
                      <div className="space-y-3 text-sm">
                        <div className="flex justify-between py-2 border-b border-white/5">
                          <span className="text-white/60">Name</span>
                          <span>{botInfo.first_name}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-white/5">
                          <span className="text-white/60">Username</span>
                          <span>@{botInfo.username}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-white/5">
                          <span className="text-white/60">Bot ID</span>
                          <span className="font-mono">{botInfo.id}</span>
                        </div>
                        <div className="flex justify-between py-2">
                          <span className="text-white/60">Can Join Groups</span>
                          <span>{botInfo.can_join_groups ? '✅' : '❌'}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="font-semibold mb-4">Data</h3>
                    <button
                      onClick={() => {
                        localStorage.removeItem('tg_bot_chats');
                        setChats([]);
                        setSelectedChats(new Set());
                        addLog('All chats cleared', 'info');
                      }}
                      className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl text-sm transition-colors"
                    >
                      Clear All Chats
                    </button>
                  </div>
                </div>
              )}

              {/* Logs Tab */}
              {activeTab === 'logs' && (
                <div>
                  <div className="p-4 border-b border-white/5 flex justify-between items-center">
                    <h3 className="font-semibold">Activity Log</h3>
                    <button
                      onClick={() => setLogs([])}
                      className="text-xs text-white/40 hover:text-white/60"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="max-h-[400px] overflow-y-auto p-4">
                    {logs.length === 0 ? (
                      <p className="text-center text-white/30 text-sm py-8">No activity yet</p>
                    ) : (
                      <div className="space-y-1 font-mono text-xs">
                        {logs.map((log, i) => (
                          <div
                            key={i}
                            className={`px-3 py-2 rounded-lg ${
                              log.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' :
                              log.type === 'error' ? 'bg-red-500/10 text-red-400' :
                              log.type === 'warning' ? 'bg-yellow-500/10 text-yellow-400' :
                              'bg-white/5 text-white/60'
                            }`}
                          >
                            <span className="text-white/30">[{log.timestamp}]</span> {log.message}
                          </div>
                        ))}
                        <div ref={logsEndRef} />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Help Card */}
            <div className="glass rounded-2xl p-6">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <span>💡</span> How to Add Chats
              </h3>
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm text-white/60">
                <div className="p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
                  <p className="font-medium text-emerald-400 mb-1">Easy Way: /register</p>
                  <p>Add bot to any group, send <code className="px-1 py-0.5 bg-white/10 rounded text-xs">/register</code>, then click "Discover Chats"</p>
                </div>
                <div>
                  <p className="font-medium text-white mb-1">Channels</p>
                  <p>Make your bot an admin, then add using @username or channel ID</p>
                </div>
                <div>
                  <p className="font-medium text-white mb-1">Groups</p>
                  <p>Add bot to group, then click "Discover Chats" or add manually by ID</p>
                </div>
                <div>
                  <p className="font-medium text-white mb-1">Users</p>
                  <p>User must start chat with your bot first, then add their user ID</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Create List Modal */}
        {showListManager && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="glass rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <span>📁</span> Create New List
              </h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.target as HTMLFormElement;
                  const name = (form.elements.namedItem('listName') as HTMLInputElement).value;
                  const color = (form.elements.namedItem('listColor') as HTMLInputElement).value;
                  const icon = (form.elements.namedItem('listIcon') as HTMLSelectElement).value;
                  const parentId = (form.elements.namedItem('parentList') as HTMLSelectElement).value || null;
                  if (name.trim()) {
                    createList(name.trim(), color, icon, parentId);
                    setShowListManager(false);
                  }
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm text-white/60 mb-2">List Name</label>
                  <input
                    name="listName"
                    type="text"
                    placeholder="e.g., Gaming Influencers"
                    className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm focus-ring"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-white/60 mb-2">Color</label>
                  <div className="flex gap-2 flex-wrap">
                    {LIST_COLORS.map((color, i) => (
                      <label key={color} className="cursor-pointer">
                        <input
                          type="radio"
                          name="listColor"
                          value={color}
                          defaultChecked={i === 0}
                          className="sr-only"
                        />
                        <div
                          className="w-8 h-8 rounded-lg border-2 border-transparent hover:border-white/50 transition-colors"
                          style={{ backgroundColor: color }}
                        />
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-white/60 mb-2">Icon</label>
                  <select
                    name="listIcon"
                    className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm focus-ring"
                  >
                    {LIST_ICONS.map(icon => (
                      <option key={icon} value={icon}>{icon}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-white/60 mb-2">Parent List (Optional - for nesting)</label>
                  <select
                    name="parentList"
                    className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm focus-ring"
                  >
                    <option value="">None (Root List)</option>
                    {getRootLists().map(list => (
                      <option key={list.id} value={list.id}>{list.icon} {list.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowListManager(false)}
                    className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-sm transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 bg-[#2AABEE] hover:bg-[#3bb5f5] rounded-xl text-sm font-medium transition-colors"
                  >
                    Create List
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit List Modal */}
        {editingList && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="glass rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <span>{editingList.icon}</span> Edit: {editingList.name}
              </h3>

              {/* Edit Name/Color/Icon */}
              <div className="space-y-4 mb-6">
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={editingList.name}
                    onChange={(e) => setEditingList({ ...editingList, name: e.target.value })}
                    className="flex-1 px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm focus-ring"
                  />
                  <select
                    value={editingList.icon}
                    onChange={(e) => setEditingList({ ...editingList, icon: e.target.value })}
                    className="px-3 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm focus-ring"
                  >
                    {LIST_ICONS.map(icon => (
                      <option key={icon} value={icon}>{icon}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {LIST_COLORS.map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setEditingList({ ...editingList, color })}
                      className={`w-8 h-8 rounded-lg border-2 transition-colors ${
                        editingList.color === color ? 'border-white' : 'border-transparent hover:border-white/50'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              {/* Search within list */}
              <div className="mb-4">
                <input
                  type="text"
                  placeholder="Search chats..."
                  value={listSearchQuery}
                  onChange={(e) => setListSearchQuery(e.target.value)}
                  className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm focus-ring"
                />
              </div>

              {/* Chats in list */}
              <div className="mb-4">
                <h4 className="text-sm text-white/60 mb-2">
                  Chats in this list ({editingList.chatIds.length})
                </h4>
                <div className="max-h-[200px] overflow-y-auto space-y-1 bg-black/20 rounded-xl p-2">
                  {editingList.chatIds.length === 0 ? (
                    <p className="text-xs text-white/40 p-2">No chats in this list yet</p>
                  ) : (
                    editingList.chatIds
                      .map(id => chats.find(c => c.id === id))
                      .filter(Boolean)
                      .filter(chat => !listSearchQuery || chat!.title.toLowerCase().includes(listSearchQuery.toLowerCase()))
                      .map(chat => (
                        <div key={chat!.id} className="flex items-center gap-2 p-2 bg-white/5 rounded-lg">
                          <span className="text-sm">{chat!.type === 'channel' ? '📢' : '👥'}</span>
                          <span className="text-sm flex-1 truncate">{chat!.title}</span>
                          <button
                            onClick={() => {
                              const newChatIds = editingList.chatIds.filter(id => id !== chat!.id);
                              setEditingList({ ...editingList, chatIds: newChatIds });
                            }}
                            className="p-1 text-red-400 hover:bg-red-500/20 rounded"
                          >
                            ✗
                          </button>
                        </div>
                      ))
                  )}
                </div>
              </div>

              {/* Add chats to list */}
              <div className="mb-4">
                <h4 className="text-sm text-white/60 mb-2">Add chats to this list</h4>
                <div className="max-h-[200px] overflow-y-auto space-y-1 bg-black/20 rounded-xl p-2">
                  {chats
                    .filter(chat => !editingList.chatIds.includes(chat.id))
                    .filter(chat => !listSearchQuery || chat.title.toLowerCase().includes(listSearchQuery.toLowerCase()))
                    .map(chat => (
                      <div key={chat.id} className="flex items-center gap-2 p-2 hover:bg-white/5 rounded-lg">
                        <span className="text-sm">{chat.type === 'channel' ? '📢' : '👥'}</span>
                        <span className="text-sm flex-1 truncate">{chat.title}</span>
                        <button
                          onClick={() => {
                            setEditingList({ ...editingList, chatIds: [...editingList.chatIds, chat.id] });
                          }}
                          className="p-1 text-emerald-400 hover:bg-emerald-500/20 rounded"
                        >
                          +
                        </button>
                      </div>
                    ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingList(null);
                    setListSearchQuery('');
                  }}
                  className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    updateList(editingList.id, {
                      name: editingList.name,
                      color: editingList.color,
                      icon: editingList.icon,
                      chatIds: editingList.chatIds,
                    });
                    setEditingList(null);
                    setListSearchQuery('');
                    addLog(`Updated list: ${editingList.name}`, 'success');
                  }}
                  className="flex-1 py-2.5 bg-[#2AABEE] hover:bg-[#3bb5f5] rounded-xl text-sm font-medium transition-colors"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Create/Save Template Modal */}
        {showTemplateManager && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="glass rounded-2xl p-6 max-w-lg w-full">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <span>📝</span> Save as Template
              </h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.target as HTMLFormElement;
                  const name = (form.elements.namedItem('templateName') as HTMLInputElement).value;
                  if (name.trim() && message.trim()) {
                    createTemplate(name.trim(), message);
                    setShowTemplateManager(false);
                  }
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm text-white/60 mb-2">Template Name</label>
                  <input
                    name="templateName"
                    type="text"
                    placeholder="e.g., Weekly Update, Promo Announcement"
                    className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm focus-ring"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-white/60 mb-2">Message Preview</label>
                  <div className="p-3 bg-black/40 border border-white/10 rounded-xl text-sm text-white/60 max-h-[150px] overflow-y-auto whitespace-pre-wrap">
                    {message || 'No message to save'}
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowTemplateManager(false)}
                    className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-sm transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!message.trim()}
                    className="flex-1 py-2.5 bg-purple-500 hover:bg-purple-600 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    Save Template
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit Template Modal */}
        {editingTemplate && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="glass rounded-2xl p-6 max-w-lg w-full">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <span>✏️</span> Edit Template
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-white/60 mb-2">Template Name</label>
                  <input
                    type="text"
                    value={editingTemplate.name}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                    className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm focus-ring"
                  />
                </div>
                <div>
                  <label className="block text-sm text-white/60 mb-2">Message Content</label>
                  <textarea
                    value={editingTemplate.content}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, content: e.target.value })}
                    rows={6}
                    className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl text-sm focus-ring resize-none"
                  />
                </div>
                <div className="text-xs text-white/40">
                  Created: {new Date(editingTemplate.createdAt).toLocaleDateString()}
                  {editingTemplate.lastUsed && (
                    <span className="ml-3">Last used: {new Date(editingTemplate.lastUsed).toLocaleDateString()}</span>
                  )}
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditingTemplate(null)}
                    className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-sm transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      updateTemplate(editingTemplate.id, {
                        name: editingTemplate.name,
                        content: editingTemplate.content,
                      });
                      setEditingTemplate(null);
                      addLog(`Updated template: ${editingTemplate.name}`, 'success');
                    }}
                    className="flex-1 py-2.5 bg-purple-500 hover:bg-purple-600 rounded-xl text-sm font-medium transition-colors"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
