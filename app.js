// Data Store
let chats = [];
let friends = [];
let appointments = [];
let otherUsers = []; // Will be used for search results

// Supabase Configuration (Placeholder)
const SUPABASE_URL = 'https://nmtkxlpcwefplwujmriz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tdGt4bHBjd2VmcGx3dWptcml6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4ODMwMDksImV4cCI6MjA4MzQ1OTAwOX0.J2t1I3YB48UVMIL3Sb-E1EE0p85Jb1H5hBztIY2zHlI';
let supabaseClient = null;
try {
    if (typeof supabase !== 'undefined') {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    } else {
        console.warn('Supabase JS library not loaded.');
    }
} catch (e) {
    console.error('Failed to initialize Supabase:', e);
}

// State
let currentUser = null; // { id: uuid, role: ... }
let currentChatId = null;
let isRegisterMode = false;
let isOtpMode = false;
let currentSubscription = null; // Store realtime channel
let settings = {
    privacy: false,
    screenshot: false,
    autodelete: false,
    idsearch: true
};

// --- Data Fetching Functions ---

async function fetchProfile() {
    if (!supabaseClient || !currentUser) return;

    // Skip fetching from Supabase if this is a Mock User
    if (currentUser.isMock) {
        console.log('Skipping fetchProfile for Mock User.');
        return;
    }

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (user) {
        currentUser.id = user.id;
        // Fetch public profile
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        if (data) {
            currentUser.name = data.full_name || 'Me';
            currentUser.avatar = data.avatar_url;
            currentUser.status = data.status_message;
            updateMyProfileUI();
        }
    }
}
// ...
// ...
window.mockLogin = async function (role) {
    console.log('Starting Login Process for:', role);

    // Set minimal user state initially
    currentUser = {
        id: 'mock-user-id-' + role, // Assign dummy ID for logic
        role: role,
        name: role === 'admin' ? 'Admin' : 'Me',
        isMock: true // Flag to prevent onAuthStateChange overwrite
    };

    // --- 1. Immediate UI Transition (Optimistic) ---
    // Hide Login
    loginView.classList.remove('active');

    if (role === 'admin') {
        // Show Admin
        adminView.classList.add('active');
    } else {
        // Show Home (Default App Flow)
        chatListView.classList.add('active');

        // Update Bottom Nav
        navItems.forEach(n => {
            if (n.dataset.target === 'chat-list-view') n.classList.add('active');
            else n.classList.remove('active');
        });
    }

    // --- 2. Background Data Fetching ---
    // If connected to Supabase AND NOT Mock, fetch real data
    // For Mock, maybe load dummy data?
    if (supabaseClient) {
        // fetchDataInBackground handles the isMock check inside fetchProfile now
        fetchDataInBackground();
    } else {
        console.warn('Supabase Client not available. Running in offline mode.');
    }
};

async function fetchFriends() {
    if (!supabaseClient || !currentUser) return;

    // Fetch friends where I am user_id
    const { data, error } = await supabaseClient
        .from('friends')
        .select(`
            friend_id,
            friend:friend_id (
                id,
                full_name,
                avatar_url,
                status_message,
                user_id_search
            )
        `)
        .eq('user_id', currentUser.id);

    if (error) {
        console.error('Error fetching friends:', error);
        return;
    }

    // Map to App Format
    friends = data.map(item => ({
        id: item.friend.id,
        userId: item.friend.user_id_search,
        name: item.friend.full_name,
        avatar: item.friend.avatar_url,
        status: item.friend.status_message
    }));

    renderFriendList();
}

