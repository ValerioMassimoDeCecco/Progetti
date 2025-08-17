import React from 'react';
import { render } from 'react-dom';
import { BrowserRouter, Switch, Route, useHistory } from 'react-router-dom';
import Peer from 'peerjs';
import './style-desktop.scss';

// Helper per ID messaggi coerenti tra peer
const generateId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);

// Variabili globali per peer e connessione
let peer: Peer = null;
let connections: Map<string, any> = new Map();

// Tipi di messaggio
interface Message {
  id: number;
  text: string;
  sender: 'me' | 'peer';
  time: string;
  status?: 'sent' | 'delivered' | 'read';
  type?: 'text' | 'file' | 'image' | 'audio' | 'video' | 'location' | 'contact' | 'reply' | 'system';
  fileData?: any;
  replyTo?: Message;
  edited?: boolean;
  editedAt?: string;
  reactions?: Map<string, string[]>;
  deleted?: boolean;
  forwarded?: boolean;
  starred?: boolean;
  location?: { lat: number; lng: number };
  duration?: number; // for audio/video
  thumbnail?: string; // for video
  contactData?: { name: string; phone: string };
}

interface Chat {
  id: string;
  name: string;
  messages: Message[];
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount: number;
  isTyping: boolean;
  isOnline: boolean;
  isRecording: boolean;
  lastSeen?: string;
  connection: any;
  draftMessage?: string;
  pinnedMessages: number[];
  blockedUsers: Set<string>;
  mutedUntil?: Date;
}

// Custom Hooks
const useLocalStorage = (key: string, initialValue: any) => {
  const [storedValue, setStoredValue] = React.useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      return initialValue;
    }
  });
  const setValue = (value: any) => {
    try {
      setStoredValue(value);
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(error);
    }
  };
  return [storedValue, setValue];
};

