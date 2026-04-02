const sb = supabase.createClient(url(), key());

let user;

let currentMsgId = null;

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('#reactionPicker').emojiPicker({
        width: '300px',
        height: '200px',
        onEmojiSelected: function (emoji) {
            if (currentMsgId) {
                addReaction(currentMsgId, emoji);
            }
            document.getElementById('#reactionPicker').hide();
        }
    });
});

async function init() {
    const { data } = await sb.auth.getUser();
    user = data.user;

    if (!user) {
        location.href = "public/signup.html";
        return;
    }

    await loadMyPIN();   // ← PIN表示
    await loadChats();   // ← トーク一覧
    realtime();          // ← リアルタイム開始
}

async function loadChats() {
    const { data } = await sb
        .from("room_members")
        .select("*")
        .eq("user_id", user.id);

    const list = chatList;
    list.innerHTML = "";

    if (!data.length) {
        empty.style.display = "block";
        return;
    }

    empty.style.display = "none";

    for (let r of data) {
        const { data: msgs } = await sb
            .from("messages")
            .select("*")
            .eq("room_id", r.room_id)
            .order("id", { ascending: false })
            .limit(1);

        const last = msgs[0];

        const div = document.createElement("div");
        div.className = "chat-item";

        div.innerHTML = `
      <div class="avatar"></div>
      <div>
        <div class="name">${r.room_id}</div>
        <div class="preview">
          ${last ? last.text : "まだメッセージなし"}
        </div>
      </div>
    `;

        div.onclick = () => openChat(r.room_id);

        list.appendChild(div);
    }
}

/* ================= PIN生成 ================= */

function generatePIN() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

/* ================= 自分のPIN取得 ================= */

async function loadMyPIN() {

    const { data } = await sb
        .from("profiles")
        .select("pin")
        .eq("id", user.id)
        .single();

    if (data?.pin) {
        myPin.innerText = data.pin;
        myPinSettings.innerText = data.pin;
        return;
    }

    // なければ生成
    const pin = generatePIN();

    await sb.from("profiles").upsert({
        id: user.id,
        pin: pin
    });

    myPin.innerText = pin;
    myPinSettings.innerText = pin;
}

async function addByPIN() {

    const pin = pinInput.value;

    if (!pin) {
        alert("PINを入力してください");
        return;
    }

    // 相手検索
    const { data: target } = await sb
        .from("profiles")
        .select("*")
        .eq("pin", pin)
        .single();

    if (!target) {
        alert("ユーザーが見つかりません");
        return;
    }

    if (target.id === user.id) {
        alert("自分は追加できません");
        return;
    }

    const roomId = [user.id, target.id].sort().join("_");

    // ルーム作成
    await sb.from("rooms").upsert({ id: roomId });

    // メンバー追加
    await sb.from("room_members").upsert([
        { room_id: roomId, user_id: user.id },
        { room_id: roomId, user_id: target.id }
    ]);

    closeAdd();
    loadChats();
}



/* ================= 追加 ================= */

function openAdd() { addModal.classList.remove("hidden"); }
function closeAdd() { addModal.classList.add("hidden"); }

async function addUser() {
    const target = pinInput.value;

    const roomId = [user.id, target].sort().join("_");

    await sb.from("rooms").insert({ id: roomId });

    await sb.from("room_members").insert([
        { room_id: roomId, user_id: user.id },
        { room_id: roomId, user_id: target }
    ]);

    closeAdd();
    loadChats();
}

/* ================= チャット ================= */

function openChat(roomId) {
    currentRoom = roomId;

    listPage.classList.add("hidden");
    chatPage.classList.remove("hidden");

    roomName.innerText = roomId;

    loadMessages();
    markRead();
}

function backList() {
    chatPage.classList.add("hidden");
    listPage.classList.remove("hidden");
}

/* ================= QRスキャン ================= */

let stream = null;

async function openScan() {
    // 画面切り替え
    addModal.classList.add("hidden");
    scanPage.classList.remove("hidden");

    try {
        // カメラ起動
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" }
        });

        const video = document.getElementById("camera");
        video.srcObject = stream;
        video.play();

    } catch (e) {
        alert("カメラが使えません（HTTPSまたは権限を確認してください）");
    }
}

function backAdd() {
    // カメラ停止
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }

    // 画面戻る
    scanPage.classList.add("hidden");
    addModal.classList.remove("hidden");
}


/* ================= 設定画面 ================= */

function openSettings() {
    // チャット画面 → 設定画面
    chatPage.classList.add("hidden");
    settingsPage.classList.remove("hidden");
}

function closeSettings() {
    // 設定画面 → チャット画面
    settingsPage.classList.add("hidden");
    chatPage.classList.remove("hidden");
}

/* ================= 送信 ================= */

async function send() {
    const text = msg.value;
    if (!text) return;

    await sb.from("messages").insert({
        room_id: currentRoom,
        sender: user.id,
        text,
        read_by: [user.id]
    });

    msg.value = "";
}

/* ================= メッセージ取得 ================= */

async function loadMessages() {
    const { data } = await sb
        .from("messages")
        .select("*")
        .eq("room_id", currentRoom)
        .order("id");

    messages.innerHTML = "";
    lastSender = null;

    data.forEach(m => renderMessage(m));
}

/* ================= 描画 ================= */

function renderMessage(m) {

    const div = document.createElement("div");

    const isMe = m.sender === user.id;

    let cls = isMe ? "me" : "them";

    if (!isMe && lastSender === m.sender) {
        cls += " square";
    }

    div.className = "bubble " + cls;

    div.innerHTML = `
        ${m.text}
        <div class="reactions">${renderReactions(m.reactions)}</div>
    `;

    div.onclick = (e) => {
        currentMsgId = m.id;

        $("#reactionPicker").css({
            display: "block",
            left: e.pageX + "px"
        });
    };

    messages.appendChild(div);

    lastSender = m.sender;
}


/* ================= 既読 ================= */

async function markRead() {

    const { data } = await sb
        .from("messages")
        .select("*")
        .eq("room_id", currentRoom);

    for (let m of data) {

        if (!m.read_by?.includes(user.id)) {

            const updated = [...(m.read_by || []), user.id];

            await sb.from("messages")
                .update({ read_by: updated })
                .eq("id", m.id);
        }
    }
}

async function addReaction(messageId, emoji) {

    const { data } = await sb
        .from("messages")
        .select("reactions")
        .eq("id", messageId)
        .single();

    let reactions = data?.reactions || {};

    if (!reactions[emoji]) {
        reactions[emoji] = [];
    }

    // 同じユーザーが2回押さないように
    if (!reactions[emoji].includes(user.id)) {
        reactions[emoji].push(user.id);
    }

    await sb.from("messages")
        .update({ reactions })
        .eq("id", messageId);
}

/* ================= リアルタイム ================= */
function renderReactions(reactions) {
    if (!reactions) return "";

    return Object.entries(reactions)
        .map(([emoji, users]) => {
            return `<br><br><span>${emoji} ${users.length}</span>`;
        })
        .join(" ");
}

function realtime() {

    sb.channel("chat")
        .on("postgres_changes", {
            event: "*",
            schema: "public",
            table: "messages"
        }, payload => {

            if (payload.new.room_id === currentRoom) {
                loadMessages();
            }

            loadChats();
        })
        .subscribe();
}

init();