async function fetchChats() {
    if (!supabaseClient || !currentUser) return;

    // Get Chat IDs I belong to
    const { data: myChats, error } = await supabaseClient
        .from('chat_members')
        .select(`
            chat_id,
            chat:chat_id (
                id,
                name,
                is_group,
                created_at
            )
        `)
        .eq('user_id', currentUser.id);

    if (error) {
        console.error('Fetch chats error:', error);
        return;
    }

    // Transform and fetch last messages (simplified)
    // Real app would join messages or fetch latest
    const loadedChats = await Promise.all(myChats.map(async (item) => {
        const chat = item.chat;
        // Mock last message for now or fetch real one
        // Ideally: select * from messages where chat_id=... order by created_at desc limit 1

        return {
            id: chat.id,
            name: chat.name || 'Chat', // If null, maybe use friend name?
            avatar: 'https://i.pravatar.cc/150?u=' + chat.id,
            lastMessage: '...',
            time: '',
            unread: 0,
            messages: [] // Will fetch on open
        };
    }));

    chats = loadedChats;
    renderChatList();
}

function updateMyProfileUI() {
    const nameData = document.querySelector('.my-profile .profile-name');
    const statusData = document.querySelector('.my-profile .profile-status');
    const avatarData = document.querySelector('.my-profile .avatar-large');

    if (nameData) nameData.textContent = currentUser.name;
    if (statusData) statusData.textContent = currentUser.status || '';
    if (avatarData && currentUser.avatar) {
        avatarData.style.backgroundImage = `url('${currentUser.avatar}')`;
    }
}

// DOM Elements (Initialized in loadDOMElements)
let chatListContainer = null;
let friendListContainer = null;
let scheduleListContainer = null;
let friendCountSpan = null;
let loginView = null;
let adminView = null;
let chatListView = null;
let homeView = null;
let scheduleView = null;
let chatRoomView = null;
let navItems = null;

// Auth Elements
let authForm = null;
let authTitle = null;
let authSubmitBtn = null;
let regNameInput = null;
let authEmailInput = null;
let authPassInput = null;
let authOtpInput = null;
let otpGroup = null;
let authToggleBtn = null;
let authToggleText = null;

// Chat Room Elements
let chatTitle = null;
let messagesContainer = null;
let messageInput = null;
let sendBtn = null;
let backBtn = null;
let addEventBtn = null;

// Modals & Search
let reminderModal = null;
let reminderForm = null;
let closeModalBtn = null;
let searchModal = null;
let addFriendBtn = null;
let closeSearchBtn = null;
let searchSubmitBtn = null;
let idInput = null;
let searchResultContainer = null;

// DOM Loader
function loadDOMElements() {
    console.log('Loading DOM Elements...');

    // Helper to get and check
    const get = (id, required = true) => {
        const el = document.getElementById(id);
        if (!el && required) {
            console.error(`Missing required DOM element: #${id}`);
            throw new Error(`Missing DOM element: #${id}`);
        }
        return el;
    };

    chatListContainer = get('chat-list');
    friendListContainer = get('friend-list');
    scheduleListContainer = get('schedule-list');
    friendCountSpan = get('friend-count');
    loginView = get('login-view');
    adminView = get('admin-view');
    chatListView = get('chat-list-view');
    homeView = get('home-view');
    scheduleView = get('schedule-view');
    chatRoomView = get('chat-room-view');
    navItems = document.querySelectorAll('.nav-item');

    authForm = get('auth-form');
    authTitle = get('auth-title');
    authSubmitBtn = get('auth-submit-btn');
    regNameInput = get('reg-name');
    authEmailInput = get('auth-email');
    authPassInput = get('auth-password');
    authOtpInput = get('auth-otp');
    otpGroup = get('otp-group');
    authToggleBtn = get('auth-toggle-btn');
    authToggleText = get('auth-toggle-text');

    chatTitle = get('chat-title');
    messagesContainer = get('messages-container');
    messageInput = get('message-input');
    sendBtn = get('send-btn');
    backBtn = get('back-btn');
    addEventBtn = get('add-event-btn');

    reminderModal = get('reminder-modal');
    reminderForm = get('reminder-form');
    closeModalBtn = get('close-modal-btn');
    searchModal = get('search-modal');
    addFriendBtn = get('add-friend-btn');
    closeSearchBtn = get('close-search-btn');
    searchSubmitBtn = get('search-submit-btn');
    idInput = get('id-input');
    searchResultContainer = get('search-result');

    console.log('All DOM Elements loaded successfully.');
}

