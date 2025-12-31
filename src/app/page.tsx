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

  const logsEndRef = useRef<HTMLDivElement>(null);

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
    const savedToken = localStorage.getItem('tg_bot_token');
    const savedChats = localStorage.getItem('tg_bot_chats');
    
    if (savedToken) {
      setBotToken(savedToken);
    }
    if (savedChats) {
      try {
        setChats(JSON.parse(savedChats));
      } catch {}
    }
  }, []);

  // Save chats whenever they change
  useEffect(() => {
    if (chats.length > 0) {
      localStorage.setItem('tg_bot_chats', JSON.stringify(chats));
    }
  }, [chats]);

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
    
    setIsLoading(true);
    setError('');
    
    try {
      const me = await callBotApi('getMe');
      setBotInfo(me);
      localStorage.setItem('tg_bot_token', botToken);
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
          // Bot was added to a chat
          chat = update.my_chat_member.chat;
          source = 'bot_added';
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

      const discovered = Array.from(chatMap.values());

      // Prioritize /register commands at the top
      discovered.sort((a, b) => {
        if (a.source === 'register_command' && b.source !== 'register_command') return -1;
        if (b.source === 'register_command' && a.source !== 'register_command') return 1;
        return 0;
      });

      setDiscoveredChats(discovered);

      const registerCount = discovered.filter(c => c.source === 'register_command').length;
      if (discovered.length > 0) {
        addLog(`Found ${discovered.length} new chat(s)${registerCount > 0 ? ` (${registerCount} via /register)` : ''}`, 'success');
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
    } finally {
      setIsLoading(false);
    }
  };

  const addAllDiscoveredChats = async () => {
    for (const chat of discoveredChats) {
      await addDiscoveredChat(chat);
    }
  };

  const disconnect = () => {
    localStorage.removeItem('tg_bot_token');
    setBotToken('');
    setBotInfo(null);
    setStep('setup');
    addLog('Disconnected', 'info');
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
                            className={`p-4 flex items-center gap-4 transition-colors ${
                              selectedChats.has(chat.id) ? 'bg-[#2AABEE]/10' : 'hover:bg-white/[0.02]'
                            }`}
                          >
                            <button
                              onClick={() => toggleChat(chat.id)}
                              className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl transition-colors ${
                                selectedChats.has(chat.id) ? 'bg-[#2AABEE]' : 'bg-white/5'
                              }`}
                            >
                              {chat.type === 'channel' ? '📢' : chat.type === 'private' ? '👤' : '👥'}
                            </button>
                            
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{chat.title}</p>
                              <p className="text-xs text-white/40">
                                {chat.type} • ID: {chat.id}
                                {chat.memberCount && ` • ${chat.memberCount.toLocaleString()} members`}
                              </p>
                            </div>
                            
                            <div className="flex items-center gap-2">
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
      </div>
    </div>
  );
}
