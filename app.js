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

// --- Random User ID Generation ---

// Generate a random alphanumeric string of specified length
function generateRandomId(length = 8) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Generate a unique user ID (checks for duplicates in database)
async function generateUniqueUserId(maxRetries = 5) {
    if (!supabaseClient) {
        console.warn('Supabase not available, generating local ID');
        return generateRandomId(8);
    }

    for (let i = 0; i < maxRetries; i++) {
        const candidateId = generateRandomId(8);

        // Check if this ID already exists
        const { data: existingUser, error } = await supabaseClient
            .from('profiles')
            .select('id')
            .eq('user_id_search', candidateId)
            .maybeSingle();

        if (error) {
            console.error('Error checking ID uniqueness:', error);
            continue;
        }

        if (!existingUser) {
            // ID is unique, return it
            console.log('Generated unique user ID:', candidateId);
            return candidateId;
        }

        console.log('ID collision, retrying...', candidateId);
    }

    // Fallback: generate a longer ID if all retries fail
    console.warn('Failed to generate unique ID after retries, using longer ID');
    return generateRandomId(12);
}

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
            currentUser.userId = data.user_id_search;
            updateMyProfileUI();
            updateSettingsUI();
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

    // Show navigation bar on login
    const mainNav = document.getElementById('main-nav');
    if (mainNav) mainNav.style.display = 'flex';

    if (role === 'admin') {
        // Show Admin
        adminView.classList.add('active');
        // Hide nav for admin view
        if (mainNav) mainNav.style.display = 'none';
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

// Fetch all data in background after login
async function fetchDataInBackground() {
    try {
        await fetchProfile();
        await fetchFriends();
        await fetchChats();
        await fetchSchedule();
        console.log('Background data fetching complete');
    } catch (err) {
        console.error('Error fetching data in background:', err);
    }
}

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

// Fetch schedule/appointments from database (stub for now)
async function fetchSchedule() {
    if (!supabaseClient || !currentUser) return;

    // Skip fetching from Supabase if this is a Mock User
    if (currentUser.isMock) {
        console.log('Skipping fetchSchedule for Mock User.');
        return;
    }

    // TODO: Implement actual schedule fetching from Supabase
    // For now, just render the existing appointments array
    renderSchedule();
}


function updateMyProfileUI() {
    const nameData = document.getElementById('my-name') || document.querySelector('.my-profile .profile-name');
    const statusData = document.getElementById('my-status') || document.querySelector('.my-profile .profile-status');
    const avatarData = document.getElementById('my-avatar') || document.querySelector('.my-profile .avatar-large');

    if (nameData && currentUser) nameData.textContent = currentUser.name || 'Me';
    if (statusData && currentUser) statusData.textContent = currentUser.status || 'ステータスメッセージを追加';
    if (avatarData && currentUser && currentUser.avatar) {
        avatarData.style.backgroundImage = `url('${currentUser.avatar}')`;
    }
}

// Update Settings UI with user ID
function updateSettingsUI() {
    // Update settings page ID display
    const userIdDisplay = document.getElementById('user-id-display');
    if (userIdDisplay && currentUser && currentUser.userId) {
        userIdDisplay.textContent = currentUser.userId;
    }

    // Update home profile ID display
    const myIdDisplay = document.getElementById('my-id-display');
    if (myIdDisplay && currentUser && currentUser.userId) {
        myIdDisplay.innerHTML = `<i class="fa-solid fa-at"></i> ${currentUser.userId}`;
    }
}

// Update User ID in Supabase
window.updateUserId = async function () {
    if (!supabaseClient || !currentUser) {
        alert('ログインしてください');
        return;
    }

    const { value: newId } = await Swal.fire({
        title: 'IDを変更',
        input: 'text',
        inputLabel: '新しいID (英数字とアンダースコアのみ)',
        inputValue: currentUser.userId || '',
        inputPlaceholder: 'user_xxxxx',
        showCancelButton: true,
        confirmButtonText: '変更',
        cancelButtonText: 'キャンセル',
        inputValidator: (value) => {
            if (!value) return '値を入力してください';
            if (!/^[a-zA-Z0-9_]+$/.test(value)) return '英数字とアンダースコアのみ使用可能です';
            if (value.length < 3) return '3文字以上で入力してください';
            if (value.length > 20) return '20文字以下で入力してください';
        }
    });

    if (!newId) return;

    try {
        // Check if ID is already taken
        const { data: existingUser } = await supabaseClient
            .from('profiles')
            .select('id')
            .eq('user_id_search', newId)
            .neq('id', currentUser.id)
            .single();

        if (existingUser) {
            Swal.fire({
                icon: 'error',
                title: 'エラー',
                text: 'このIDは既に使用されています'
            });
            return;
        }

        // Update ID
        const { error } = await supabaseClient
            .from('profiles')
            .update({ user_id_search: newId })
            .eq('id', currentUser.id);

        if (error) throw error;

        currentUser.userId = newId;
        updateSettingsUI();

        Swal.fire({
            icon: 'success',
            title: '変更完了',
            text: 'IDが変更されました',
            timer: 1500,
            showConfirmButton: false
        });
    } catch (err) {
        console.error('ID update error:', err);
        Swal.fire({
            icon: 'error',
            title: 'エラー',
            text: err.message
        });
    }
};

// Search user by ID in Supabase
async function searchUserById(query) {
    if (!supabaseClient) {
        return { error: 'Supabaseに接続されていません' };
    }

    try {
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('id, full_name, avatar_url, user_id_search')
            .eq('user_id_search', query)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
            throw error;
        }

        return { data };
    } catch (err) {
        console.error('Search error:', err);
        return { error: err.message };
    }
}