// Initialize
function init() {
    console.log('App Initializing...');
    try {
        loadDOMElements(); // Must be first
        setupEventListeners(); // UI Event Listeners

        // Supabase Auth Listener (Centralized Auth Logic)
        if (supabaseClient) {
            supabaseClient.auth.onAuthStateChange(async (event, session) => {
                console.log('Auth State Change:', event, session);

                if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
                    if (session) {
                        // Avoid re-running logic if already logged in (optional check)
                        const user = session.user;
                        const fullName = user.user_metadata.full_name || user.email || 'User';
                        const role = user.user_metadata.role || 'general';

                        // Update UI Name
                        const userNameEl = document.getElementById('user-name');
                        if (userNameEl) userNameEl.textContent = fullName;

                        // Retrieve user ID
                        currentUser = {
                            id: user.id,
                            name: fullName,
                            role: role,
                            avatar: user.user_metadata.avatar_url || 'https://placehold.co/100'
                        };

                        // Show Welcome Alert only on New Registration
                        // Logic: If CreatedAt is very close to LastSignInAt, it's a new registration.
                        // If I logout and login, LastSignInAt will be newer than CreatedAt.
                        if (event === 'SIGNED_IN') {
                            const createdAt = new Date(user.created_at).getTime();
                            const lastSignIn = new Date(user.last_sign_in_at).getTime();

                            // Allow small variance (e.g. 5 seconds) for system processing
                            const isJustCreated = Math.abs(lastSignIn - createdAt) < 5000;

                            if (isJustCreated) {
                                Swal.fire({
                                    title: `登録が完了しました！\nようこそ ${fullName} さん`,
                                    icon: 'success',
                                    timer: 2000,
                                    showConfirmButton: false
                                });
                            }
                            // Regular logins get no popup
                        }

                        // Trigger Data Fetch & UI Transition
                        loginView.classList.remove('active');
                        if (role === 'admin') {
                            adminView.classList.add('active');
                        } else {
                            chatListView.classList.add('active');
                            // Update Nav
                            navItems.forEach(n => {
                                if (n.dataset.target === 'chat-list-view') n.classList.add('active');
                                else n.classList.remove('active');
                            });
                        }

                        await fetchDataInBackground();
                    }
                } else if (event === 'SIGNED_OUT') {
                    // Prevent clearing UI if we are in Mock Mode explicitly
                    if (currentUser && currentUser.isMock) {
                        console.log('Ignoring SIGNED_OUT event due to Mock Mode.');
                        return;
                    }

                    // Reset UI
                    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
                    loginView.classList.add('active');
                    currentUser = null;
                    if (authForm) authForm.reset();
                }
            });
        }

        setupAuthListeners();
        console.log('App Initialized Successfully.');
    } catch (e) {
        console.error('Critical Error during App Initialization:', e);
        alert('アプリの読み込み中にエラーが発生しました。コンソールを確認してください。\n詳細: ' + e.message);
    }
}


