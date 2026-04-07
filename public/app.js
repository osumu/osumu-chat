const client = supabase.createClient("https://jhtehnixwtzihaiyvluu.supabase.co", "sb_publishable_VxkEQnw_gXXxHoxHKTQp3Q_41PKWC8x");

let user = null;
let currentRoom = null;

// 通知音
const audio = new Audio("notification.mp3");

// 初期化
window.onload = async () => {
    if (!localStorage.getItem("login")) {
        location.href = "/signup.html";
        return;
    }

    const { data } = await client.auth.getSession();
    user = data.session.user;

    await ensureProfile();
    loadChats();
    subscribeRealtime();
}

// プロフィール
async function ensureProfile() {
    const { data } = await client.from("profiles").select("*").eq("id", user.id).single();
    if (!data) {
        const pin = Math.floor(100000 + Math.random() * 900000);
        await client.from("profiles").insert({
            id: user.id,
            name: user.email.split("@")[0],
            pin
        });
    }
}

// ===== 友達追加 =====
async function addFriend(pin) {
    const { data } = await client.from("profiles").select("*").eq("pin", pin).single();
    if (!data) { alert("見つからない"); return; }

    const { data: room } = await client.from("rooms")
        .insert({ name: data.name, is_group: false })
        .select().single();

    await client.from("room_members").insert([
        { room_id: room.id, user_id: user.id },
        { room_id: room.id, user_id: data.id }
    ]);

    loadChats();
}

// ===== グループ作成 =====
async function createGroup() {
    const name = prompt("グループ名");
    if (!name) return;

    const { data: room } = await client.from("rooms")
        .insert({ name, is_group: true })
        .select().single();

    await client.from("room_members").insert({
        room_id: room.id,
        user_id: user.id
    });

    alert("作成完了");
    loadChats();
}

// ===== チャット一覧 =====
async function loadChats() {
    const { data } = await client.from("rooms").select("*");

    let html = "";
    for (const r of data) {
        const { data: last } = await client.from("messages")
            .select("*")
            .eq("room_id", r.id)
            .order("created_at", { ascending: false })
            .limit(1);

        const msg = last?.[0]?.content || "メッセージなし";
        const time = last?.[0]?.created_at?.slice(0, 10).replaceAll("-", "/") || "";

        html += `
    <div class='chat-item' onclick="openRoom('${r.id}','${r.name}')">
      <div class='avatar'></div>
      <div>
        <b>${r.name}</b><br>
        <small>${msg} ${time}</small>
      </div>
    </div>`;
    }

    document.getElementById("chatList").innerHTML = html;
}

// ===== トーク =====
function openRoom(id, name) {
    currentRoom = id;
    document.getElementById("chatUser").innerText = name;
    loadMessages();
}

// 日付
function formatDate(d) {
    return d.slice(0, 10).replaceAll("-", "/");
}

// メッセージ表示
async function loadMessages() {
    const { data } = await client.from("messages")
        .select("*")
        .eq("room_id", currentRoom)
        .order("created_at");

    let html = "";
    let lastDate = "";
    let lastUser = null;

    data.forEach(m => {
        const date = formatDate(m.created_at);

        if (date !== lastDate) {
            html += `<div class='date'>${date}</div>`;
            lastDate = date;
        }

        let cls = m.user_id === user.id ? "bubble-me" : "bubble-you";

        if (lastUser === m.user_id && m.user_id !== user.id) {
            cls += " square";
        }

        html += `<div class='${cls}'>${m.content}</div><div style='clear:both'></div>`;

        lastUser = m.user_id;
    });

    document.getElementById("messages").innerHTML = html;

    markAsRead();
}

// ===== 既読 =====
async function markAsRead() {
    const { data } = await client.from("messages")
        .select("*")
        .eq("room_id", currentRoom);

    data.forEach(async m => {
        if (!m.read_by?.includes(user.id)) {
            await client.from("messages")
                .update({ read_by: [...(m.read_by || []), user.id] })
                .eq("id", m.id);
        }
    });
}