// Add friend to Supabase
window.addFriendById = async function (friendId) {
    if (!supabaseClient || !currentUser) {
        alert('ログインしてください');
        return;
    }

    try {
        // Check if already friends
        const { data: existing } = await supabaseClient
            .from('friends')
            .select('*')
            .eq('user_id', currentUser.id)
            .eq('friend_id', friendId)
            .single();

        if (existing) {
            alert('すでに友達です');
            return;
        }

        // Add friend
        const { error } = await supabaseClient
            .from('friends')
            .insert({
                user_id: currentUser.id,
                friend_id: friendId
            });

        if (error) throw error;

        // Refresh friends list
        await fetchFriends();

        Swal.fire({
            icon: 'success',
            title: '友達追加完了',
            timer: 1500,
            showConfirmButton: false
        });

        // Close modal
        searchModal.classList.remove('active');
        searchResultContainer.innerHTML = '';
        idInput.value = '';
    } catch (err) {
        console.error('Add friend error:', err);
        alert('エラー: ' + err.message);
    }
};

// Profile Edit Modal
let profileEditModal = null;
let avatarPreview = null;
let editNicknameInput = null;
let editStatusInput = null;
let avatarFileInput = null;
let pendingAvatarFile = null;

window.openProfileEditModal = function () {
    profileEditModal = profileEditModal || document.getElementById('profile-edit-modal');
    avatarPreview = avatarPreview || document.getElementById('avatar-preview');
    editNicknameInput = editNicknameInput || document.getElementById('edit-nickname');
    editStatusInput = editStatusInput || document.getElementById('edit-status');
    avatarFileInput = avatarFileInput || document.getElementById('avatar-input');

    if (!profileEditModal) return;

    // Populate current values
    if (currentUser) {
        editNicknameInput.value = currentUser.name || '';
        editStatusInput.value = currentUser.status || '';
        if (currentUser.avatar) {
            avatarPreview.style.backgroundImage = `url('${currentUser.avatar}')`;
        }
    }

    // Update character count
    const charCount = document.getElementById('status-char-count');
    if (charCount) charCount.textContent = editStatusInput.value.length;

    // Reset pending avatar
    pendingAvatarFile = null;

    profileEditModal.classList.add('active');
};

window.closeProfileEditModal = function () {
    if (profileEditModal) {
        profileEditModal.classList.remove('active');
    }
    pendingAvatarFile = null;
};

// Handle avatar file selection
function handleAvatarSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
        alert('画像ファイルを選択してください');
        return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
        alert('ファイルサイズは2MB以下にしてください');
        return;
    }

    pendingAvatarFile = file;

    // Preview the image
    const reader = new FileReader();
    reader.onload = (e) => {
        avatarPreview.style.backgroundImage = `url('${e.target.result}')`;
    };
    reader.readAsDataURL(file);
}

// Upload avatar to Supabase Storage
async function uploadAvatar(file) {
    if (!supabaseClient || !currentUser) return null;

    const fileExt = file.name.split('.').pop();
    const fileName = `${currentUser.id}-${Date.now()}.${fileExt}`;
    const filePath = `avatars/${fileName}`;

    const { data, error } = await supabaseClient.storage
        .from('avatars')
        .upload(filePath, file, {
            cacheControl: '3600',
            upsert: true
        });

    if (error) {
        console.error('Avatar upload error:', error);
        // If storage bucket doesn't exist, use a data URL instead
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.readAsDataURL(file);
        });
    }

    // Get public URL
    const { data: urlData } = supabaseClient.storage
        .from('avatars')
        .getPublicUrl(filePath);

    return urlData.publicUrl;
}