function setupAuthListeners() {
    console.log('Setting up Auth Listeners...');

    if (authToggleBtn) {
        authToggleBtn.addEventListener('click', () => {
            console.log('Auth Toggle Clicked. Current Mode:', isRegisterMode ? 'Register' : 'Login');
            isRegisterMode = !isRegisterMode;
            isOtpMode = false; // Reset OTP mode
            if (otpGroup) otpGroup.style.display = 'none';

            if (isRegisterMode) {
                authTitle.textContent = '新規登録';
                authSubmitBtn.textContent = '登録';
                if (regNameInput) {
                    regNameInput.style.display = 'block';
                    regNameInput.required = true;
                }
                authToggleText.textContent = 'すでにアカウントをお持ちですか？';
                authToggleBtn.textContent = 'ログイン';
            } else {
                authTitle.textContent = 'ログイン';
                authSubmitBtn.textContent = 'ログイン';
                if (regNameInput) {
                    regNameInput.style.display = 'none';
                    regNameInput.required = false;
                }
                authToggleText.textContent = 'アカウントをお持ちでないですか？';
                authToggleBtn.textContent = '新規登録';
            }
        });
    } else {
        console.error('Critical: authToggleBtn not found in DOM!');
    }

    if (authForm) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('Auth Form Submitted');
            const email = authEmailInput.value;
            const password = authPassInput.value;

            try {
                if (supabaseClient) {
                    // --- OTP Verification Mode ---
                    if (isOtpMode) {
                        const token = authOtpInput.value.trim();
                        if (!token) return alert('認証コードを入力してください');

                        const { data, error } = await supabaseClient.auth.verifyOtp({
                            email,
                            token,
                            type: 'signup'
                        });

                        if (error) throw error;

                        // Auto Login Success
                        // onAuthStateChange will handle transition
                        return;
                    }

                    // --- Registration Mode ---
                    if (isRegisterMode) {
                        const name = regNameInput ? regNameInput.value : 'No Name';
                        const { data, error } = await supabaseClient.auth.signUp({
                            email: email,
                            password: password,
                            options: { data: { full_name: name, role: 'general' } }
                        });

                        if (error) throw error;

                        // Check if session is established
                        if (data.session) {
                            // onAuthStateChange will handle transition
                        } else {
                            // Emai Confirmation Required -> Show OTP Input
                            alert('確認コードを送信しました。メールを確認して入力してください。');
                            isOtpMode = true;
                            if (otpGroup) otpGroup.style.display = 'block';
                            authSubmitBtn.textContent = '認証してログイン';

                            // Safe hide
                            if (authPassInput && authPassInput.closest('.input-group')) {
                                authPassInput.closest('.input-group').style.display = 'none';
                            }
                            if (regNameInput) regNameInput.style.display = 'none';
                        }

                    } else {
                        // --- Login Mode ---
                        console.log('Authenticating User...');

                        // Trim inputs to prevent whitespace errors
                        const emailTrimmed = email.trim();
                        const passwordTrimmed = password.trim();

                        console.log(`Debug: Email='${emailTrimmed}', PasswordLength=${passwordTrimmed.length}`);

                        const { data, error } = await supabaseClient.auth.signInWithPassword({
                            email: emailTrimmed,
                            password: passwordTrimmed
                        });

                        if (error) {
                            console.error('Supabase Login Failed:', error);
                            alert('ログインに失敗しました。\n' + error.message);
                            return;
                        }

                        console.log('Login Successful');
                        // onAuthStateChange will handle transition
                    }

                } else {
                    // Fallback Simulation
                    if (isRegisterMode) {
                        alert('[模擬] 確認コードを送信しました (123456)');
                        isOtpMode = true;
                        otpGroup.style.display = 'block';
                        authSubmitBtn.textContent = '認証してログイン';
                    } else if (isOtpMode) {
                        if (authOtpInput.value === '123456') mockLogin('general');
                        else alert('コードが違います');
                    } else {
                        if (email.includes('admin')) mockLogin('admin');
                        else mockLogin('general');
                    }
                }
            } catch (err) {
                alert('エラー: ' + err.message);
                console.error(err);
            }
        });
    } else {
        console.error('Critical: authForm not found in DOM!');
    }
}

// Social Login Logic
window.handleSocialLogin = async function (provider) {
    if (!supabaseClient) return alert('Supabaseが設定されていません');

    try {
        const options = {
            redirectTo: window.location.href
        };

        // Add Google specific query params
        if (provider === 'google') {
            options.queryParams = {
                access_type: 'offline',
                prompt: 'consent'
            };
        }

        const { data, error } = await supabaseClient.auth.signInWithOAuth({
            provider: provider,
            options: options
        });
        if (error) throw error;
    } catch (err) {
        alert('ソーシャルログインエラー: ' + err.message);
    }
};

// ... initial listners ...
// Mock Login
// Mock Login (now acts as Post-Login Initializer)
// Mock Login (now acts as Post-Login Initializer)
// Mock Login (now acts as Post-Login Initializer)
// Duplicate functions removed.



