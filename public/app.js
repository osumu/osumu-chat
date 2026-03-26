let socket, myId, currentUser;
const notifySound = new Audio('/notification.mp3');

window.onload = () => {
    const token = localStorage.getItem('token');

    // 未ログイン → signupへ
    if (!token) {
        location.href = '/signup';
        return;
    }

    // JWT decode
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        myId = payload.id;
    } catch (e) {
        localStorage.removeItem('token');
        location.href = '/login';
        return;
    }

    // Socket接続
    socket = io({
        auth: { token }
    });

    socket.on('private message', data => {
        notifySound.play();
        renderMessage(data);
    });

    // 保存済みUI設定の復元
    loadUISettings();
};


// ===== PIN検索 =====
async function findUser() {
    const pin = document.getElementById('pinInput').value;

    if (!pin) {
        alert('PINを入力してください');
        return;
    }

    const res = await fetch(`/user-by-pin/${pin}`, {
        headers: {
            Authorization: 'Bearer ' + localStorage.getItem('token')
        }
    });

    if (!res.ok) {
        alert('ユーザーが見つかりません');
        return;
    }

    currentUser = await res.json();

    document.getElementById('selectUserScreen').style.display = 'none';
    document.getElementById('chatScreen').style.display = 'flex';

    loadMessages();
}


// ===== メッセージ取得 =====
async function loadMessages() {
    const res = await fetch(`/messages/${currentUser.id}`, {
        headers: {
            Authorization: 'Bearer ' + localStorage.getItem('token')
        }
    });

    const msgs = await res.json();

    const box = document.getElementById('messages');
    box.innerHTML = '';

    msgs.forEach(renderMessage);

    // スクロール一番下
    box.scrollTop = box.scrollHeight;
}


// ===== 送信 =====
async function sendMsg() {
    const msgInput = document.getElementById('msg');
    const fileInput = document.getElementById('fileInput');

    const msg = msgInput.value.trim();

    // ファイル送信
    if (fileInput.files.length) {
        const form = new FormData();
        form.append('file', fileInput.files[0]);

        const res = await fetch('/upload', {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + localStorage.getItem('token')
            },
            body: form
        });

        const data = await res.json();

        socket.emit('private message', {
            to: currentUser.id,
            file: data.url
        });

        fileInput.value = '';
    }
    // テキスト送信
    else if (msg) {
        socket.emit('private message', {
            to: currentUser.id,
            message: msg
        });
    }

    msgInput.value = '';
}


// ===== 表示 =====
function renderMessage(m) {
    const div = document.createElement('div');

    const isMe = (m.sender_id === myId || m.from === myId);

    div.className = isMe ? 'text-end mb-2' : 'text-start mb-2';

    if (m.file || m.file_url) {
        const img = document.createElement('img');
        img.src = m.file || m.file_url;
        img.style.maxWidth = '150px';
        img.className = 'rounded';
        div.appendChild(img);
    } else {
        div.textContent = m.message || m.content;
    }

    const box = document.getElementById('messages');
    box.appendChild(div);

    // 自動スクロール
    box.scrollTop = box.scrollHeight;
}


// ===== 設定 =====
function openSettings() {
    document.getElementById('settingsModal').style.display = 'block';
}

function closeSettings() {
    document.getElementById('settingsModal').style.display = 'none';
}


// ===== プロフィール =====
async function saveProfile() {
    const name = document.getElementById('set_name').value;

    if (!name) {
        alert('名前を入力してください');
        return;
    }

    await fetch('/update-profile', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + localStorage.getItem('token')
        },
        body: JSON.stringify({ username: name })
    });

    alert('更新しました');
}


// ===== UI設定 =====
function setBackground() {
    const url = document.getElementById('bgInput').value;

    document.getElementById('messages').style.backgroundImage = `url(${url})`;
    localStorage.setItem('bg', url);
}

function setAccent() {
    const color = document.getElementById('accentInput').value;

    document.documentElement.style.setProperty('--bs-primary', color);
    localStorage.setItem('accent', color);
}


// 保存済み設定読み込み
function loadUISettings() {
    const bg = localStorage.getItem('bg');
    const accent = localStorage.getItem('accent');

    if (bg) {
        document.getElementById('messages').style.backgroundImage = `url(${bg})`;
    }

    if (accent) {
        document.documentElement.style.setProperty('--bs-primary', accent);
    }
}


// ===== ログアウト =====
function logout() {
    localStorage.removeItem('token');
    location.href = '/login';
}


// ===== トークンリセット =====
function resetToken() {
    localStorage.removeItem('token');
    location.href = '/signup';
}