// Save Profile
window.saveProfile = async function (event) {
    event.preventDefault();

    if (!supabaseClient || !currentUser) {
        alert('ログインしてください');
        return;
    }

    const newName = editNicknameInput.value.trim();
    const newStatus = editStatusInput.value.trim();

    if (!newName) {
        alert('ニックネームを入力してください');
        return;
    }

    try {
        let avatarUrl = currentUser.avatar;

        // Upload new avatar if selected
        if (pendingAvatarFile) {
            Swal.fire({
                title: 'アップロード中...',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });

            avatarUrl = await uploadAvatar(pendingAvatarFile);

            Swal.close();
        }

        // Update profile in Supabase
        const { error } = await supabaseClient
            .from('profiles')
            .update({
                full_name: newName,
                status_message: newStatus,
                avatar_url: avatarUrl
            })
            .eq('id', currentUser.id);

        if (error) throw error;

        // Update local state
        currentUser.name = newName;
        currentUser.status = newStatus;
        currentUser.avatar = avatarUrl;

        // Update UI
        updateMyProfileUI();
        closeProfileEditModal();

        Swal.fire({
            icon: 'success',
            title: 'プロフィールを更新しました',
            timer: 1500,
            showConfirmButton: false
        });

    } catch (err) {
        console.error('Profile update error:', err);
        Swal.fire({
            icon: 'error',
            title: 'エラー',
            text: err.message
        });
    }
};

// Setup profile edit listeners
function setupProfileEditListeners() {
    const closeBtn = document.getElementById('close-profile-modal-btn');
    const form = document.getElementById('profile-edit-form');
    const statusInput = document.getElementById('edit-status');
    const avatarInput = document.getElementById('avatar-input');
    const avatarPreviewEl = document.getElementById('avatar-preview');

    if (closeBtn) {
        closeBtn.addEventListener('click', closeProfileEditModal);
    }

    if (form) {
        form.addEventListener('submit', saveProfile);
    }

    if (statusInput) {
        statusInput.addEventListener('input', (e) => {
            const charCount = document.getElementById('status-char-count');
            if (charCount) charCount.textContent = e.target.value.length;
        });
    }

    if (avatarInput) {
        avatarInput.addEventListener('change', handleAvatarSelect);
    }

    if (avatarPreviewEl) {
        avatarPreviewEl.addEventListener('click', () => {
            document.getElementById('avatar-input').click();
        });
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

    // Auth elements - use optional lookups since form structure changed
    const getOptional = (id) => document.getElementById(id);
    authForm = getOptional('auth-form'); // No longer exists - optional
    authTitle = getOptional('auth-title');
    authSubmitBtn = getOptional('auth-submit-btn');
    regNameInput = getOptional('reg-name');
    authEmailInput = getOptional('auth-email');
    authPassInput = getOptional('auth-password');
    authOtpInput = getOptional('auth-otp');
    otpGroup = getOptional('otp-group');
    authToggleBtn = getOptional('auth-toggle-btn');
    authToggleText = getOptional('auth-toggle-text');

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
        setupProfileEditListeners(); // Profile editing

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
                                // Generate random unique user ID for new users
                                const randomId = await generateUniqueUserId();
                                if (randomId) {
                                    await supabaseClient
                                        .from('profiles')
                                        .update({ user_id_search: randomId })
                                        .eq('id', user.id);
                                    console.log('Assigned random user ID:', randomId);
                                }

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

                        // Show navigation bar for logged in users
                        const mainNav = document.getElementById('main-nav');

                        if (role === 'admin') {
                            adminView.classList.add('active');
                            // Hide nav for admin view
                            if (mainNav) mainNav.style.display = 'none';
                        } else {
                            chatListView.classList.add('active');
                            // Show nav for regular users
                            if (mainNav) mainNav.style.display = 'flex';
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

    // State
    let pendingEmail = '';
    let pendingName = '';

    // Setup OTP input auto-focus for both forms
    setupOtpInputs('login-otp-inputs');
    setupOtpInputs('register-otp-inputs');

    function setupOtpInputs(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const inputs = container.querySelectorAll('input');
        inputs.forEach((input, index) => {
            input.addEventListener('input', (e) => {
                if (e.target.value && index < inputs.length - 1) {
                    inputs[index + 1].focus();
                }
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && !e.target.value && index > 0) {
                    inputs[index - 1].focus();
                }
            });

            input.addEventListener('paste', (e) => {
                e.preventDefault();
                const paste = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
                paste.split('').forEach((char, i) => {
                    if (inputs[i]) inputs[i].value = char;
                });
            });
        });
    }

    function getOtpValue(containerId) {
        const inputs = document.querySelectorAll(`#${containerId} input`);
        return Array.from(inputs).map(i => i.value).join('');
    }

    function clearOtpInputs(containerId) {
        const inputs = document.querySelectorAll(`#${containerId} input`);
        inputs.forEach(i => i.value = '');
        if (inputs[0]) inputs[0].focus();
    }

    // Switch between login/register modes
    window.switchAuthMode = function (mode) {
        document.getElementById('auth-mode-login').classList.toggle('active', mode === 'login');
        document.getElementById('auth-mode-register').classList.toggle('active', mode === 'register');

        // Reset to email step
        document.getElementById('login-step-email').classList.add('active');
        document.getElementById('login-step-otp').classList.remove('active');
        document.getElementById('register-step-email').classList.add('active');
        document.getElementById('register-step-otp').classList.remove('active');
    };

    window.backToEmail = function (mode) {
        document.getElementById(`${mode}-step-email`).classList.add('active');
        document.getElementById(`${mode}-step-otp`).classList.remove('active');
    };

    window.resendOtp = async function (mode) {
        if (!pendingEmail) return;
        await sendOtpCode(pendingEmail, mode === 'register');
        Swal.fire({ icon: 'success', title: 'コードを再送信しました', timer: 2000, showConfirmButton: false });
    };

    function showOtpStep(mode, email) {
        pendingEmail = email;
        const display = document.getElementById(`${mode}-email-display`);
        if (display) display.textContent = email;
        document.getElementById(`${mode}-step-email`).classList.remove('active');
        document.getElementById(`${mode}-step-otp`).classList.add('active');
        clearOtpInputs(`${mode}-otp-inputs`);
    }

    async function sendOtpCode(email, isSignUp = false, name = '') {
        if (!supabaseClient) {
            alert('[模擬モード] 認証コード: 123456');
            return true;
        }

        try {
            Swal.fire({ title: '送信中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

            const options = { shouldCreateUser: isSignUp };
            if (isSignUp && name) options.data = { full_name: name };

            const { error } = await supabaseClient.auth.signInWithOtp({ email, options });
            if (error) throw error;

            Swal.fire({ icon: 'success', title: '認証コードを送信しました', text: `${email} のメールを確認`, timer: 3000, showConfirmButton: false });
            return true;
        } catch (err) {
            Swal.fire({ icon: 'error', title: '送信エラー', text: err.message });
            return false;
        }
    }

    async function verifyOtpCode(email, token, isSignUp = false) {
        if (!supabaseClient) {
            if (token === '123456') { mockLogin('general'); return true; }
            alert('認証コードが正しくありません');
            return false;
        }

        try {
            Swal.fire({ title: '認証中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const { error } = await supabaseClient.auth.verifyOtp({ email, token, type: 'email' });
            if (error) throw error;
            Swal.fire({ icon: 'success', title: isSignUp ? 'アカウント作成完了' : 'ログイン成功', timer: 1500, showConfirmButton: false });
            return true;
        } catch (err) {
            Swal.fire({ icon: 'error', title: '認証エラー', text: '認証コードが正しくないか、有効期限が切れています' });
            return false;
        }
    }

    // Login email form
    const loginEmailForm = document.getElementById('login-email-form');
    if (loginEmailForm) {
        loginEmailForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('login-email').value.trim();
            if (!email) return;
            if (await sendOtpCode(email, false)) showOtpStep('login', email);
        });
    }

    // Register email form
    const registerEmailForm = document.getElementById('register-email-form');
    if (registerEmailForm) {
        registerEmailForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('register-name').value.trim();
            const email = document.getElementById('register-email').value.trim();
            if (!name || !email) return;
            pendingName = name;
            if (await sendOtpCode(email, true, name)) showOtpStep('register', email);
        });
    }

    // Login OTP form
    const loginOtpForm = document.getElementById('login-otp-form');
    if (loginOtpForm) {
        loginOtpForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const token = getOtpValue('login-otp-inputs');
            if (token.length !== 6) { Swal.fire({ icon: 'warning', title: '6桁のコードを入力', timer: 2000, showConfirmButton: false }); return; }
            await verifyOtpCode(pendingEmail, token, false);
        });
    }

    // Register OTP form
    const registerOtpForm = document.getElementById('register-otp-form');
    if (registerOtpForm) {
        registerOtpForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const token = getOtpValue('register-otp-inputs');
            if (token.length !== 6) { Swal.fire({ icon: 'warning', title: '6桁のコードを入力', timer: 2000, showConfirmButton: false }); return; }
            await verifyOtpCode(pendingEmail, token, true);
        });
    }
}