// Logout
window.logout = async function () {
    if (supabaseClient) {
        const { error } = await supabaseClient.auth.signOut();
        if (error) console.error('Logout failed:', error);
        // onAuthStateChange('SIGNED_OUT') will handle the UI
    } else {
        // Fallback for mock mode
        currentUser = null;
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        loginView.classList.add('active');
        authForm.reset();
    }
};

// Render Friend List
function renderFriendList() {
    friendListContainer.innerHTML = '';
    friendCountSpan.textContent = friends.length;

    friends.forEach(friend => {
        const item = document.createElement('div');
        item.className = 'friend-item';
        // Clicking a friend could open chat
        item.onclick = () => {
            // Find existing chat or create new (simplified: just log or open generic)
            const chat = chats.find(c => c.id === friend.id);
            if (chat) {
                openChat(chat.id);
            } else {
                // Should technically create a new chat context
                console.log('Open chat for', friend.name);
            }
        };

        item.innerHTML = `
            <div class="avatar" style="background-image: url('${friend.avatar}')"></div>
            <div class="profile-info">
                <span class="profile-name">${friend.name}</span>
                <span class="profile-status">${friend.status}</span>
            </div>
        `;
        friendListContainer.appendChild(item);
    });
}

// Render Chat List
function renderChatList() {
    chatListContainer.innerHTML = '';
    chats.forEach(chat => {
        const item = document.createElement('div');
        item.className = 'chat-item';
        item.onclick = () => openChat(chat.id);

        const unreadHTML = chat.unread > 0
            ? `<div class="unread-badge">${chat.unread}</div>`
            : '';

        item.innerHTML = `
            <div class="avatar" style="background-image: url('${chat.avatar}')"></div>
            <div class="chat-info">
                <div class="chat-top">
                    <span class="chat-name">${chat.name}</span>
                    <span class="chat-time">${chat.time}</span>
                </div>
                <div class="chat-bottom">
                    <span class="chat-preview">${chat.lastMessage}</span>
                    ${unreadHTML}
                </div>
            </div>
        `;
        chatListContainer.appendChild(item);
    });
}

// Render Schedule
function renderSchedule() {
    scheduleListContainer.innerHTML = '';
    if (appointments.length === 0) {
        scheduleListContainer.innerHTML = '<div class="empty-state">予定はありません</div>';
        return;
    }

    appointments.forEach(app => {
        const item = document.createElement('div');
        item.className = 'schedule-item';
        item.innerHTML = `
            <div class="schedule-title">${app.chatName ? app.chatName + ' : ' : ''}${app.location}</div>
            <div class="schedule-row"><i class="fa-regular fa-clock"></i> ${app.date} ${app.time}</div>
            <div class="schedule-row"><i class="fa-solid fa-align-left"></i> ${app.details || '詳細なし'}</div>
        `;
        if (app.chatId) {
            item.onclick = () => openChat(app.chatId);
            item.style.cursor = 'pointer';
        }
        scheduleListContainer.appendChild(item);
    });
}

// Open Chat
function openChat(id) {
    currentChatId = id;
    const chat = chats.find(c => c.id === id);
    if (!chat) return;

    // Update Header
    chatTitle.textContent = chat.name;

    // Clear previous view or show cached
    renderMessages(chat.messages);

    // Transition View
    chatRoomView.classList.add('active');

    // Fetch Real Messages
    if (supabaseClient) {
        fetchMessages(id);
        subscribeToChat(id);
    }
}

// [ADMIN] Fetch All Chats
window.fetchAllChatsForAdmin = async function () {
    console.log('Admin: Fetching ALL chats...');
    const listContainer = document.getElementById('admin-chat-list');
    listContainer.innerHTML = 'Loading...';

    if (!supabaseClient) return;

    // RLS Policy must allow this for role='admin'
    const { data, error } = await supabaseClient
        .from('chats')
        .select(`
            *,
            chat_members (
                user_id,
                profiles (full_name)
            )
        `)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Admin Fetch Error:', error);
        listContainer.innerHTML = `<div style="color:red">Error: ${error.message}</div>`;
        return;
    }

    console.log('Admin: Chats fetched:', data);
    listContainer.innerHTML = '';

    if (data.length === 0) {
        listContainer.innerHTML = 'チャットルームはありません';
        return;
    }

    data.forEach(chat => {
        const item = document.createElement('div');
        item.style.padding = '10px';
        item.style.borderBottom = '1px solid #eee';
        item.style.cursor = 'pointer';

        const memberNames = chat.chat_members
            .map(m => m.profiles?.full_name || 'Unknown')
            .join(', ');

        item.innerHTML = `
            <strong>${chat.name || 'No Name'}</strong><br>
            <span style="font-size:0.8em; color:#666">Members: ${memberNames}</span>
        `;

        item.onclick = () => {
            // For Admin, just open standard chat view
            // RLS policy updates should allow fetching messages too
            openChat(chat.id);
        };
        listContainer.appendChild(item);
    });
};

