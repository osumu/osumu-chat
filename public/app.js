const client = supabase.createClient("https://acebtnoxoijpurwvpisr.supabase.co", "sb_publishable_zgLg3lODrTUNc2JDa1aoXA_epBmQ3Zx");

let user = null;
let currentRoom = null;

const audio = new Audio("public/notification.mp3");

// ======================
// 初期化
// ======================
window.onload = async () => {
    const { data } = await client.auth.getSession();

    if (!data.session) {
        location.href = "public/signup.html";
        return;
    }

    user = data.session.user;

    await ensureProfile();
    await checkInvite();

    loadChats();
    subscribeMessages();
};

// ======================
// ユーティリティ
// ======================
function escapeHtml(str = "") {
    return str
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function formatDate(date) {
    const d = new Date(date);
    return (
        d.getFullYear().toString().slice(2) +
        "/" +
        (d.getMonth() + 1).toString().padStart(2, "0") +
        "/" +
        d.getDate().toString().padStart(2, "0") +
        " " +
        d.getHours().toString().padStart(2, "0") +
        ":" +
        d.getMinutes().toString().padStart(2, "0")
    );
}

// ======================
// プロフィール
// ======================
async function ensureProfile() {
    const username = localStorage.getItem("username") || "user";

    const { data } = await client
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

    if (!data) {
        await client.from("profiles").insert({
            id: user.id,
            username,
            name: username,
            pin: username
        });
    }
}

// ======================
// チャット一覧（自分の部屋のみ）
// ======================
async function loadChats() {
    const { data, error } = await client
        .from("room_members")
        .select("room_id, rooms(*)")
        .eq("user_id", user.id);

    if (error || !data) return;

    let html = "";

    for (const r of data) {
        const room = r.rooms;

        const { data: msgData } = await client
            .from("messages")
            .select("*")
            .eq("room_id", room.id);

        const msgs = msgData || [];

        const last = msgs[msgs.length - 1];

        const unread = msgs.filter(
            (m) =>
                !m.read_by?.includes(user.id) &&
                m.sender_id !== user.id
        ).length;

        html += `
      <div class="chat-item" onclick="openRoom('${room.id}','${room.name}')">
        <div class="avatar"></div>
        <div style="flex:1">
          <b>${escapeHtml(room.name)}</b><br>
          <small>${escapeHtml(last?.content || "メッセージなし")}</small>
        </div>
        <div>
          ${unread > 0 ? `<span class="badge bg-danger">${unread}</span>` : ""}
        </div>
      </div>
    `;
    }

    document.getElementById("chatList").innerHTML =
        html || "<p>まだチャットがありません</p>";
}

// ======================
// ルーム入室
// ======================
async function openRoom(id, name) {
    currentRoom = id;

    document.getElementById("chatUser").innerText = name;
    document.getElementById("chatListPage").style.display = "none";
    document.getElementById("chatRoom").style.display = "block";

    await client.from("room_members").upsert(
        { room_id: id, user_id: user.id },
        { onConflict: "room_id,user_id" }
    );

    loadMessages();
}

// ======================
// 戻る
// ======================
function backList() {
    document.getElementById("chatRoom").style.display = "none";
    document.getElementById("chatListPage").style.display = "block";
}

// ======================
// メッセージ表示
// ======================
async function loadMessages() {
    if (!currentRoom) return;

    const { data } = await client
        .from("messages")
        .select("*")
        .eq("room_id", currentRoom)
        .order("created_at", { ascending: true });

    const msgs = data || [];

    let html = "";
    let lastUser = null;

    msgs.forEach((m) => {
        const isMe = m.sender_id === user.id;
        let cls = isMe ? "bubble-me" : "bubble-you";

        if (!isMe && lastUser === m.sender_id) cls += " square";

        let readMark = "";
        if (isMe) {
            readMark =
                m.read_by?.length > 1
                    ? `<i class="bi bi-check2-all"></i>`
                    : `<i class="bi bi-check-lg"></i>`;
        }

        const attachment = m.file_url
            ? `<button onclick="loadFile('${m.file_url}')">📎 ファイル</button>`
            : "";

        const reactions = (m.reactions || [])
            .map((r) => r.emoji)
            .join(" ");

        html += `
      <div class="${cls}">
        ${escapeHtml(m.content || "")}
        ${attachment}

        <div class="meta">
          ${formatDate(m.created_at)} ${readMark}
        </div>

        <button class="btn btn-sm btn-light react-btn" data-id="${m.id}">
          👍
        </button>

        <div>${reactions}</div>
      </div>
      <div style="clear:both"></div>
    `;

        lastUser = m.sender_id;
    });

    document.getElementById("messages").innerHTML = html;

    initReactionButtons();
    markAsRead();
}

// ======================
// 添付ファイル
// ======================
function loadFile(url) {
    if (!url) return;

    const lower = url.toLowerCase();

    if (lower.match(/\.(jpg|png|gif|webp)$/)) {
        Swal.fire({
            html: `<img src="${url}" style="width:100%">`
        });
        return;
    }

    window.open(url, "_blank");
}

// ======================
// 既読
// ======================
async function markAsRead() {
    if (!currentRoom) return;

    const { data } = await client
        .from("messages")
        .select("*")
        .eq("room_id", currentRoom);

    const msgs = data || [];

    for (const m of msgs) {
        if (!m.read_by?.includes(user.id)) {
            await client
                .from("messages")
                .update({
                    read_by: [...(m.read_by || []), user.id]
                })
                .eq("id", m.id);
        }
    }
}

// ======================
// 送信
// ======================
async function sendMsg() {
    const input = document.getElementById("msgInput");
    const file = document.getElementById("fileInput").files[0];

    if (!input.value && !file) return;

    let fileUrl = null;

    if (file) {
        const path = crypto.randomUUID() + "_" + file.name;

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

// ======================
// リアルタイム
// ======================
function subscribeMessages() {
    client
        .channel("messages")
        .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "messages" },
            (payload) => {
                const msg = payload.new;

                if (msg.room_id === currentRoom) {
                    loadMessages();
                }

                if (msg.sender_id !== user.id) {
                    audio.play();
                }

                loadChats();
            }
        )
        .subscribe();
}
