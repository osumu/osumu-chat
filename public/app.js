const client = supabase.createClient("https://acebtnoxoijpurwvpisr.supabase.co", "sb_publishable_zgLg3lODrTUNc2JDa1aoXA_epBmQ3Zx");

let user = null;
let currentRoom = null;
let channel = null;
let sending = false;

const audio = new Audio("public/notification.mp3");

// ===============================
// 初期化
// ===============================
window.onload = async () => {
    const { data } = await client.auth.getSession();

    if (!data.session) {
        location.href = "public/signup.html";
        return;
    }

    user = data.session.user;

    await ensureProfile();
    await checkInvite();
    await loadChats();
    subscribeMessages();
};

// ===============================
// XSS対策
// ===============================
function escapeHTML(str = "") {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ===============================
// プロフィール
// ===============================
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
            pin: username,
        });
    }
}

// ===============================
// チャット一覧（所属ルームのみ）
// ===============================
async function loadChats() {
    const { data } = await client
        .from("room_members")
        .select("rooms(*)")
        .eq("user_id", user.id);

    const rooms = data?.map((r) => r.rooms) || [];

    let html = "";

    for (const r of rooms) {
        const { data: msgs } = await client
            .from("messages")
            .select("*")
            .eq("room_id", r.id);

        const last = msgs?.[msgs.length - 1];

        const unread = (msgs || []).filter(
            (m) =>
                !m.read_by?.includes(user.id) &&
                m.sender_id !== user.id
        ).length;

        html += `
      <div class="chat-item" onclick="openRoom('${r.id}','${escapeHTML(r.name)}')">
        <b>${escapeHTML(r.name)}</b><br>
        <small>${escapeHTML(last?.content || "なし")}</small>
        ${unread ? `<span class="badge bg-danger">${unread}</span>` : ""}
      </div>
    `;
    }

    document.getElementById("chatList").innerHTML =
        html || "<p>ルームなし</p>";
}

// ===============================
// ルーム参加（DM/グループ再利用）
// ===============================
async function openRoom(id, name) {
    currentRoom = id;

    document.getElementById("chatListPage").style.display = "none";
    document.getElementById("chatRoom").style.display = "block";
    document.getElementById("chatUser").innerText = name;

    await client.from("room_members").upsert(
        {
            room_id: id,
            user_id: user.id,
        },
        { onConflict: "room_id,user_id" }
    );

    loadMessages();
}

// ===============================
// メッセージ描画
// ===============================
async function loadMessages() {
    if (!currentRoom) return;

    const { data } = await client
        .from("messages")
        .select("*")
        .eq("room_id", currentRoom)
        .order("created_at", { ascending: true });

    let html = "";
    let lastUser = null;

    data?.forEach((m) => {
        const isMe = m.sender_id === user.id;

        let cls = isMe ? "bubble-me" : "bubble-you";

        // 連続メッセージ → square
        if (!isMe && lastUser === m.sender_id) {
            cls += " square";
        }

        const readMark =
            isMe && m.read_by?.length > 1
                ? "✓✓"
                : "✓";

        const attachment = m.file_url
            ? `<button onclick="loadFile('${m.file_url}')">添付</button>`
            : "";

        const reactions = (m.reactions || [])
            .map((r) => r.emoji)
            .join(" ");

        html += `
      <div class="${cls}">
        ${escapeHTML(m.content || "")}
        ${attachment}
        <div class="meta">${readMark}</div>
        <div>${reactions}</div>
      </div>
    `;

        lastUser = m.sender_id;
    });

    document.getElementById("messages").innerHTML = html;

    markAsReadBatch();
}

// ===============================
// 一括既読（最適化済み）
// ===============================
async function markAsReadBatch() {
    const { data } = await client
        .from("messages")
        .select("id, read_by")
        .eq("room_id", currentRoom);

    const updates = (data || [])
        .filter((m) => !m.read_by?.includes(user.id))
        .map((m) =>
            client
                .from("messages")
                .update({ read_by: [user.id] })
                .eq("id", m.id)
        );

    await Promise.all(updates);
}

// ===============================
// 送信（連打防止）
// ===============================
async function sendMsg() {
    if (sending) return;

    const input = document.getElementById("msgInput");
    const file = document.getElementById("fileInput").files[0];

    if (!input.value && !file) return;

    sending = true;
    document.getElementById("sendBtn").disabled = true;

    try {
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
            file_url: fileUrl,
        });

        input.value = "";
    } finally {
        sending = false;
        document.getElementById("sendBtn").disabled = false;
    }
}

// ===============================
// リアルタイム（重複防止）
// ===============================
function subscribeMessages() {
    if (channel) client.removeChannel(channel);

    channel = client
        .channel("messages")
        .on(
            "postgres_changes",
            {
                event: "INSERT",
                schema: "public",
                table: "messages",
            },
            (payload) => {
                const msg = payload.new;

                if (msg.room_id === currentRoom) loadMessages();

                if (msg.sender_id !== user.id) audio.play();

                loadChats();
            }
        )
        .subscribe();
}

// ===============================
// 安全ファイルビューア
// ===============================
function loadFile(url) {
    const lower = url.toLowerCase();
    const safe = escapeHTML(url);

    if (lower.match(/\.(jpg|png|gif|webp|jpeg)$/)) {
        return Swal.fire({
            html: `<img src="${safe}" style="width:100%">`,
        });
    }

    if (lower.match(/\.(mp4|webm)$/)) {
        return Swal.fire({
            html: `<video controls style="width:100%"><source src="${safe}"></video>`,
        });
    }

    if (lower.endsWith(".pdf")) {
        return Swal.fire({
            html: `<iframe src="${safe}" style="width:100%;height:80vh"></iframe>`,
        });
    }

    Swal.fire({
        title: "開きますか？",
        text: url,
    }).then((r) => {
        if (r.isConfirmed) window.open(url, "_blank");
    });
}

// ===============================
// UI戻る
// ===============================
function backList() {
    document.getElementById("chatRoom").style.display = "none";
    document.getElementById("chatListPage").style.display = "block";
}

// ===============================
// QR / PIN / メンバー（簡易統合）
// ===============================
async function addByPin(pin) {
    const { data } = await client
        .from("profiles")
        .select("*")
        .eq("pin", pin)
        .single();

    if (!data) return Swal.fire("見つからない");

    const { data: room } = await client
        .from("rooms")
        .insert({ name: data.name })
        .select()
        .single();

    await client.from("room_members").insert([
        { room_id: room.id, user_id: user.id },
        { room_id: room.id, user_id: data.id },
    ]);

    loadChats();
    Swal.fire("追加完了");
}