async function fetchMessages(chatId) {
    if (!supabaseClient || !currentUser) return;

    const { data, error } = await supabaseClient
        .from('messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true }); // Oldest first

    if (error) {
        console.error('Error fetching messages:', error);
        return;
    }

    // Map to App Format
    const mappedMessages = data.map(m => ({
        id: m.id,
        text: m.content || '',
        time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isMe: m.sender_id === currentUser.id,
        type: m.type || 'text',
        eventId: m.data?.event_id,
        eventData: m.data
    }));

    // Update Cache
    const chatIndex = chats.findIndex(c => c.id === chatId);
    if (chatIndex >= 0) {
        chats[chatIndex].messages = mappedMessages;
        // Don't need to re-render if we are already viewing it, but let's be safe
        renderMessages(mappedMessages);
    }
}

// Subscribe to Realtime Messages
function subscribeToChat(chatId) {
    if (!supabaseClient) return;

    // Unsubscribe previous
    if (currentSubscription) {
        console.log('Unsubscribing from previous channel...');
        supabaseClient.removeChannel(currentSubscription);
        currentSubscription = null;
    }

    console.log('Subscribing to chat:', chatId);
    const channel = supabaseClient.channel(`chat:${chatId}`)
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `chat_id=eq.${chatId}`
            },
            (payload) => {
                console.log('Realtime Message Received:', payload);
                const newMsg = payload.new;

                // Avoid duplicating if we sent it (optimistic UI might have added it)
                // BUT current send implementation relies on fetch, so we should just render it.
                // Or better, check ID existence in DOM to be safe.
                if (document.getElementById(`msg-${newMsg.id}`)) return;

                const mappedMsg = {
                    id: newMsg.id,
                    text: newMsg.content || '',
                    time: new Date(newMsg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    isMe: newMsg.sender_id === currentUser.id,
                    type: newMsg.type || 'text',
                    eventId: newMsg.data?.event_id,
                    eventData: newMsg.data
                };

                // Append to UI
                renderMessage(mappedMsg);

                // Update Cache
                const chat = chats.find(c => c.id === chatId);
                if (chat) chat.messages.push(mappedMsg);
            }
        )
        .subscribe((status) => {
            console.log('Subscription status:', status);
        });

    currentSubscription = channel;
}



function renderMessages(messages) {
    messagesContainer.innerHTML = '';
    messagesContainer.scrollTop = messagesContainer.scrollHeight; // Reset Scroll
    messages.forEach(msg => renderMessage(msg));
    scrollToBottom();
}