// Social Login Logic
window.handleSocialLogin = async function (provider) {
    if (!supabaseClient) return alert('Supabaseが設定されていません');

    try {
        // Use production URL for redirect, or localhost for development
        const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
        const redirectUrl = isProduction ? 'https://chamomile.fun/' : window.location.origin + '/';

        const options = {
            redirectTo: redirectUrl
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
    // Clear mock flag first so SIGNED_OUT event is not ignored
    if (currentUser && currentUser.isMock) {
        currentUser.isMock = false;
    }

    if (supabaseClient) {
        const { error } = await supabaseClient.auth.signOut();
        if (error) console.error('Logout failed:', error);
        // onAuthStateChange('SIGNED_OUT') will handle the UI
    }

    // Always reset UI for both mock and real mode
    currentUser = null;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    loginView.classList.add('active');
    if (authForm) authForm.reset();

    // Hide navigation bar on logout
    const mainNav = document.getElementById('main-nav');
    if (mainNav) mainNav.style.display = 'none';
};

// Render Friend List
function renderFriendList() {
    friendListContainer.innerHTML = '';
    friendCountSpan.textContent = friends.length;

    friends.forEach(friend => {
        const item = document.createElement('div');
        item.className = 'friend-item';
        // Clicking a friend opens their profile
        item.onclick = () => openFriendProfile(friend);

        item.innerHTML = `
            <div class="avatar" style="background-image: url('${friend.avatar}')"></div>
            <div class="profile-info">
                <span class="profile-name">${friend.name}</span>
                <span class="profile-status">${friend.status || ''}</span>
            </div>
        `;
        friendListContainer.appendChild(item);
    });
}

// Friend Profile Modal State
let selectedFriend = null;
let friendProfileModal = null;

// Open Friend Profile Modal
window.openFriendProfile = function (friend) {
    selectedFriend = friend;
    friendProfileModal = friendProfileModal || document.getElementById('friend-profile-modal');

    if (!friendProfileModal) return;

    // Populate modal with friend data
    const avatarEl = document.getElementById('friend-profile-avatar');
    const nameEl = document.getElementById('friend-profile-name');
    const idEl = document.getElementById('friend-profile-id');
    const statusEl = document.getElementById('friend-profile-status');

    if (avatarEl) avatarEl.style.backgroundImage = `url('${friend.avatar || 'https://i.pravatar.cc/150?u=' + friend.id}')`;
    if (nameEl) nameEl.textContent = friend.name || 'Unknown';
    if (idEl) idEl.textContent = friend.userId ? `@${friend.userId}` : '';
    if (statusEl) statusEl.textContent = friend.status || 'ステータスなし';

    friendProfileModal.classList.add('active');
};

// Close Friend Profile Modal
window.closeFriendProfileModal = function () {
    if (friendProfileModal) {
        friendProfileModal.classList.remove('active');
    }
    selectedFriend = null;
};

// Start Chat with Friend
window.startChatWithFriend = async function () {
    if (!selectedFriend) return;

    closeFriendProfileModal();

    // Find existing DM chat or create new one
    const chatId = await findOrCreateDMChat(selectedFriend.id, selectedFriend.name, selectedFriend.avatar);

    if (chatId) {
        openChat(chatId);
    }
};

// Find or Create DM Chat
async function findOrCreateDMChat(friendId, friendName, friendAvatar) {
    if (!currentUser) {
        console.error('No current user');
        return null;
    }

    // First, check if there's already a chat with this friend in our local chats
    const existingChat = chats.find(chat => {
        // For DM chats, we might have stored the friend's ID or name
        return chat.friendId === friendId || chat.name === friendName;
    });

    if (existingChat) {
        return existingChat.id;
    }

    // If using Supabase, try to find or create in the database
    if (supabaseClient) {
        try {
            // Check if a DM chat already exists between these two users
            const { data: existingChats, error: searchError } = await supabaseClient
                .from('chat_members')
                .select('chat_id')
                .eq('user_id', currentUser.id);

            if (searchError) throw searchError;

            // For each chat the current user is in, check if the friend is also a member
            for (const membership of existingChats || []) {
                const { data: otherMembers } = await supabaseClient
                    .from('chat_members')
                    .select('user_id')
                    .eq('chat_id', membership.chat_id)
                    .eq('user_id', friendId);

                if (otherMembers && otherMembers.length > 0) {
                    // Check if it's a DM (only 2 members)
                    const { data: allMembers } = await supabaseClient
                        .from('chat_members')
                        .select('user_id')
                        .eq('chat_id', membership.chat_id);

                    if (allMembers && allMembers.length === 2) {
                        // Found existing DM chat
                        // Make sure it's in our local chats array
                        if (!chats.find(c => c.id === membership.chat_id)) {
                            chats.push({
                                id: membership.chat_id,
                                name: friendName,
                                avatar: friendAvatar || `https://i.pravatar.cc/150?u=${friendId}`,
                                friendId: friendId,
                                lastMessage: '',
                                time: '',
                                unread: 0,
                                messages: []
                            });
                            renderChatList();
                        }
                        return membership.chat_id;
                    }
                }
            }

            // No existing DM found, create a new one
            const { data: newChat, error: chatError } = await supabaseClient
                .from('chats')
                .insert({
                    name: friendName,
                    is_group: false
                })
                .select()
                .single();

            if (chatError) throw chatError;

            // Add both users as members
            const { error: membersError } = await supabaseClient
                .from('chat_members')
                .insert([
                    { chat_id: newChat.id, user_id: currentUser.id },
                    { chat_id: newChat.id, user_id: friendId }
                ]);

            if (membersError) throw membersError;

            // Add to local chats array
            const newLocalChat = {
                id: newChat.id,
                name: friendName,
                avatar: friendAvatar || `https://i.pravatar.cc/150?u=${friendId}`,
                friendId: friendId,
                lastMessage: '',
                time: '',
                unread: 0,
                messages: []
            };
            chats.push(newLocalChat);
            renderChatList();

            console.log('Created new DM chat:', newChat.id);
            return newChat.id;

        } catch (err) {
            console.error('Error in findOrCreateDMChat:', err);
            Swal.fire({
                icon: 'error',
                title: 'エラー',
                text: 'チャットの作成に失敗しました'
            });
            return null;
        }
    } else {
        // Mock mode: create a local-only chat
        const mockChatId = 'mock-dm-' + friendId;
        const mockChat = {
            id: mockChatId,
            name: friendName,
            avatar: friendAvatar || `https://i.pravatar.cc/150?u=${friendId}`,
            friendId: friendId,
            lastMessage: '',
            time: '',
            unread: 0,
            messages: []
        };
        chats.push(mockChat);
        renderChatList();
        return mockChatId;
    }
}

// Render Chat List
function renderChatList() {
    chatListContainer.innerHTML = '';

    // Calculate total unread count for nav badge
    let totalUnread = 0;

    chats.forEach(chat => {
        const item = document.createElement('div');
        item.className = 'chat-item';
        item.onclick = () => openChat(chat.id);

        const unreadHTML = chat.unread > 0
            ? `<div class="unread-badge">${chat.unread}</div>`
            : '';

        totalUnread += chat.unread || 0;

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

    // Update navigation badge
    updateChatBadge(totalUnread);
}

// Update Chat Badge in Navigation
function updateChatBadge(count) {
    const badge = document.getElementById('chat-badge');
    if (!badge) return;

    if (count > 0) {
        badge.textContent = count > 9 ? '9+' : count.toString();
        badge.style.display = 'block';
    } else {
        badge.style.display = 'none';
    }
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

// [ADMIN] Switch Tabs
window.switchAdminTab = function (tabName) {
    // Update tab buttons
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.admin-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `admin-tab-${tabName}`);
    });

    // Load data for the tab
    if (tabName === 'users') {
        fetchAllUsersForAdmin();
    } else if (tabName === 'chats') {
        fetchAllChatsForAdmin();
    } else if (tabName === 'messages') {
        loadChatSelectForAdmin();
    }
};

// [ADMIN] Fetch All Users
window.fetchAllUsersForAdmin = async function () {
    console.log('Admin: Fetching ALL users...');
    const container = document.getElementById('admin-user-list-container');
    container.innerHTML = '<p class="admin-hint">読み込み中...</p>';

    if (!supabaseClient) return;

    const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Admin Fetch Users Error:', error);
        container.innerHTML = `<p style="color:#e94560">Error: ${error.message}</p>`;
        return;
    }

    console.log('Admin: Users fetched:', data);

    // Update stats
    const totalUsers = data.length;
    const frozenUsers = data.filter(u => u.is_frozen).length;
    document.getElementById('stat-total-users').textContent = totalUsers;
    document.getElementById('stat-frozen-users').textContent = frozenUsers;

    container.innerHTML = '';

    if (data.length === 0) {
        container.innerHTML = '<p class="admin-hint">ユーザーがいません</p>';
        return;
    }

    data.forEach(user => {
        const isFrozen = user.is_frozen || false;
        const isAdmin = user.role === 'admin';
        const avatarUrl = user.avatar_url || `https://i.pravatar.cc/150?u=${user.id}`;

        const card = document.createElement('div');
        card.className = 'admin-user-card';
        card.innerHTML = `
            <div class="admin-user-avatar" style="background-image: url('${avatarUrl}')"></div>
            <div class="admin-user-info">
                <div class="admin-user-name">
                    ${user.full_name || 'Unknown'}
                    <span class="admin-user-status ${isFrozen ? 'status-frozen' : 'status-active'}">
                        ${isFrozen ? '凍結中' : 'アクティブ'}
                    </span>
                    ${isAdmin ? '<span class="admin-user-role">Admin</span>' : ''}
                </div>
                <div class="admin-user-id">ID: ${user.user_id_search || user.id.substring(0, 8)}</div>
            </div>
            <div class="admin-user-actions">
                ${!isAdmin ? `
                    <button class="btn-admin-action ${isFrozen ? 'btn-unfreeze' : 'btn-freeze'}" 
                            onclick="toggleUserFreeze('${user.id}', ${isFrozen})">
                        <i class="fa-solid ${isFrozen ? 'fa-unlock' : 'fa-lock'}"></i>
                        ${isFrozen ? '解除' : '凍結'}
                    </button>
                    <button class="btn-admin-action btn-delete" onclick="deleteUser('${user.id}', '${user.full_name}')">
                        <i class="fa-solid fa-trash"></i> 削除
                    </button>
                ` : '<span style="color:#666;font-size:12px">管理者</span>'}
            </div>
        `;
        container.appendChild(card);
    });
};

// [ADMIN] Toggle User Freeze
window.toggleUserFreeze = async function (userId, currentlyFrozen) {
    const action = currentlyFrozen ? '解除' : '凍結';

    const result = await Swal.fire({
        title: `ユーザーを${action}しますか？`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: currentlyFrozen ? '#06c755' : '#ffc107',
        cancelButtonColor: '#666',
        confirmButtonText: action,
        cancelButtonText: 'キャンセル'
    });

    if (!result.isConfirmed) return;

    try {
        const { error } = await supabaseClient
            .from('profiles')
            .update({ is_frozen: !currentlyFrozen })
            .eq('id', userId);

        if (error) throw error;

        Swal.fire({
            icon: 'success',
            title: `${action}しました`,
            timer: 1500,
            showConfirmButton: false
        });

        fetchAllUsersForAdmin();
    } catch (err) {
        console.error('Freeze error:', err);
        Swal.fire({ icon: 'error', title: 'エラー', text: err.message });
    }
};

// [ADMIN] Delete User
window.deleteUser = async function (userId, userName) {
    const result = await Swal.fire({
        title: 'ユーザーを削除しますか？',
        html: `<strong>${userName}</strong> を完全に削除します。<br>この操作は取り消せません。`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e94560',
        cancelButtonColor: '#666',
        confirmButtonText: '削除する',
        cancelButtonText: 'キャンセル'
    });

    if (!result.isConfirmed) return;

    try {
        // Delete user's messages first
        await supabaseClient.from('messages').delete().eq('sender_id', userId);

        // Delete user's chat memberships
        await supabaseClient.from('chat_members').delete().eq('user_id', userId);

        // Delete user's friends
        await supabaseClient.from('friends').delete().or(`user_id.eq.${userId},friend_id.eq.${userId}`);

        // Delete user profile
        const { error } = await supabaseClient.from('profiles').delete().eq('id', userId);

        if (error) throw error;

        Swal.fire({
            icon: 'success',
            title: 'ユーザーを削除しました',
            timer: 1500,
            showConfirmButton: false
        });

        fetchAllUsersForAdmin();
    } catch (err) {
        console.error('Delete user error:', err);
        Swal.fire({ icon: 'error', title: 'エラー', text: err.message });
    }
};

// [ADMIN] Fetch All Chats
window.fetchAllChatsForAdmin = async function () {
    console.log('Admin: Fetching ALL chats...');
    const listContainer = document.getElementById('admin-chat-list');
    listContainer.innerHTML = '<p class="admin-hint">読み込み中...</p>';

    if (!supabaseClient) return;

    const { data, error } = await supabaseClient
        .from('chats')
        .select(`
            *,
            chat_members (
                user_id,
                profiles (full_name)
            ),
            messages (id)
        `)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Admin Fetch Error:', error);
        listContainer.innerHTML = `<p style="color:#e94560">Error: ${error.message}</p>`;
        return;
    }

    console.log('Admin: Chats fetched:', data);

    // Update stats
    document.getElementById('stat-total-chats').textContent = data.length;

    listContainer.innerHTML = '';

    if (data.length === 0) {
        listContainer.innerHTML = '<p class="admin-hint">チャットルームはありません</p>';
        return;
    }

    data.forEach(chat => {
        const memberNames = chat.chat_members
            .map(m => m.profiles?.full_name || 'Unknown')
            .join(', ');

        const messageCount = chat.messages?.length || 0;
        const createdDate = new Date(chat.created_at).toLocaleDateString('ja-JP');

        const item = document.createElement('div');
        item.className = 'admin-chat-item';
        item.innerHTML = `
            <div class="admin-chat-info">
                <div class="admin-chat-name">${chat.name || 'No Name'}</div>
                <div class="admin-chat-members"><i class="fa-solid fa-users"></i> ${memberNames}</div>
                <div class="admin-chat-meta">
                    <i class="fa-solid fa-message"></i> ${messageCount}件 | 
                    <i class="fa-solid fa-calendar"></i> ${createdDate}
                </div>
            </div>
            <div class="admin-user-actions">
                <button class="btn-admin-action btn-view" onclick="viewChatMessages('${chat.id}')">
                    <i class="fa-solid fa-eye"></i> 監視
                </button>
                <button class="btn-admin-action btn-delete" onclick="deleteChat('${chat.id}', '${chat.name}')">
                    <i class="fa-solid fa-trash"></i> 削除
                </button>
            </div>
        `;
        listContainer.appendChild(item);
    });
};