// Componente per inserire il nome
const NameInput = () => {
  const history = useHistory();
  const [availablePeer, setAvailablePeer] = React.useState(peer);
  const [isLoading, setIsLoading] = React.useState(false);
  const [savedUsername] = useLocalStorage('username', '');

  const submit = React.useCallback((ev) => {
    ev.preventDefault();
    setIsLoading(true);
    const input = ev.currentTarget.elements.namedItem("name") as HTMLInputElement;
    const user = input.value;
    if (user.trim()) {
      const newPeer = new Peer(user, {
        debug: 2,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        }
      });
      newPeer.on('open', () => {
        setAvailablePeer(newPeer);
        setIsLoading(false);
        localStorage.setItem('username', user);
      });
      newPeer.on('error', (err) => {
        console.error('PeerJS error:', err);
        alert(`Errore: ${err.type}. Prova un nome diverso.`);
        setIsLoading(false);
      });
    }
  }, []);

  React.useEffect(() => {
    peer = availablePeer;
    if (availablePeer) {
      history.replace("/desktop");
    }
  }, [availablePeer]);

  return (
    <div className="login-container">
      <div className="login-content">
        <div className="login-left">
          <div className="brand">
            <i className="fas fa-comments"></i>
            <h1>PeerChat Desktop</h1>
          </div>
          <div className="features">
            <div className="feature">
              <i className="fas fa-shield-alt"></i>
              <div>
                <h3>Crittografia End-to-End</h3>
                <p>I tuoi messaggi sono sempre protetti</p>
              </div>
            </div>
            <div className="feature">
              <i className="fas fa-users"></i>
              <div>
                <h3>Chat Multiple</h3>
                <p>Gestisci più conversazioni contemporaneamente</p>
              </div>
            </div>
            <div className="feature">
              <i className="fas fa-bolt"></i>
              <div>
                <h3>Real-time P2P</h3>
                <p>Comunicazione diretta senza server</p>
              </div>
            </div>
          </div>
        </div>
        <div className="login-right">
          <form onSubmit={submit} className="login-form">
            <h2>Benvenuto</h2>
            <p>Inserisci il tuo nome utente per iniziare</p>
            <div className="input-group">
              <i className="fas fa-user"></i>
              <input 
                name="name" 
                placeholder="Nome utente" 
                required 
                autoFocus
                disabled={isLoading}
                defaultValue={savedUsername}
              />
            </div>
            <button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <span className="spinner"></span>
                  Connessione...
                </>
              ) : (
                <>
                  Accedi
                  <i className="fas fa-arrow-right"></i>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

// Componente Desktop principale
const DesktopChat = () => {
  const history = useHistory();
  const [currentPeer] = React.useState(peer);
  const [activeChat, setActiveChat] = React.useState<string | null>(null);
  const [chats, setChats] = React.useState<Map<string, Chat>>(new Map());
  const [searchQuery, setSearchQuery] = React.useState('');
  const [messageSearchQuery, setMessageSearchQuery] = React.useState('');
  const [showUserInfo, setShowUserInfo] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);
  const [theme, setTheme] = useLocalStorage('theme', 'light');
  const [status, setStatus] = React.useState<'online' | 'away' | 'busy'>('online');
  const [selectedMessages, setSelectedMessages] = React.useState<Set<number>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = React.useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = React.useState(false);
  const [replyingTo, setReplyingTo] = React.useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = React.useState<Message | null>(null);
  const [isRecording, setIsRecording] = React.useState(false);
  const [recordingTime, setRecordingTime] = React.useState(0);
  const [mediaRecorder, setMediaRecorder] = React.useState<MediaRecorder | null>(null);

  // Refs per evitare closure stale
  const activeChatRef = React.useRef(activeChat);
  React.useEffect(() => { activeChatRef.current = activeChat; }, [activeChat]);

  const [settings, setSettings] = useLocalStorage('settings', {
    notifications: true,
    sounds: true,
    readReceipts: true,
    enterToSend: true,
    fontSize: 'medium',
    messageGrouping: true,
    autoDownload: {
      images: true,
      videos: false,
      files: false
    }
  }) as any;

  const settingsRef = React.useRef(settings);
  React.useEffect(() => { settingsRef.current = settings; }, [settings]);

  const isRecordingRef = React.useRef(isRecording);
  React.useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  const recordingTimerRef = React.useRef<any>(null);

  const chatsRef = React.useRef(chats);
  React.useEffect(() => { chatsRef.current = chats; }, [chats]);

  const selectedMessagesRef = React.useRef(selectedMessages);
  React.useEffect(() => { selectedMessagesRef.current = selectedMessages; }, [selectedMessages]);

  const isSelectionModeRef = React.useRef(isSelectionMode);
  React.useEffect(() => { isSelectionModeRef.current = isSelectionMode; }, [isSelectionMode]);

  const replyingToRef = React.useRef(replyingTo);
  React.useEffect(() => { replyingToRef.current = replyingTo; }, [replyingTo]);

  const editingMessageRef = React.useRef(editingMessage);
  React.useEffect(() => { editingMessageRef.current = editingMessage; }, [editingMessage]);

  const showEmojiPickerRef = React.useRef(showEmojiPicker);
  React.useEffect(() => { showEmojiPickerRef.current = showEmojiPicker; }, [showEmojiPicker]);

  // EFFECT di setup (PeerJS + scorciatoie). Deps vuote per evitare loop
  React.useEffect(() => {
    if (!currentPeer) {
      history.replace("/");
      return;
    }

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    const connectionHandler = (conn) => {
      conn.on('open', () => {
        const newChat: Chat = {
          id: conn.peer,
          name: conn.peer,
          messages: [],
          unreadCount: 0,
          isTyping: false,
          isRecording: false,
          isOnline: true,
          connection: conn,
          pinnedMessages: [],
          blockedUsers: new Set()
        };
        setChats(prev => {
          const updated = new Map(prev);
          updated.set(conn.peer, newChat);
          return updated;
        });
        connections.set(conn.peer, conn);

        // Handshake
        conn.send({
          type: 'handshake',
          status: 'online',
          version: '1.0.0'
        });

        conn.on('data', (data) => {
          console.log('RX', conn.peer, data);
          handleIncomingData(conn.peer, data);
        });
        conn.on('close', () => handleConnectionClose(conn.peer));
      });

      conn.on('error', (err) => {
        console.error('Connection error:', err);
      });
    };

    currentPeer.on('connection', connectionHandler);

    const handleKeyboard = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch(e.key) {
          case 'k':
            e.preventDefault();
            document.getElementById('search-input')?.focus();
            break;
          case ',':
            e.preventDefault();
            setShowSettings(true);
            break;
          case 'i':
            if (activeChatRef.current) {
              e.preventDefault();
              setShowUserInfo(prev => !prev);
            }
            break;
          case 'f':
            if (activeChatRef.current) {
              e.preventDefault();
              setMessageSearchQuery('');
              document.getElementById('message-search')?.focus();
            }
            break;
          case 'e':
            if (selectedMessagesRef.current.size === 1) {
              e.preventDefault();
              const msgId = Array.from(selectedMessagesRef.current)[0];
              const chat = chatsRef.current.get(activeChatRef.current!);
              const msg = chat?.messages.find(m => m.id === msgId);
              if (msg && msg.sender === 'me' && !msg.deleted) {
                setEditingMessage(msg);
                setSelectedMessages(new Set());
                setIsSelectionMode(false);
              }
            }
            break;
          case 'd':
            if (selectedMessagesRef.current.size > 0) {
              e.preventDefault();
              handleDeleteMessages();
            }
            break;
        }
      }
      if (e.key === 'Escape') {
        if (isSelectionModeRef.current) {
          setIsSelectionMode(false);
          setSelectedMessages(new Set());
        }
        if (replyingToRef.current) setReplyingTo(null);
        if (editingMessageRef.current) setEditingMessage(null);
        if (showEmojiPickerRef.current) setShowEmojiPicker(false);
      }
    };

    window.addEventListener('keydown', handleKeyboard);

    return () => {
      currentPeer.off('connection', connectionHandler);
      window.removeEventListener('keydown', handleKeyboard);
    };
  }, []); // deps vuote

  // Carica bozze SOLO al mount
  React.useEffect(() => {
    const savedDrafts = localStorage.getItem('drafts');
    if (!savedDrafts) return;
    const drafts = JSON.parse(savedDrafts);
    setChats(prev => {
      const updated = new Map(prev);
      Object.keys(drafts).forEach(chatId => {
        const chat = updated.get(chatId);
        if (chat) {
          updated.set(chatId, { ...chat, draftMessage: drafts[chatId] });
        }
      });
      return updated;
    });
  }, []);

  const handleIncomingData = React.useCallback((peerId: string, data: any) => {
    setChats(prev => {
      const updated = new Map(prev);
      let c = updated.get(peerId);
      if (!c) {
        c = {
          id: peerId,
          name: peerId,
          messages: [],
          unreadCount: 0,
          isTyping: false,
          isRecording: false,
          isOnline: true,
          connection: connections.get(peerId),
          pinnedMessages: [],
          blockedUsers: new Set()
        };
        updated.set(peerId, c);
      }

      const nowTime = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

      switch(data.type) {
        case 'handshake': {
          const newChat = { ...c, isOnline: true, lastSeen: undefined };
          updated.set(peerId, newChat);
          break;
        }
        case 'typing': {
          const newChat = { ...c, isTyping: true };
          updated.set(peerId, newChat);
          setTimeout(() => {
            setChats(p => {
              const u = new Map(p);
              const ch = u.get(peerId);
              if (ch) {
                u.set(peerId, { ...ch, isTyping: false });
              }
              return u;
            });
          }, 3000);
          break;
        }
        case 'recording': {
          const newChat = { ...c, isRecording: !!data.isRecording };
          updated.set(peerId, newChat);
          break;
        }
        case 'message': {
          const message: Message = {
            id: typeof data.id === 'number' ? data.id : generateId(),
            text: data.text,
            sender: 'peer',
            time: nowTime,
            status: 'delivered',
            type: data.messageType || 'text',
            fileData: data.fileData,
            replyTo: data.replyTo,
            forwarded: data.forwarded,
            location: data.location,
            duration: data.duration,
            thumbnail: data.thumbnail,
            contactData: data.contactData,
            reactions: new Map()
          };
          const newMessages = [...c.messages, message];
          const newChat = {
            ...c,
            messages: newMessages,
            lastMessage: data.text,
            lastMessageTime: nowTime,
            unreadCount: activeChatRef.current !== peerId ? (c.unreadCount || 0) + 1 : c.unreadCount || 0
          };
          updated.set(peerId, newChat);
          break;
        }
        case 'edit': {
          const newMessages = c.messages.map(m => m.id === data.messageId ? {
            ...m,
            text: data.newText,
            edited: true,
            editedAt: nowTime
          } : m);
          updated.set(peerId, { ...c, messages: newMessages });
          break;
        }
        case 'delete': {
          const toDelete: number[] = data.messageIds || [];
          const newMessages = c.messages.map(m => toDelete.includes(m.id) ? {
            ...m,
            deleted: true,
            text: data.deleteForEveryone ? '🚫 Messaggio eliminato' : m.text
          } : m);
          updated.set(peerId, { ...c, messages: newMessages });
          break;
        }
        case 'reaction': {
          const newMessages = c.messages.map(m => {
            if (m.id !== data.messageId) return m;
            const reactions = m.reactions ? new Map(m.reactions) : new Map<string, string[]>();
            const users = reactions.get(data.emoji) || [];
            if (data.remove) {
              const idx = users.indexOf(peerId);
              if (idx > -1) users.splice(idx, 1);
              if (users.length === 0) {
                reactions.delete(data.emoji);
              } else {
                reactions.set(data.emoji, [...users]);
              }
            } else {
              if (!users.includes(peerId)) {
                reactions.set(data.emoji, [...users, peerId]);
              }
            }
            return { ...m, reactions };
          });
          updated.set(peerId, { ...c, messages: newMessages });
          break;
        }
        case 'receipt': {
          const newMessages = c.messages.map(m => (m.id === data.messageId && m.sender === 'me')
            ? { ...m, status: data.status }
            : m
          );
          updated.set(peerId, { ...c, messages: newMessages });
          break;
        }
        case 'lastSeen': {
          updated.set(peerId, { ...c, lastSeen: data.timestamp });
          break;
        }
        default:
          break;
      }

      return updated;
    });

    // Side effects
    if (data.type === 'message') {
      // Read receipt
      if (settingsRef.current.readReceipts && activeChatRef.current === peerId) {
        connections.get(peerId)?.send({
          type: 'receipt',
          messageId: typeof data.id === 'number' ? data.id : undefined,
          status: 'read'
        });
      }
      // Suono
      if (settingsRef.current.sounds && document.hidden) {
        playNotificationSound();
      }
      // Notifica desktop
      if (settingsRef.current.notifications && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification(`${peerId}`, {
          body: data.text,
          icon: '/icon.png',
          tag: peerId,
          silent: !settingsRef.current.sounds
        });
        notification.onclick = () => {
          window.focus();
          setActiveChat(peerId);
          notification.close();
        };
      }
    }
  }, []);

  const handleConnectionClose = (peerId: string) => {
    setChats(prev => {
      const updated = new Map(prev);
      const chat = updated.get(peerId);
      if (chat) {
        updated.set(peerId, {
          ...chat,
          isOnline: false,
          lastSeen: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
        });
      }
      return updated;
    });
    connections.delete(peerId);
  };

  const connectToPeer = (peerId: string) => {
    if (!peerId.trim() || connections.has(peerId)) return;
    const conn = currentPeer.connect(peerId);
    conn.on('open', () => {
      const newChat: Chat = {
        id: peerId,
        name: peerId,
        messages: [],
        unreadCount: 0,
        isTyping: false,
        isRecording: false,
        isOnline: true,
        connection: conn,
        pinnedMessages: [],
        blockedUsers: new Set()
      };
      setChats(prev => {
        const updated = new Map(prev);
        updated.set(peerId, newChat);
        return updated;
      });
      connections.set(peerId, conn);
      setActiveChat(peerId);
      conn.send({
        type: 'handshake',
        status: status,
        version: '1.0.0'
      });
      conn.on('data', (data) => {
        console.log('RX', peerId, data);
        handleIncomingData(peerId, data);
      });
      conn.on('close', () => handleConnectionClose(peerId));
    });
    conn.on('error', (err) => {
      console.error('Connection error:', err);
      alert(`Impossibile connettersi a ${peerId}`);
    });
  };

  const sendMessage = (text: string, type: string = 'text', additionalData?: any) => {
    if (!activeChat || !text.trim()) return;
    const chat = chats.get(activeChat);
    if (!chat || !chat.connection) return;

    const id = generateId();
    const time = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const message: Message = {
      id,
      text,
      sender: 'me',
      time,
      status: 'sent',
      type: type as any,
      replyTo: replyingTo || undefined,
      ...additionalData,
      reactions: new Map()
    };

    const dataToSend = {
      type: 'message',
      id,
      text,
      messageType: type,
      replyTo: replyingTo,
      ...additionalData
    };

    chat.connection.send(dataToSend);

    setChats(prev => {
      const updated = new Map(prev);
      const c = updated.get(activeChat)!;
      const newMessages = [...c.messages, message];
      updated.set(activeChat, {
        ...c,
        messages: newMessages,
        lastMessage: text,
        lastMessageTime: time,
        draftMessage: ''
      });
      return updated;
    });

    setReplyingTo(null);

    // Aggiorna a delivered dopo un attimo (simulazione)
    setTimeout(() => {
      setChats(prev => {
        const updated = new Map(prev);
        const c = updated.get(activeChat);
        if (c) {
          const newMessages = c.messages.map(m => m.id === id ? { ...m, status: 'delivered' } : m);
          updated.set(activeChat, { ...c, messages: newMessages });
        }
        return updated;
      });
    }, 500);
  };

  const sendTypingIndicator = () => {
    if (!activeChat) return;
    const chat = chats.get(activeChat);
    if (chat?.connection) {
      chat.connection.send({ type: 'typing' });
    }
  };

  const handleFileUpload = (file: File) => {
    if (!activeChat || !file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const fileData = {
        name: file.name,
        size: file.size,
        type: file.type,
        data: e.target?.result
      };
      let messageType = 'file';
      let text = `📎 ${file.name}`;
      if (file.type.startsWith('image/')) {
        messageType = 'image';
        text = '🖼️ Immagine';
      } else if (file.type.startsWith('video/')) {
        messageType = 'video';
        text = '🎥 Video';
        const video = document.createElement('video');
        video.src = URL.createObjectURL(file);
        video.addEventListener('loadeddata', () => {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(video, 0, 0);
          const thumbnail = canvas.toDataURL('image/jpeg');
          sendMessage(text, messageType, { 
            fileData, 
            duration: Math.floor(video.duration),
            thumbnail 
          });
        });
        return;
      } else if (file.type.startsWith('audio/')) {
        messageType = 'audio';
        text = '🎵 Audio';
      }
      sendMessage(text, messageType, { fileData });
    };
    reader.readAsDataURL(file);
  };

  const handleEditMessage = (messageId: number, newText: string) => {
    if (!activeChat) return;
    const chat = chats.get(activeChat);
    if (!chat) return;
    const message = chat.messages.find(m => m.id === messageId);
    if (!message || message.sender !== 'me' || message.deleted) return;

    setChats(prev => {
      const updated = new Map(prev);
      const c = updated.get(activeChat)!;
      const newMessages = c.messages.map(m => m.id === messageId ? {
        ...m,
        text: newText,
        edited: true,
        editedAt: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
      } : m);
      updated.set(activeChat, { ...c, messages: newMessages });
      return updated;
    });

    chat.connection.send({
      type: 'edit',
      messageId,
      newText
    });
    setEditingMessage(null);
  };

  const handleDeleteMessages = (deleteForEveryone: boolean = true) => {
    if (!activeChat || selectedMessages.size === 0) return;
    const chat = chats.get(activeChat);
    if (!chat) return;
    const messageIds = Array.from(selectedMessages);

    setChats(prev => {
      const updated = new Map(prev);
      const c = updated.get(activeChat)!;
      const newMessages = c.messages.map(m => messageIds.includes(m.id) ? {
        ...m,
        deleted: true,
        text: deleteForEveryone ? '🚫 Messaggio eliminato' : m.text
      } : m);
      updated.set(activeChat, { ...c, messages: newMessages });
      return updated;
    });

    if (deleteForEveryone) {
      chat.connection.send({
        type: 'delete',
        messageIds,
        deleteForEveryone
      });
    }
    setSelectedMessages(new Set());
    setIsSelectionMode(false);
  };

  const handleReaction = (messageId: number, emoji: string) => {
    if (!activeChat) return;
    const chat = chats.get(activeChat);
    if (!chat) return;
    const myId = currentPeer.id;

    setChats(prev => {
      const updated = new Map(prev);
      const c = updated.get(activeChat)!;
      const newMessages = c.messages.map(m => {
        if (m.id !== messageId) return m;
        const reactions = m.reactions ? new Map(m.reactions) : new Map<string, string[]>();
        const users = reactions.get(emoji) || [];
        const hasReacted = users.includes(myId);
        if (hasReacted) {
          const idx = users.indexOf(myId);
          if (idx > -1) users.splice(idx, 1);
          if (users.length === 0) {
            reactions.delete(emoji);
          } else {
            reactions.set(emoji, [...users]);
          }
        } else {
          reactions.set(emoji, [...users, myId]);
        }
        return { ...m, reactions };
      });
      updated.set(activeChat, { ...c, messages: newMessages });
      return updated;
    });

    chat.connection.send({
      type: 'reaction',
      messageId,
      emoji,
      remove: false // calcoliamo lato peer se rimuovere/aggiungere
    });
  };

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        chunks.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = (e) => {
          sendMessage('🎤 Messaggio vocale', 'audio', {
            fileData: {
              data: e.target?.result,
              type: 'audio/webm'
            },
            duration: recordingTime
          });
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(track => track.stop());
        setIsRecording(false);
        isRecordingRef.current = false;
        setRecordingTime(0);
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
      };
      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
      isRecordingRef.current = true;

      if (activeChat) {
        const chat = chats.get(activeChat);
        chat?.connection.send({ type: 'recording', isRecording: true });
      }

      const startTime = Date.now();
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = setInterval(() => {
        if (!isRecordingRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
          return;
        }
        setRecordingTime(Math.floor((Date.now() - startTime) / 1000));
      }, 200);
    } catch (err) {
      console.error('Failed to start recording:', err);
      alert('Impossibile accedere al microfono');
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      if (activeChat) {
        const chat = chats.get(activeChat);
        chat?.connection.send({ type: 'recording', isRecording: false });
      }
    }
  };

  const handleCancelRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      setIsRecording(false);
      isRecordingRef.current = false;
      setRecordingTime(0);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      if (activeChat) {
        const chat = chats.get(activeChat);
        chat?.connection.send({ type: 'recording', isRecording: false });
      }
    }
  };

  const handleSendLocation = () => {
    if (!activeChat) return;
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          sendMessage('📍 Posizione condivisa', 'location', { location });
        },
        (error) => {
          console.error('Error getting location:', error);
          alert('Impossibile ottenere la posizione');
        }
      );
    } else {
      alert('Geolocalizzazione non supportata');
    }
  };

  const handleForwardMessage = (message: Message, targetChatId: string) => {
    const targetChat = chats.get(targetChatId);
    if (!targetChat) return;
    const forwardedMessage: Message = {
      ...message,
      forwarded: true,
      sender: 'me',
      id: generateId(),
      time: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    };
    targetChat.connection.send({
      type: 'message',
      id: generateId(),
      text: message.text,
      messageType: message.type,
      forwarded: true,
      fileData: message.fileData,
      location: message.location,
      contactData: message.contactData
    });
    setChats(prev => {
      const updated = new Map(prev);
      const c = updated.get(targetChatId)!;
      updated.set(targetChatId, {
        ...c,
        messages: [...c.messages, forwardedMessage],
        lastMessage: message.text,
        lastMessageTime: forwardedMessage.time
      });
      return updated;
    });
  };

  const playNotificationSound = () => {
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZURE');
    audio.volume = 0.3;
    audio.play().catch(e => console.log('Could not play sound:', e));
  };

  const deleteChat = (chatId: string) => {
    const chat = chats.get(chatId);
    if (chat?.connection) {
      chat.connection.close();
    }
    connections.delete(chatId);
    setChats(prev => {
      const updated = new Map(prev);
      updated.delete(chatId);
      return updated;
    });
    if (activeChat === chatId) {
      setActiveChat(null);
    }
  };

  // Salva bozza quando cambia l'input (niente interval)
  const handleDraftChange = (value: string) => {
    if (!activeChat) return;
    setChats(prev => {
      const updated = new Map(prev);
      const c = updated.get(activeChat);
      if (c) {
        updated.set(activeChat, { ...c, draftMessage: value });
      }
      return updated;
    });
    const drafts = JSON.parse(localStorage.getItem('drafts') || '{}');
    if (value) {
      drafts[activeChat] = value;
    } else {
      delete drafts[activeChat];
    }
    localStorage.setItem('drafts', JSON.stringify(drafts));
  };

  const filteredChats = Array.from(chats.values()).filter(chat =>
    chat.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const activeChatData = activeChat ? chats.get(activeChat) : null;

  const filteredMessages = React.useMemo(() => {
    if (!activeChatData) return [];
    if (!messageSearchQuery) return activeChatData.messages;
    return activeChatData.messages.filter(msg =>
      msg.text.toLowerCase().includes(messageSearchQuery.toLowerCase())
    );
  }, [activeChatData?.messages, messageSearchQuery]);

  return (
    <div className={`desktop-container ${theme}`}>
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="user-profile">
            <div className="avatar">
              <i className="fas fa-user"></i>
              <span className={`status-dot ${status}`}></span>
            </div>
            <div className="user-info">
              <h3>{currentPeer?.id}</h3>
              <select 
                value={status} 
                onChange={(e) => setStatus(e.target.value as any)}
                className="status-select"
              >
                <option value="online">🟢 Online</option>
                <option value="away">🟡 Assente</option>
                <option value="busy">🔴 Occupato</option>
              </select>
            </div>
          </div>
          <div className="sidebar-actions">
            <button onClick={() => setShowSettings(true)} title="Impostazioni (Ctrl+,)">
              <i className="fas fa-cog"></i>
            </button>
            <button onClick={() => {
              if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission();
              }
            }} title="Notifiche">
              <i className="fas fa-bell"></i>
            </button>
          </div>
        </div>
        <div className="search-container">
          <i className="fas fa-search"></i>
          <input
            id="search-input"
            type="text"
            placeholder="Cerca o avvia una nuova chat (Ctrl+K)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && searchQuery.trim()) {
                connectToPeer(searchQuery.trim());
                setSearchQuery('');
              }
            }}
          />
        </div>
        <div className="chat-list">
          {filteredChats.length === 0 ? (
            <div className="empty-state">
              <i className="fas fa-comments"></i>
              <p>Nessuna chat attiva</p>
              <small>Cerca un utente per iniziare</small>
            </div>
          ) : (
            filteredChats
              .sort((a, b) => {
                if (a.pinnedMessages.length > 0 && b.pinnedMessages.length === 0) return -1;
                if (a.pinnedMessages.length === 0 && b.pinnedMessages.length > 0) return 1;
                return (b.lastMessageTime || '').localeCompare(a.lastMessageTime || '');
              })
              .map(chat => (
              <div
                key={chat.id}
                className={`chat-item ${activeChat === chat.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveChat(chat.id);
                  setChats(prev => {
                    const updated = new Map(prev);
                    const c = updated.get(chat.id);
                    if (c) updated.set(chat.id, { ...c, unreadCount: 0 });
                    return updated;
                  });
                }}
              >
                <div className="chat-avatar">
                  <i className="fas fa-user"></i>
                  {chat.isOnline && <span className="online-indicator"></span>}
                </div>
                <div className="chat-info">
                  <div className="chat-header">
                    <h4>
                      {chat.pinnedMessages.length > 0 && <i className="fas fa-thumbtack" style={{marginRight: '4px', fontSize: '12px'}}></i>}
                      {chat.name}
                    </h4>
                    <span className="time">{chat.lastMessageTime}</span>
                  </div>
                  <div className="chat-preview">
                    {chat.isTyping ? (
                      <span className="typing">Sta scrivendo...</span>
                    ) : chat.isRecording ? (
                      <span className="typing">Sta registrando...</span>
                    ) : chat.draftMessage ? (
                      <p><span style={{color: '#ef4444'}}>Bozza:</span> {chat.draftMessage}</p>
                    ) : (
                      <p>{chat.lastMessage || 'Inizia una conversazione'}</p>
                    )}
                    {chat.unreadCount > 0 && (
                      <span className="unread-badge">{chat.unreadCount > 99 ? '99+' : chat.unreadCount}</span>
                    )}
                  </div>
                </div>
                <button
                  className="delete-chat"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Eliminare la chat con ${chat.name}?`)) {
                      deleteChat(chat.id);
                    }
                  }}
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="main-chat">
        {activeChatData ? (
          <>
            <div className="chat-header">
              <div className="chat-header-info">
                <div className="chat-avatar">
                  <i className="fas fa-user"></i>
                  {activeChatData.isOnline && <span className="online-indicator"></span>}
                </div>
                <div>
                  <h2>{activeChatData.name}</h2>
                  <span className="status-text">
                    {activeChatData.isTyping ? 'Sta scrivendo...' : 
                     activeChatData.isRecording ? 'Sta registrando...' :
                     activeChatData.isOnline ? 'Online' : `Visto ${activeChatData.lastSeen || 'recentemente'}`}
                  </span>
                </div>
              </div>
              <div className="chat-header-actions">
                <input
                  id="message-search"
                  type="text"
                  placeholder="Cerca nei messaggi (Ctrl+F)"
                  value={messageSearchQuery}
                  onChange={(e) => setMessageSearchQuery(e.target.value)}
                  style={{
                    display: messageSearchQuery || document.activeElement?.id === 'message-search' ? 'block' : 'none',
                    padding: '8px 12px',
                    borderRadius: '20px',
                    border: '1px solid #e5e7eb',
                    fontSize: '14px',
                    marginRight: '12px'
                  }}
                />
                {isSelectionMode && (
                  <div style={{ display: 'flex', gap: '8px', marginRight: '12px' }}>
                    <button 
                      title="Inoltra"
                      onClick={() => {
                        alert('Funzione inoltra non ancora implementata nella UI');
                      }}
                    >
                      <i className="fas fa-share"></i>
                    </button>
                    <button 
                      title="Elimina (Ctrl+D)"
                      onClick={() => handleDeleteMessages()}
                    >
                      <i className="fas fa-trash"></i>
                    </button>
                    <button 
                      title="Annulla selezione"
                      onClick={() => {
                        setIsSelectionMode(false);
                        setSelectedMessages(new Set());
                      }}
                    >
                      <i className="fas fa-times"></i>
                    </button>
                  </div>
                )}
                <button title="Ricerca (Ctrl+F)">
                  <i className="fas fa-search"></i>
                </button>
                <button title="Chiamata vocale">
                  <i className="fas fa-phone"></i>
                </button>
                <button title="Videochiamata">
                  <i className="fas fa-video"></i>
                </button>
                <button 
                  onClick={() => setShowUserInfo(!showUserInfo)}
                  className={showUserInfo ? 'active' : ''}
                  title="Info utente (Ctrl+I)"
                >
                  <i className="fas fa-info-circle"></i>
                </button>
              </div>
            </div>
            <MessageArea
              messages={filteredMessages}
              onSendMessage={sendMessage}
              onTyping={sendTypingIndicator}
              onFileUpload={handleFileUpload}
              onEditMessage={handleEditMessage}
              onDeleteMessage={handleDeleteMessages}
              onReaction={handleReaction}
              onStartRecording={handleStartRecording}
              onStopRecording={handleStopRecording}
              onCancelRecording={handleCancelRecording}
              onSendLocation={handleSendLocation}
              selectedMessages={selectedMessages}
              setSelectedMessages={setSelectedMessages}
              isSelectionMode={isSelectionMode}
              setIsSelectionMode={setIsSelectionMode}
              replyingTo={replyingTo}
              setReplyingTo={setReplyingTo}
              editingMessage={editingMessage}
              setEditingMessage={setEditingMessage}
              isRecording={isRecording}
              recordingTime={recordingTime}
              currentUserId={currentPeer?.id}
              settings={settings}
              activeChatData={activeChatData}
              onDraftChange={handleDraftChange}
            />
          </>
        ) : (
          <div className="no-chat-selected">
            <div className="empty-chat-state">
              <i className="fas fa-comments"></i>
              <h2>Benvenuto su PeerChat Desktop</h2>
              <p>Seleziona una chat dalla sidebar o cerca un utente per iniziare</p>
              <div className="shortcuts">
                <h3>Scorciatoie da tastiera</h3>
                <div className="shortcut">
                  <kbd>Ctrl</kbd> + <kbd>K</kbd>
                  <span>Cerca utente</span>
                </div>
                <div className="shortcut">
                  <kbd>Ctrl</kbd> + <kbd>F</kbd>
                  <span>Cerca nei messaggi</span>
                </div>
                <div className="shortcut">
                  <kbd>Ctrl</kbd> + <kbd>,</kbd>
                  <span>Impostazioni</span>
                </div>
                <div className="shortcut">
                  <kbd>Ctrl</kbd> + <kbd>I</kbd>
                  <span>Info chat</span>
                </div>
                <div className="shortcut">
                  <kbd>Ctrl</kbd> + <kbd>E</kbd>
                  <span>Modifica messaggio</span>
                </div>
                <div className="shortcut">
                  <kbd>Ctrl</kbd> + <kbd>D</kbd>
                  <span>Elimina messaggi</span>
                </div>
                <div className="shortcut">
                  <kbd>Esc</kbd>
                  <span>Annulla azione</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right Panel - User Info */}
      {showUserInfo && activeChatData && (
        <div className="right-panel">
          <div className="panel-header">
            <h3>Informazioni</h3>
            <button onClick={() => setShowUserInfo(false)}>
              <i className="fas fa-times"></i>
            </button>
          </div>
          <div className="panel-content">
            <div className="user-detail">
              <div className="large-avatar">
                <i className="fas fa-user"></i>
              </div>
              <h2>{activeChatData.name}</h2>
              <span className={`status ${activeChatData.isOnline ? 'online' : 'offline'}`}>
                {activeChatData.isOnline ? '🟢 Online' : `⚫ Visto ${activeChatData.lastSeen || 'recentemente'}`}
              </span>
            </div>
            <div className="info-section">
              <h4>Statistiche Chat</h4>
              <div className="stat">
                <span>Messaggi totali</span>
                <strong>{activeChatData.messages.length}</strong>
              </div>
              <div className="stat">
                <span>Messaggi con stella</span>
                <strong>{activeChatData.messages.filter(m => m.starred).length}</strong>
              </div>
              <div className="stat">
                <span>File condivisi</span>
                <strong>{activeChatData.messages.filter(m => ['file', 'image', 'video', 'audio'].includes(m.type || '')).length}</strong>
              </div>
              <div className="stat">
                <span>Primo messaggio</span>
                <strong>{activeChatData.messages[0]?.time || '-'}</strong>
              </div>
            </div>
            <div className="info-section">
              <h4>Media condivisi</h4>
              <div className="media-grid">
                {activeChatData.messages
                  .filter(m => ['file', 'image', 'video'].includes(m.type || ''))
                  .slice(-6)
                  .map(m => (
                    <div key={m.id} className="media-item" title={m.text}>
                      <i className={`fas fa-${m.type === 'image' ? 'image' : m.type === 'video' ? 'video' : 'file'}`}></i>
                    </div>
                  ))}
              </div>
            </div>
            <div className="panel-actions">
              <button onClick={() => {
                const starred = activeChatData.messages.filter(m => m.starred);
                if (starred.length > 0) {
                  alert(`${starred.length} messaggi con stella`);
                } else {
                  alert('Nessun messaggio con stella');
                }
              }}>
                <i className="fas fa-star"></i>
                Messaggi con stella
              </button>
              <button onClick={() => {
                if (confirm(`Vuoi ${activeChatData.mutedUntil ? 'riattivare' : 'silenziare'} le notifiche per questa chat?`)) {
                  setChats(prev => {
                    const updated = new Map(prev);
                    const chat = updated.get(activeChatData.id);
                    if (chat) {
                      updated.set(activeChatData.id, {
                        ...chat,
                        mutedUntil: chat.mutedUntil ? undefined : new Date(Date.now() + 24 * 60 * 60 * 1000)
                      });
                    }
                    return updated;
                  });
                }
              }}>
                <i className={`fas fa-bell${activeChatData.mutedUntil ? '-slash' : ''}`}></i>
                {activeChatData.mutedUntil ? 'Riattiva notifiche' : 'Silenzia notifiche'}
              </button>
              <button className="danger" onClick={() => {
                if (confirm(`Eliminare la chat con ${activeChatData.name}?`)) {
                  deleteChat(activeChatData.id);
                  setShowUserInfo(false);
                }
              }}>
                <i className="fas fa-trash"></i>
                Elimina Chat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Impostazioni</h2>
              <button onClick={() => setShowSettings(false)}>
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="modal-content">
              <div className="setting-group">
                <h3>Aspetto</h3>
                <div className="setting">
                  <label>Tema</label>
                  <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                    <option value="light">Chiaro</option>
                    <option value="dark">Scuro</option>
                  </select>
                </div>
                <div className="setting">
                  <label>Dimensione font</label>
                  <select value={settings.fontSize} onChange={(e) => setSettings({...settings, fontSize: e.target.value})}>
                    <option value="small">Piccolo</option>
                    <option value="medium">Medio</option>
                    <option value="large">Grande</option>
                  </select>
                </div>
              </div>
              <div className="setting-group">
                <h3>Notifiche</h3>
                <div className="setting">
                  <label>
                    <input 
                      type="checkbox" 
                      checked={settings.notifications}
                      onChange={(e) => setSettings({...settings, notifications: e.target.checked})}
                    />
                    Notifiche desktop
                  </label>
                </div>
                <div className="setting">
                  <label>
                    <input 
                      type="checkbox" 
                      checked={settings.sounds}
                      onChange={(e) => setSettings({...settings, sounds: e.target.checked})}
                    />
                    Suoni
                  </label>
                </div>
              </div>
              <div className="setting-group">
                <h3>Privacy</h3>
                <div className="setting">
                  <label>
                    <input 
                      type="checkbox" 
                      checked={settings.readReceipts}
                      onChange={(e) => setSettings({...settings, readReceipts: e.target.checked})}
                    />
                    Conferma di lettura
                  </label>
                </div>
              </div>
              <div className="setting-group">
                <h3>Chat</h3>
                <div className="setting">
                  <label>
                    <input 
                      type="checkbox" 
                      checked={settings.enterToSend}
                      onChange={(e) => setSettings({...settings, enterToSend: e.target.checked})}
                    />
                    Invio con Enter
                  </label>
                </div>
                <div className="setting">
                  <label>
                    <input 
                      type="checkbox" 
                      checked={settings.messageGrouping}
                      onChange={(e) => setSettings({...settings, messageGrouping: e.target.checked})}
                    />
                    Raggruppa messaggi
                  </label>
                </div>
              </div>
              <div className="setting-group">
                <h3>Download automatico</h3>
                <div className="setting">
                  <label>
                    <input 
                      type="checkbox" 
                      checked={settings.autoDownload.images}
                      onChange={(e) => setSettings({...settings, autoDownload: {...settings.autoDownload, images: e.target.checked}})}
                    />
                    Immagini
                  </label>
                </div>
                <div className="setting">
                  <label>
                    <input 
                      type="checkbox" 
                      checked={settings.autoDownload.videos}
                      onChange={(e) => setSettings({...settings, autoDownload: {...settings.autoDownload, videos: e.target.checked}})}
                    />
                    Video
                  </label>
                </div>
                <div className="setting">
                  <label>
                    <input 
                      type="checkbox" 
                      checked={settings.autoDownload.files}
                      onChange={(e) => setSettings({...settings, autoDownload: {...settings.autoDownload, files: e.target.checked}})}
                    />
                    File
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Componente Area Messaggi avanzata
const MessageArea = ({ 
  messages, 
  onSendMessage, 
  onTyping, 
  onFileUpload,
  onEditMessage,
  onDeleteMessage,
  onReaction,
  onStartRecording,
  onStopRecording,
  onCancelRecording,
  onSendLocation,
  selectedMessages,
  setSelectedMessages,
  isSelectionMode,
  setIsSelectionMode,
  replyingTo,
  setReplyingTo,
  editingMessage,
  setEditingMessage,
  isRecording,
  recordingTime,
  currentUserId,
  settings,
  activeChatData,
  onDraftChange
}: any) => {
  const [messageText, setMessageText] = React.useState('');
  const [showEmoji, setShowEmoji] = React.useState(false);
  const [showAttachMenu, setShowAttachMenu] = React.useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const messageInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  React.useEffect(() => {
    if (editingMessage) {
      setMessageText(editingMessage.text);
      messageInputRef.current?.focus();
    }
  }, [editingMessage]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (messageText.trim()) {
      if (editingMessage) {
        onEditMessage(editingMessage.id, messageText);
        setMessageText('');
      } else {
        onSendMessage(messageText);
        setMessageText('');
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (settings.enterToSend && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      onFileUpload(files[0]);
    }
  };

  const handleMessageClick = (e: React.MouseEvent, message: Message) => {
    if (e.detail === 2) { // Double click
      setReplyingTo(message);
    } else if (e.ctrlKey || e.metaKey || isSelectionMode) {
      e.preventDefault();
      const newSelected = new Set(selectedMessages);
      if (newSelected.has(message.id)) {
        newSelected.delete(message.id);
      } else {
        newSelected.add(message.id);
      }
      setSelectedMessages(newSelected);
      setIsSelectionMode(newSelected.size > 0);
    }
  };

  const handleMessageRightClick = (e: React.MouseEvent, message: Message) => {
    e.preventDefault();
    // TODO: context menu
  };

  const quickEmojis = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
  const allEmojis = ['😀', '😂', '🥰', '😎', '🤔', '😴', '🤗', '🙄', '😤', '🤯', '🥳', '😭', '❤️', '💔', '💯', '👍', '👎', '👏', '🙏', '💪', '🎉', '🔥', '✨', '⭐'];

  const formatRecordingTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <>
      <div 
        className="messages-container"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        style={{ fontSize: settings.fontSize === 'small' ? '14px' : settings.fontSize === 'large' ? '18px' : '16px' }}
      >
        <div className="messages-wrapper">
          {messages.length === 0 ? (
            <div className="no-messages">
              <i className="fas fa-lock"></i>
              <h3>I messaggi sono crittografati end-to-end</h3>
              <p>Inizia a scrivere per avviare la conversazione</p>
            </div>
          ) : (
            messages.map((msg, index) => {
              const showAvatar = !settings.messageGrouping || 
                index === 0 || 
                messages[index - 1].sender !== msg.sender ||
                parseInt(msg.time.split(':')[1]) - parseInt(messages[index - 1].time.split(':')[1]) > 1;
              return (
                <div 
                  key={msg.id} 
                  className={`message ${msg.sender} ${selectedMessages.has(msg.id) ? 'selected' : ''} ${msg.forwarded ? 'forwarded' : ''}`}
                  onClick={(e) => handleMessageClick(e, msg)}
                  onContextMenu={(e) => handleMessageRightClick(e, msg)}
                  style={{
                    marginTop: showAvatar ? '16px' : '2px',
                    opacity: msg.deleted ? 0.5 : 1
                  }}
                >
                  <div className="message-bubble">
                    {msg.replyTo && (
                      <div className="reply-preview" style={{
                        padding: '8px',
                        margin: '-8px -8px 8px -8px',
                        background: 'rgba(0,0,0,0.05)',
                        borderRadius: '8px 8px 0 0',
                        fontSize: '13px',
                        opacity: 0.8
                      }}>
                        <strong>{msg.replyTo.sender === 'me' ? 'Tu' : activeChatData?.name}:</strong> {msg.replyTo.text.substring(0, 50)}...
                      </div>
                    )}
                    {msg.forwarded && (
                      <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '4px' }}>
                        <i className="fas fa-share" style={{ marginRight: '4px' }}></i> Inoltrato
                      </div>
                    )}
                    {msg.type === 'image' && msg.fileData && (
                      <img 
                        src={msg.fileData.data} 
                        alt={msg.text}
                        style={{ maxWidth: '300px', borderRadius: '8px', marginBottom: '8px' }}
                      />
                    )}
                    {msg.type === 'video' && msg.thumbnail && (
                      <div style={{ position: 'relative', maxWidth: '300px', marginBottom: '8px' }}>
                        <img src={msg.thumbnail} alt={msg.text} style={{ width: '100%', borderRadius: '8px' }} />
                        <div style={{
                          position: 'absolute',
                          top: '50%',
                          left: '50%',
                          transform: 'translate(-50%, -50%)',
                          background: 'rgba(0,0,0,0.7)',
                          borderRadius: '50%',
                          width: '48px',
                          height: '48px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'white',
                          cursor: 'pointer'
                        }}>
                          <i className="fas fa-play"></i>
                        </div>
                        {msg.duration && (
                          <span style={{
                            position: 'absolute',
                            bottom: '8px',
                            right: '8px',
                            background: 'rgba(0,0,0,0.7)',
                            color: 'white',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '12px'
                          }}>
                            {Math.floor(msg.duration / 60)}:{(msg.duration % 60).toString().padStart(2, '0')}
                          </span>
                        )}
                      </div>
                    )}
                    {msg.type === 'audio' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                        <button style={{
                          background: 'none',
                          border: 'none',
                          color: 'inherit',
                          fontSize: '20px',
                          cursor: 'pointer'
                        }}>
                          <i className="fas fa-play"></i>
                        </button>
                        <div style={{
                          flex: 1,
                          height: '32px',
                          background: 'rgba(0,0,0,0.1)',
                          borderRadius: '16px',
                          position: 'relative'
                        }}>
                          <div style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            height: '100%',
                            width: '30%',
                            background: msg.sender === 'me' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)',
                            borderRadius: '16px'
                          }}></div>
                        </div>
                        {msg.duration && (
                          <span style={{ fontSize: '13px', opacity: 0.8 }}>
                            {Math.floor(msg.duration)}s
                          </span>
                        )}
                      </div>
                    )}
                    {msg.type === 'location' && msg.location && (
                      <div style={{
                        width: '200px',
                        height: '150px',
                        background: '#e5e7eb',
                        borderRadius: '8px',
                        marginBottom: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer'
                      }}
                      onClick={() => window.open(`https://maps.google.com/?q=${msg.location?.lat},${msg.location?.lng}`, '_blank')}
                      >
                        <i className="fas fa-map-marked-alt" style={{ fontSize: '48px', opacity: 0.5 }}></i>
                      </div>
                    )}
                    {msg.type === 'file' && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '8px',
                        background: 'rgba(0,0,0,0.05)',
                        borderRadius: '8px',
                        marginBottom: '8px',
                        cursor: 'pointer'
                      }}>
                        <i className="fas fa-file" style={{ fontSize: '24px' }}></i>
                        <div>
                          <div style={{ fontWeight: 500 }}>{msg.fileData?.name || 'File'}</div>
                          {msg.fileData?.size && (
                            <div style={{ fontSize: '12px', opacity: 0.7 }}>
                              {(msg.fileData.size / 1024).toFixed(1)} KB
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {!msg.deleted ? (
                      <p>{msg.text}</p>
                    ) : (
                      <p style={{ fontStyle: 'italic' }}>{msg.text}</p>
                    )}
                    <div className="message-info">
                      <span className="time">
                        {msg.starred && <i className="fas fa-star" style={{ marginRight: '4px', color: '#f59e0b' }}></i>}
                        {msg.time}
                        {msg.edited && ' (modificato)'}
                      </span>
                      {msg.sender === 'me' && (
                        <span className="status">
                          {msg.status === 'read' ? '✓✓' : 
                           msg.status === 'delivered' ? '✓✓' : '✓'}
                        </span>
                      )}
                    </div>
                    {msg.reactions && msg.reactions.size > 0 && (
                      <div style={{
                        display: 'flex',
                        gap: '4px',
                        marginTop: '8px',
                        flexWrap: 'wrap'
                      }}>
                        {Array.from(msg.reactions.entries()).map(([emoji, users]) => (
                          <button
                            key={emoji}
                            onClick={(e) => {
                              e.stopPropagation();
                              onReaction(msg.id, emoji);
                            }}
                            style={{
                              background: users.includes(currentUserId) ? 'rgba(59,130,246,0.2)' : 'rgba(0,0,0,0.05)',
                              border: users.includes(currentUserId) ? '1px solid rgba(59,130,246,0.5)' : '1px solid transparent',
                              borderRadius: '12px',
                              padding: '2px 8px',
                              fontSize: '14px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            <span>{emoji}</span>
                            {users.length > 1 && <span style={{ fontSize: '12px' }}>{users.length}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    {!msg.deleted && (
                      <div className="quick-reactions" style={{
                        position: 'absolute',
                        bottom: '-28px',
                        right: msg.sender === 'me' ? '0' : 'auto',
                        left: msg.sender === 'peer' ? '0' : 'auto',
                        background: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '20px',
                        padding: '4px',
                        display: 'none',
                        gap: '2px',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                      }}>
                        {quickEmojis.map(emoji => (
                          <button
                            key={emoji}
                            onClick={(e) => {
                              e.stopPropagation();
                              onReaction(msg.id, emoji);
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              padding: '4px',
                              cursor: 'pointer',
                              fontSize: '16px',
                              borderRadius: '50%',
                              width: '28px',
                              height: '28px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f4f6')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Reply preview */}
      {replyingTo && (
        <div style={{
          padding: '12px 24px',
          background: '#f3f4f6',
          borderTop: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
              Rispondi a {replyingTo.sender === 'me' ? 'te stesso' : activeChatData?.name}
            </div>
            <div style={{ fontSize: '14px' }}>{replyingTo.text}</div>
          </div>
          <button
            onClick={() => setReplyingTo(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#6b7280',
              cursor: 'pointer',
              padding: '4px'
            }}
          >
            <i className="fas fa-times"></i>
          </button>
        </div>
      )}

      {/* Edit preview */}
      {editingMessage && (
        <div style={{
          padding: '12px 24px',
          background: '#fef3c7',
          borderTop: '1px solid #fde68a',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <div style={{ fontSize: '12px', color: '#92400e', marginBottom: '4px' }}>
              <i className="fas fa-edit" style={{ marginRight: '4px' }}></i>
              Modifica messaggio
            </div>
            <div style={{ fontSize: '14px' }}>{editingMessage.text}</div>
          </div>
          <button
            onClick={() => {
              setEditingMessage(null);
              setMessageText('');
            }}
            style={{
              background: 'none',
              border: 'none',
              color: '#92400e',
              cursor: 'pointer',
              padding: '4px'
            }}
          >
            <i className="fas fa-times"></i>
          </button>
        </div>
      )}

      <div className="message-input-container">
        {isRecording ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '16px 24px',
            background: '#fee2e2'
          }}>
            <button
              onClick={onCancelRecording}
              style={{
                background: '#ef4444',
                color: 'white',
                border: 'none',
                borderRadius: '50%',
                width: '40px',
                height: '40px',
                cursor: 'pointer'
              }}
            >
              <i className="fas fa-trash"></i>
            </button>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '8px',
                height: '8px',
                background: '#ef4444',
                borderRadius: '50%',
                animation: 'pulse 1s infinite'
              }}></div>
              <span style={{ color: '#991b1b', fontWeight: 500 }}>
                Registrazione... {formatRecordingTime(recordingTime)}
              </span>
              <div style={{
                flex: 1,
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                gap: '2px'
              }}>
                {[...Array(20)].map((_, i) => (
                  <div
                    key={i}
                    style={{
                      width: '3px',
                      height: `${Math.random() * 24 + 8}px`,
                      background: '#ef4444',
                      borderRadius: '2px',
                      animation: 'pulse 0.5s infinite',
                      animationDelay: `${i * 0.05}s`
                    }}
                  />
                ))}
              </div>
            </div>
            <button
              onClick={onStopRecording}
              style={{
                background: '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '50%',
                width: '40px',
                height: '40px',
                cursor: 'pointer'
              }}
            >
              <i className="fas fa-check"></i>
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="message-form">
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  onFileUpload(e.target.files[0]);
                }
              }}
              multiple
            />
            {/* Attach menu */}
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="attach-btn"
                onClick={() => setShowAttachMenu(!showAttachMenu)}
                title="Allega"
              >
                <i className={`fas fa-${showAttachMenu ? 'times' : 'plus'}`} style={{
                  transform: showAttachMenu ? 'rotate(45deg)' : 'rotate(0)',
                  transition: 'transform 0.2s'
                }}></i>
              </button>
              {showAttachMenu && (
                <div style={{
                  position: 'absolute',
                  bottom: '50px',
                  left: 0,
                  background: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '12px',
                  padding: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  minWidth: '200px'
                }}>
                  <button
                    type="button"
                    onClick={() => {
                      fileInputRef.current?.click();
                      setShowAttachMenu(false);
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: '8px 12px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f4f6')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <i className="fas fa-file" style={{ width: '20px' }}></i>
                    Documento
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = 'image/*';
                      input.onchange = (e: any) => {
                        if (e.target.files?.[0]) {
                          onFileUpload(e.target.files[0]);
                        }
                      };
                      input.click();
                      setShowAttachMenu(false);
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: '8px 12px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f4f6')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <i className="fas fa-image" style={{ width: '20px' }}></i>
                    Foto e video
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSendLocation();
                      setShowAttachMenu(false);
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: '8px 12px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f4f6')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <i className="fas fa-map-marker-alt" style={{ width: '20px' }}></i>
                    Posizione
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const name = prompt('Nome del contatto:');
                      const phone = prompt('Numero di telefono:');
                      if (name && phone) {
                        onSendMessage(`👤 ${name}\n📞 ${phone}`, 'contact', { contactData: { name, phone } });
                      }
                      setShowAttachMenu(false);
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: '8px 12px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f4f6')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <i className="fas fa-address-book" style={{ width: '20px' }}></i>
                    Contatto
                  </button>
                </div>
              )}
            </div>
            {/* Emoji picker */}
            <div className="emoji-picker-container">
              <button
                type="button"
                className="emoji-btn"
                onClick={() => setShowEmoji(!showEmoji)}
                title="Emoji"
              >
                <i className="far fa-smile"></i>
              </button>
              {showEmoji && (
                <div className="emoji-picker" style={{
                  position: 'absolute',
                  bottom: '50px',
                  left: '0',
                  background: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '12px',
                  padding: '12px',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(8, 1fr)',
                  gap: '4px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  maxWidth: '320px'
                }}>
                  {allEmojis.map(emoji => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        setMessageText(prev => prev + emoji);
                        setShowEmoji(false);
                        messageInputRef.current?.focus();
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        fontSize: '20px',
                        cursor: 'pointer',
                        padding: '4px',
                        borderRadius: '4px'
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f4f6')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input
              ref={messageInputRef}
              type="text"
              value={messageText}
              onChange={(e) => {
                const val = e.target.value;
                setMessageText(val);
                onDraftChange(val); // salva bozza nel parent + localStorage
              }}
              onInput={() => onTyping()}
              onKeyDown={handleKeyDown}
              placeholder={editingMessage ? 'Modifica messaggio...' : replyingTo ? 'Rispondi...' : 'Scrivi un messaggio...'}
              className="message-input"
            />
            {messageText.trim() ? (
              <button 
                type="submit" 
                className="send-btn"
              >
                <i className="fas fa-paper-plane"></i>
              </button>
            ) : (
              <button
                type="button"
                className="send-btn"
                onMouseDown={onStartRecording}
                onMouseUp={onStopRecording}
                onMouseLeave={onCancelRecording}
                title="Tieni premuto per registrare"
              >
                <i className="fas fa-microphone"></i>
              </button>
            )}
          </form>
        )}
      </div>
    </>
  );
};

// App principale
const App = () => {
  return (
    <BrowserRouter>
      <Switch>
        <Route exact path="/" component={NameInput} />
        <Route exact path="/desktop" component={DesktopChat} />
      </Switch>
    </BrowserRouter>
  );
};

render(<App />, document.querySelector("#app"));