// Render Single Message
function renderMessage(msg) {
    const chat = chats.find(c => c.id === currentChatId);
    // If chat info missing (unlikely if active), fallback
    const avatar = chat ? chat.avatar : 'https://placehold.co/100';

    const msgRow = document.createElement('div');
    // Ensure isMe is strictly boolean or derived from updated context if needed
    // Note: msg.isMe is set during mapping (sender_id === currentUser.id)
    msgRow.className = `message-row ${msg.isMe ? 'sent' : 'received'}`;
    msgRow.id = `msg-${msg.id}`; // Add ID for duplicate check

    let innerHTML = '';
    if (!msg.isMe) {
        innerHTML += `<div class="message-avatar" style="background-image: url('${avatar}')"></div>`;
    }

    if (msg.type === 'event') {
        const isJoined = appointments.some(a => a.id === msg.eventId);
        innerHTML += `
            <div class="message-content">
                <div class="bubble event-bubble">
                    <div class="event-header">📅 予定の共有</div>
                    <div class="event-body">
                        <div class="event-row"><i class="fa-solid fa-location-dot"></i> ${msg.eventData?.location || '場所未定'}</div>
                        <div class="event-row"><i class="fa-regular fa-calendar"></i> ${msg.eventData?.date || '日付未定'}</div>
                        <div class="event-row"><i class="fa-regular fa-clock"></i> ${msg.eventData?.time || '--:--'}</div>
                    </div>
                    <div class="event-action">
                        <button class="join-btn ${isJoined ? 'joined' : ''}" onclick="toggleJoinEvent('${msg.eventId}')">
                            ${isJoined ? '参加中' : '参加する'}
                        </button>
                    </div>
                </div>
            </div>
            <div class="message-meta">${msg.time}</div>
        `;
    } else {
        innerHTML += `
            <div class="message-content">
                <div class="bubble">${msg.text}</div>
            </div>
            <div class="message-meta">${msg.time}</div>
        `;
    }

    msgRow.innerHTML = innerHTML;
    messagesContainer.appendChild(msgRow);

    // Ensure smooth scroll to bottom for new messages
    scrollToBottom();
}

window.toggleJoinEvent = function (eventId) {
    if (!currentChatId) return;
    const chat = chats.find(c => c.id === currentChatId);
    const msg = chat.messages.find(m => m.eventId === eventId);
    if (!msg) return;

    const existingIndex = appointments.findIndex(a => a.id === eventId);
    if (existingIndex > -1) {
        // Un-join
        appointments.splice(existingIndex, 1);
    } else {
        // Join
        appointments.push({
            id: eventId,
            chatId: chat.id,
            chatName: chat.name,
            ...msg.eventData
        });
    }

    renderMessages(chat.messages);
    renderSchedule();
};

window.addFriend = function (id) {
    const user = otherUsers.find(u => u.id === id);
    if (!user) return;

    // Add to friends
    friends.push(user);
    // Remove from others (simulated db)
    const index = otherUsers.findIndex(u => u.id === id);
    if (index > -1) otherUsers.splice(index, 1);

    renderFriendList();
    searchModal.classList.remove('active');
    searchResultContainer.innerHTML = '';
    idInput.value = '';
    alert(`${user.name}さんを友達に追加しました`);
};

// Scroll to Bottom
function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Send Message
async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    if (!supabaseClient || !currentUser) {
        alert('オフラインモードまたは未ログインのため送信できません');
        return;
    }

    if (currentChatId) {
        try {
            // Optimistic UI clear (optional, but good for UX)
            messageInput.value = '';

            const { error } = await supabaseClient
                .from('messages')
                .insert({
                    chat_id: currentChatId,
                    sender_id: currentUser.id,
                    content: text,
                    type: 'text'
                });

            if (error) {
                console.error('Message Send Error:', error);
                alert('送信失敗: ' + error.message);
                // Ideally restore input value here if failed
            }
            // Success: Realtime subscription will handle the UI update
        } catch (e) {
            console.error('Send Exception:', e);
            alert('送信エラー');
        }
    }
}

function simulateReply(chat) {
    const replies = ['Interesting!', 'Really?', 'Okay, sounds good.', 'Tell me more.', 'Haha!', 'See you soon.'];
    const randomReply = replies[Math.floor(Math.random() * replies.length)];
    const now = new Date();
    const timeString = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;

    const replyMsg = {
        id: Date.now() + 1,
        text: randomReply,
        time: timeString,
        isMe: false
    };

    chat.messages.push(replyMsg);
    chat.lastMessage = randomReply;
    chat.time = timeString;

    if (currentChatId === chat.id) {
        renderMessages(chat.messages);
    }
    renderChatList();
}