// [ADMIN] Delete Chat Room
window.deleteChat = async function (chatId, chatName) {
    const result = await Swal.fire({
        title: 'チャットルームを削除しますか？',
        html: `<strong>${chatName || 'このチャット'}</strong> とすべてのメッセージを削除します。`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e94560',
        cancelButtonColor: '#666',
        confirmButtonText: '削除する',
        cancelButtonText: 'キャンセル'
    });

    if (!result.isConfirmed) return;

    try {
        // Delete all messages in the chat
        await supabaseClient.from('messages').delete().eq('chat_id', chatId);

        // Delete all chat members
        await supabaseClient.from('chat_members').delete().eq('chat_id', chatId);

        // Delete the chat itself
        const { error } = await supabaseClient.from('chats').delete().eq('id', chatId);

        if (error) throw error;

        Swal.fire({
            icon: 'success',
            title: 'チャットルームを削除しました',
            timer: 1500,
            showConfirmButton: false
        });

        fetchAllChatsForAdmin();
    } catch (err) {
        console.error('Delete chat error:', err);
        Swal.fire({ icon: 'error', title: 'エラー', text: err.message });
    }
};

// [ADMIN] Load Chat Select for Message Monitor
async function loadChatSelectForAdmin() {
    const select = document.getElementById('admin-chat-select');
    if (!select || !supabaseClient) return;

    const { data } = await supabaseClient
        .from('chats')
        .select('id, name')
        .order('created_at', { ascending: false });

    select.innerHTML = '<option value="">チャットルームを選択...</option>';

    if (data) {
        data.forEach(chat => {
            const option = document.createElement('option');
            option.value = chat.id;
            option.textContent = chat.name || `Chat ${chat.id.substring(0, 8)}`;
            select.appendChild(option);
        });
    }
}