// ===== 送信 =====
async function sendMsg() {
    let text = document.getElementById("msgInput").value;
    const file = document.getElementById("fileInput").files[0];

    let file_url = null;

    if (file) {
        const { data } = await client.storage.from("files").upload(Date.now() + file.name, file);
        file_url = client.storage.from("files").getPublicUrl(data.path).data.publicUrl;
        text = `<a href='${file_url}' target='_blank'>ファイル</a>`;
    }

    await client.from("messages").insert({
        room_id: currentRoom,
        user_id: user.id,
        content: text,
        file_url,
        read_by: [user.id]
    });

    document.getElementById("msgInput").value = "";
    loadMessages();
}

// ===== リアルタイム + 通知 =====
function subscribeRealtime() {
    client.channel("chat")
        .on("postgres_changes", { event: "INSERT", table: "messages" }, payload => {

            // 通知音
            if (payload.new.user_id !== user.id) {
                audio.play();
            }

            loadMessages();
            loadChats();
        })
        .subscribe();
}

function setBubble(type) {
    localStorage.setItem("bubble", type);
    Swal.fire("気泡を変更しました");
}

function loadIconPicker() {
    if (window.IconPicker) {
        new IconPicker("#iconPicker");
    }
}

function showDevices() {
    Swal.fire({
        title: "接続デバイス",
        text: "現在ログイン中の端末情報",
        html: `
      <ul>
        <li>この端末（現在）</li>
      </ul>
    `
    });
}

// ===== 設定 =====
function openSettings() {
    Swal.fire({
        title: "設定",
        width: "800px",
        html: `
    
    <button class="btn btn-light mb-3" onclick="Swal.close()">
      <i class="bi bi-arrow-left"></i>
    </button>

    <h3>設定</h3>

    <hr>

    <p>テーマカラー</p>
    <select id="theme" class="form-select mb-2">
      <option value="light">ライト</option>
      <option value="dark">ダーク</option>
      <option value="auto">自動</option>
      <option value="custom">カスタム</option>
    </select>

    <p>アクセントカラー</p>
    <input type="text" data-coloris id="accent" class="form-control mb-3">

    <p>背景色 / 壁紙</p>
    <input type="text" data-coloris id="bgColor" class="form-control mb-2">
    <input type="file" id="bgImg" class="form-control mb-3">

    <p>メッセージ気泡の形</p>
    <div class="d-flex flex-wrap gap-2 mb-3">
      ${[1, 2, 3, 4, 5, 6, 7].map(i => `
        <img src="bubble${i}.png" onclick="setBubble(${i})" style="width:60px;cursor:pointer">
      `).join("")}
    </div>

    <p>角丸度</p>
    <input type="range" id="radius" min="0" max="30" class="form-range mb-3">

    <p>新着メッセージ通知</p>
    <select id="notify" class="form-select mb-3">
      <option value="on">オン</option>
      <option value="off">オフ</option>
      <option value="silent">サイレント</option>
    </select>

    <p>メッセージ自動削除</p>
    <select id="deleteMsg" class="form-select mb-3">
      <option value="24h">24時間</option>
      <option value="7d">7日</option>
      <option value="30d">30日</option>
      <option value="none">無期限</option>
    </select>

    <p>表示名</p>
    <input type="text" id="displayName" class="form-control mb-3">

    <p>アイコン画像</p>
    <input type="file" id="iconUpload" class="form-control mb-2">

    <div id="iconPicker"></div>

    <button class="btn btn-secondary mt-3" onclick="showDevices()">
      接続デバイス管理
    </button>

    <br><br>

    <button class="btn btn-success mt-3" onclick="saveSettings()">
      保存
    </button>
    `
    });

    loadIconPicker();
}

async function saveSettings() {
    const theme = document.getElementById("theme").value;
    const accent = document.getElementById("accent").value;
    const bgColor = document.getElementById("bgColor").value;
    const radius = document.getElementById("radius").value;
    const notify = document.getElementById("notify").value;
    const deleteMsg = document.getElementById("deleteMsg").value;
    const displayName = document.getElementById("displayName").value;

    localStorage.setItem("theme", theme);
    localStorage.setItem("accent", accent);
    localStorage.setItem("bgColor", bgColor);
    localStorage.setItem("radius", radius);
    localStorage.setItem("notify", notify);
    localStorage.setItem("deleteMsg", deleteMsg);
    localStorage.setItem("displayName", displayName);

    document.documentElement.style.setProperty("--accent", accent);

    Swal.fire("保存完了");
}