// Event Listeners
function setupEventListeners() {
    backBtn.addEventListener('click', () => {
        chatRoomView.classList.remove('active');
        currentChatId = null;
        renderChatList();
    });

    sendBtn.addEventListener('click', sendMessage);

    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    // Reminder Modal
    addEventBtn.addEventListener('click', () => {
        reminderModal.classList.add('active');
        // Set default date to today
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('event-date').value = today;
    });

    closeModalBtn.addEventListener('click', () => {
        reminderModal.classList.remove('active');
    });

    reminderForm.addEventListener('submit', (e) => {
        e.preventDefault();

        if (!currentChatId) {
            alert('チャットを開いてから作成してください');
            reminderModal.classList.remove('active');
            return;
        }

        const date = document.getElementById('event-date').value;
        const time = document.getElementById('event-time').value;
        const location = document.getElementById('event-location').value;
        const details = document.getElementById('event-details').value;

        const eventData = { date, time, location, details };
        const eventId = Date.now();

        // Send Event Message
        const chat = chats.find(c => c.id === currentChatId);
        const now = new Date();
        const timeString = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;

        chat.messages.push({
            id: Date.now(),
            type: 'event',
            eventId: eventId,
            eventData: eventData, // Just data
            text: '予定を共有しました', // Fallback
            time: timeString,
            isMe: true
        });

        renderMessages(chat.messages);
        reminderModal.classList.remove('active');
        reminderForm.reset();
    });

    // Navigation
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = item.dataset.target;

            if (!targetId) return;

            // Update Active Nav
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            // Switch View
            document.querySelectorAll('.view').forEach(v => {
                if (v.id !== 'chat-room-view') v.classList.remove('active');
                // Note: .view has display:none by default, .active makes it flex.
            });
            const targetView = document.getElementById(targetId);
            if (targetView) targetView.classList.add('active');
        });
    });

    // Settings
    const settingInputs = {
        privacy: document.getElementById('setting-privacy'),
        screenshot: document.getElementById('setting-screenshot'),
        autodelete: document.getElementById('setting-autodelete'),
        idsearch: document.getElementById('setting-idsearch')
    };

    Object.keys(settingInputs).forEach(key => {
        const input = settingInputs[key];
        if (!input) return;

        // Init state
        input.checked = settings[key];

        // Change listener
        input.addEventListener('change', (e) => {
            settings[key] = e.target.checked;
            console.log(`Setting ${key} changed to ${settings[key]}`);

            // Here you would implement actual feature logic
            // For "Screenshot Prevention" we could technically block it or show warning overlay,
            // but browser API limitations exist. For now, it's a mock state.
        });
    });

    // Friend Search
    if (addFriendBtn) {
        addFriendBtn.addEventListener('click', () => {
            searchModal.classList.add('active');
        });
    }

    if (closeSearchBtn) {
        closeSearchBtn.addEventListener('click', () => {
            searchModal.classList.remove('active');
            searchResultContainer.innerHTML = '';
            idInput.value = '';
        });
    }

    if (searchSubmitBtn) {
        searchSubmitBtn.addEventListener('click', () => {
            const query = idInput.value.trim();
            if (!query) return;

            // Check settings
            if (!settings.idsearch) {
                searchResultContainer.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">ID検索は現在無効化されています</div>';
                return;
            }

            // Search in friends first
            const existingFriend = friends.find(f => f.userId === query);
            if (existingFriend) {
                searchResultContainer.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">すでに友達です</div>';
                return;
            }

            // Search in others
            const foundUser = otherUsers.find(u => u.userId === query);

            if (foundUser) {
                searchResultContainer.innerHTML = `
                    <div class="result-card">
                        <div class="result-avatar" style="background-image: url('${foundUser.avatar}')"></div>
                        <div class="result-name">${foundUser.name}</div>
                        <div class="result-id">ID: ${foundUser.userId}</div>
                        <button class="join-btn" onclick="addFriend(${foundUser.id})">友達追加する</button>
                    </div>
                `;
            } else {
                searchResultContainer.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">ユーザーが見つかりませんでした</div>';
            }
        });
    }
}

// Ensure DOM is fully loaded before running
document.addEventListener('DOMContentLoaded', init);

// End of app.js