// [ADMIN] View Chat Messages
window.viewChatMessages = function (chatId) {
    switchAdminTab('messages');
    const select = document.getElementById('admin-chat-select');
    if (select) {
        select.value = chatId;
        loadChatMessagesForAdmin();
    }
};

// [ADMIN] Load Chat Messages for Monitor
window.loadChatMessagesForAdmin = async function () {
    const select = document.getElementById('admin-chat-select');
    const container = document.getElementById('admin-messages-container');

    if (!select || !container || !supabaseClient) return;

    const chatId = select.value;
    if (!chatId) {
        container.innerHTML = '<p class="admin-hint">チャットルームを選択するとメッセージが表示されます</p>';
        return;
    }

    container.innerHTML = '<p class="admin-hint">読み込み中...</p>';

    const { data, error } = await supabaseClient
        .from('messages')
        .select(`
            *,
            profiles:sender_id (full_name)
        `)
        .eq('chat_id', chatId)
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) {
        container.innerHTML = `<p style="color:#e94560">Error: ${error.message}</p>`;
        return;
    }

    container.innerHTML = '';

    if (data.length === 0) {
        container.innerHTML = '<p class="admin-hint">メッセージがありません</p>';
        return;
    }

    data.forEach(msg => {
        const senderName = msg.profiles?.full_name || 'Unknown';
        const time = new Date(msg.created_at).toLocaleString('ja-JP');

        const item = document.createElement('div');
        item.className = 'admin-message-item';
        item.innerHTML = `
            <div class="admin-message-header">
                <span class="admin-message-sender">${senderName}</span>
                <span class="admin-message-time">${time}</span>
            </div>
            <div class="admin-message-content">${msg.content || '[メディア/その他]'}</div>
        `;
        container.appendChild(item);
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

    // Friend Profile Modal
    const closeFriendProfileBtn = document.getElementById('close-friend-profile-btn');
    const startChatBtn = document.getElementById('btn-start-chat');

    if (closeFriendProfileBtn) {
        closeFriendProfileBtn.addEventListener('click', closeFriendProfileModal);
    }

    if (startChatBtn) {
        startChatBtn.addEventListener('click', startChatWithFriend);
    }

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
        searchSubmitBtn.addEventListener('click', async () => {
            const query = idInput.value.trim();
            if (!query) return;

            // Check settings
            if (!settings.idsearch) {
                searchResultContainer.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">ID検索は現在無効化されています</div>';
                return;
            }

            // Don't search for yourself
            if (currentUser && currentUser.userId === query) {
                searchResultContainer.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">自分自身は検索できません</div>';
                return;
            }

            // Show loading
            searchResultContainer.innerHTML = '<div style="text-align:center; padding:20px; color:#666;"><i class="fa-solid fa-spinner fa-spin"></i> 検索中...</div>';

            // Search in Supabase
            const { data: foundUser, error } = await searchUserById(query);

            if (error) {
                searchResultContainer.innerHTML = `<div style="text-align:center; padding:20px; color:#f00;">エラー: ${error}</div>`;
                return;
            }

            if (foundUser) {
                // Check if already friends
                const isAlreadyFriend = friends.some(f => f.id === foundUser.id);

                if (isAlreadyFriend) {
                    searchResultContainer.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">すでに友達です</div>';
                    return;
                }

                const avatarUrl = foundUser.avatar_url || `https://i.pravatar.cc/150?u=${foundUser.id}`;
                searchResultContainer.innerHTML = `
                    <div class="result-card">
                        <div class="result-avatar" style="background-image: url('${avatarUrl}')"></div>
                        <div class="result-name">${foundUser.full_name || 'ユーザー'}</div>
                        <div class="result-id">ID: ${foundUser.user_id_search}</div>
                        <button class="join-btn" onclick="addFriendById('${foundUser.id}')">友達追加する</button>
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
