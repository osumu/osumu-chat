const client = supabase.createClient("https://rruxpquxtdyzhhcrurlj.supabase.co", "sb_publishable_diOIPnyEi1VU1RE8xeKpBw_6askP5-A");

let user = null;
let currentRoom = null;

const audio = new Audio("./public/notification.mp3");

// 初期化
window.onload = async () => {
    const { data, error } = await client.auth.getSession();

    if (!data.session) {
        location.href = "public/login.html";
        return;
    }

    user = data.session.user;

    await ensureProfile();
    await checkInvite();
    loadChats();
    subscribeMessages();
}

function formatDate(date) {
    const d = new Date(date);

    return d.getFullYear().toString().slice(2) + "/" +
        (d.getMonth() + 1).toString().padStart(2, "0") + "/" +
        d.getDate().toString().padStart(2, "0") + " " +
        d.getHours().toString().padStart(2, "0") + ":" +
        d.getMinutes().toString().padStart(2, "0");
}

// プロフィール
async function ensureProfile() {
    const username = localStorage.getItem("username");

    const { data } = await client.from("profiles")
        .select("*")
        .eq("username", username)
        .single();

    if (!data) {
        await client.from("profiles").insert({
            id: user.id,
            username,
            name: username
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

    Swal.fire("作成完了");
    loadChats();
}

async function leaveGroup() {

    const result = await Swal.fire({
        title: "グループ退出",
        text: "本当に退出しますか？",
        icon: "warning",
        showCancelButton: true
    });

    if (!result.isConfirmed) return;

    await client
        .from("room_members")
        .delete()
        .eq("room_id", currentRoom)
        .eq("user_id", user.id);

    Swal.fire("退出しました");

    // 一覧に戻る
    document.getElementById("chatRoom").style.display = "none";
    document.getElementById("chatListPage").style.display = "block";

    loadChats();
}

function createInviteLink() {

    const url = location.origin + "?room=" + currentRoom;

    Swal.fire({
        title: "招待リンク",
        html: `<input class="form-control" value="${url}">`
    });
}

async function checkInvite() {

    const params = new URLSearchParams(location.search);
    const roomId = params.get("room");

    if (!roomId) return;

    await client.from("room_members").insert({
        room_id: roomId,
        user_id: user.id
    });

    Swal.fire("グループに参加しました");

    // URLを消す
    history.replaceState(null, null, "/");

    loadChats();
}

function addMemberToGroup() {
    Swal.fire({
        title: "メンバー追加",
        input: "text",
        inputPlaceholder: "PINコード",
        showCancelButton: true
    }).then(async res => {

        if (!res.value) return;

        const { data } = await client
            .from("profiles")
            .select("*")
            .eq("pin", res.value)
            .single();

        if (!data) {
            Swal.fire("見つかりません");
            return;
        }

        await client.from("room_members").insert({
            room_id: currentRoom,
            user_id: data.id
        });

        Swal.fire("追加しました");
    });
}

// ===== チャット一覧 =====
async function loadChats() {

    const { data: rooms } = await client.from("rooms").select("*");

    let html = "";

    for (const r of rooms) {

        const { data: msgs } = await client
            .from("messages")
            .select("*")
            .eq("room_id", r.id);

        const unread = msgs.filter(m =>
            !m.read_by?.includes(user.id) &&
            m.sender_id !== user.id
        ).length;

        const last = msgs[msgs.length - 1];

        html += `
        <div class="chat-item" onclick="openRoom('${r.id}','${r.name}')">

            <div class="avatar"></div>

            <div style="flex:1">
                <b>${r.name}</b><br>
                <small>${last?.content || "メッセージなし"}</small>
            </div>

            <div>
                ${unread > 0 ? `<span class="badge bg-danger">${unread}</span>` : ""}
            </div>

        </div>
        `;
    }

    document.getElementById("chatList").innerHTML = html;
}

function openChat(userId, username) {

    currentChatUser = userId;

    document.getElementById("chatUser").innerText = username;

    document.getElementById("chatListPage").style.display = "none";
    document.getElementById("chatRoom").style.display = "block";

    loadMessages();
}

async function loadChatList() {
    const { data: { user } } = await client.auth.getUser();
    const { data: friends } = await client
        .from("friends")
        .select("friend_id, profiles(*)")
        .eq("user_id", user.id);

    const list = document.getElementById("chatList");
    list.innerHTML = "";

    if (!friends || friends.length === 0) {
        list.innerHTML = `
      <p>まだ相手がいません。右上の追加ボタンで話し相手を追加しましょう。</p>
    `;
        return;
    }

    friends.forEach(f => {
        const p = f.profiles;

        list.innerHTML += `
      <div class="card p-2 mb-2" onclick="openChat('${p.id}','${p.username}')">
        <b>${p.username}</b><br>
        <small>メッセージなし</small>
      </div>
    `;
    });
}

function showQR() {
    const url = location.origin + "?room=" + currentRoom;

    Swal.fire({
        title: "QR",
        html: `<canvas id="qrcode"></canvas>`,
        didOpen: () => {

            QRCode.toCanvas(
                document.getElementById("qrcode"),
                url,
                { width: 200 }
            );
        }
    });
}

async function scanQR() {
    Swal.fire({
        title: "QR読み取り",
        html: `<div id="reader"></div>`,
        showConfirmButton: false,
        didOpen: () => {

            const qr = new Html5Qrcode("reader");

            qr.start(
                { facingMode: "environment" },
                { fps: 10, qrbox: 250 },
                async (text) => {

                    qr.stop();

                    const url = new URL(text);
                    const roomId = url.searchParams.get("room");

                    if (!roomId) {
                        Swal.fire("無効なQR");
                        return;
                    }

                    await client.from("room_members").insert({
                        room_id: roomId,
                        user_id: user.id
                    });

                    Swal.fire("参加しました");
                    loadChats();
                }
            );
        }
    });
}

async function openAdd() {
    Swal.fire({
        title: "追加",
        html: `
      <input id="pinInput" class="form-control mb-2" placeholder="PINコード">
    `,
        confirmButtonText: "追加"
    }).then(async (result) => {
        if (!result.isConfirmed) return;

        const pin = document.getElementById("pinInput").value;

        if (!pin) {
            Swal.fire("PINを入力してください");
            return;
        }

        // 相手検索
        const { data: user, error } = await client
            .from("profiles")
            .select("*")
            .eq("pin", pin)
            .single();

        if (error || !user) {
            Swal.fire("ユーザーが見つかりません");
            return;
        }

        const { data: { user: me } } = await client.auth.getUser();

        // 自分→相手
        await client.from("friends").insert({
            user_id: me.id,
            friend_id: user.id
        });

        // 相手→自分
        await client.from("friends").insert({
            user_id: user.id,
            friend_id: me.id
        });

        Swal.fire("追加しました！");
        loadChatList();
    });
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
    const { data } = await client
        .from("messages")
        .select("*")
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .order("created_at", { ascending: true });

    let html = "";
    let lastDate = "";
    let lastUser = null;

    data.forEach(m => {
        const date = formatDate(m.created_at);

        if (date !== lastDate) {
            html += `<div class='date'>${date}</div>`;
            lastDate = date;
        }

        let cls = m.sender_id === user.id ? "bubble-me" : "bubble-you";

        if (lastUser === m.sender_id && m.sender_id !== user.id) {
            cls += " square";
        }

        html += `<div class='${cls}'>${m.content}</div>`;


        lastUser = m.user_id;
    });

    document.getElementById("messages").innerHTML = html;

    markAsRead();
}

function renderMessage(m) {

    const isMe = m.sender_id === user.id;

    let readMark = "";

    if (isMe) {
        if (m.read_by && m.read_by.length > 1) {
            readMark = "✔✔";
        } else {
            readMark = "✔";
        }
    }

    return `
    <div class="${isMe ? "bubble-me" : "bubble-you"}">
        ${m.content || ""}
        ${m.file_url ? `<a href="${m.file_url}" target="_blank">📎</a>` : ""}
        <div class="meta">
            ${formatDate(m.created_at)} ${readMark}
        </div>
    </div>
    `;
}

// ===== 既読 =====
async function markAsRead() {

    const { data } = await client
        .from("messages")
        .select("*")
        .eq("room_id", currentRoom);

    for (const m of data) {
        if (!m.read_by?.includes(user.id)) {

            await client.from("messages")
                .update({
                    read_by: [...(m.read_by || []), user.id]
                })
                .eq("id", m.id);
        }
    }
}

// ===== 送信 =====
async function sendMsg() {

    const input = document.getElementById("msgInput");
    const file = document.getElementById("fileInput").files[0];

    if (!input.value && !file) return;

    const { data: { user } } = await client.auth.getUser();

    let fileUrl = null;

    // ファイル送信
    if (file) {
        const path = Date.now() + "_" + file.name;

        await client.storage.from("files").upload(path, file);

        const { data } = client.storage.from("files").getPublicUrl(path);
        fileUrl = data.publicUrl;
    }

    await client.from("messages").insert({
        room_id: currentRoom,
        sender_id: user.id,
        content: input.value,
        file_url: fileUrl
    });

    input.value = "";
}

function addMessage(msg) {

    const box = document.getElementById("messages");

    const isMe = msg.sender_id === myId;

    const div = document.createElement("div");

    div.className = isMe ? "msg me" : "msg other";

    div.innerHTML = `
    ${msg.content ? `<div>${msg.content}</div>` : ""}
    ${msg.file_url ? `<a href="${msg.file_url}" target="_blank">📎 ファイル</a>` : ""}
    <small>${formatDate(msg.created_at)}</small>
  `;

    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

// ===== リアルタイム + 通知 =====
function subscribeMessages() {

    client
        .channel("messages")
        .on(
            "postgres_changes",
            { event: "UPDATE", schema: "public", table: "messages" },
            payload => {
                loadMessages(); // 既読更新反映
            }
        )
        .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "messages" },
            payload => {

                const msg = payload.new;

                if (msg.room_id === currentRoom) {
                    addMessage(msg);
                }

                if (msg.sender_id !== user.id) {
                    audio.play();
                }

                loadChats(); // 未読バッジ更新
            }
        )
        .subscribe();
}
