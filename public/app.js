const client = supabase.createClient("https://acebtnoxoijpurwvpisr.supabase.co", "sb_publishable_zgLg3lODrTUNc2JDa1aoXA_epBmQ3Zx");

let user = null;
let currentRoom = null;

const audio = new Audio("public/notification.mp3");

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

function formatDate(date) {
    const d = new Date(date);
    return d.getFullYear().toString().slice(2) + "/" +
        (d.getMonth() + 1).toString().padStart(2, "0") + "/" +
        d.getDate().toString().padStart(2, "0") + " " +
        d.getHours().toString().padStart(2, "0") + ":" +
        d.getMinutes().toString().padStart(2, "0");
}

async function ensureProfile() {
    const username = localStorage.getItem("username");

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

async function loadChats() {
    const { data: rooms } = await client.from("rooms").select("*");

    let html = "";

    for (const r of rooms) {

        const { data: msgs } = await client
            .from("messages")
            .select("*")
            .eq("room_id", r.id);

        const last = msgs?.[msgs.length - 1];

        const unread = msgs.filter(m =>
            !m.read_by?.includes(user.id) &&
            m.sender_id !== user.id
        ).length;

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

    </div>`;
    }

    if (!html) {
        html = `<p>まだ相手がいません。右上の追加ボタンで話し相手を追加しましょう。</p>`;
    }

    document.getElementById("chatList").innerHTML = html;
}

function openRoom(id, name) {
    currentRoom = id;

    document.getElementById("chatUser").innerText = name;
    document.getElementById("chatListPage").style.display = "none";
    document.getElementById("chatRoom").style.display = "block";

    loadMessages();
}

// 戻る
function backList() {
    document.getElementById("chatRoom").style.display = "none";
    document.getElementById("chatListPage").style.display = "block";
}

async function loadMessages() {

    const { data } = await client
        .from("messages")
        .select("*")
        .eq("room_id", currentRoom)
        .order("created_at", { ascending: true });

    let html = "";
    let lastUser = null;

    data.forEach(m => {

        const isMe = m.sender_id === user.id;

        let cls = isMe ? "bubble-me" : "bubble-you";

        if (!isMe && lastUser === m.sender_id) {
            cls += " square";
        }

        let readMark = "";

        if (isMe) {
            readMark = (m.read_by && m.read_by.length > 1) ? "✔✔" : "✔";
        }

        html += `
    <div class="${cls}">
      ${m.content || ""}
      ${m.file_url ? `<a href="${m.file_url}" target="_blank">📎</a>` : ""}
      <div class="meta">${formatDate(m.created_at)} ${readMark}</div>
    </div>
    <div style="clear:both"></div>
    `;

        lastUser = m.sender_id;
    });

    document.getElementById("messages").innerHTML = html;

    markAsRead();
}

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

async function sendMsg() {
    const input = document.getElementById("msgInput");
    const file = document.getElementById("fileInput").files[0];

    if (!input.value && !file) return;

    let fileUrl = null;

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

// ===============================
// リアルタイム
// ===============================
function subscribeMessages() {

    client
        .channel("messages")
        .on("postgres_changes", {
            event: "INSERT",
            schema: "public",
            table: "messages"
        }, payload => {

            const msg = payload.new;

            if (msg.room_id === currentRoom) {
                loadMessages();
            }

            if (msg.sender_id !== user.id) {
                audio.play();
            }

            loadChats();
        })
        .subscribe();
}

async function openAdd() {

    Swal.fire({
        title: "追加",
        html: `
            <button class="btn btn-primary w-100 mb-2" onclick="scanQR()"><i class="bi bi-qr-code-scan"></i><small>QRコードをスキャン</small></button>
            <input id="pinInput" class="form-control" placeholder="PIN">
        `,
        confirmButtonText: "追加"
    }).then(async res => {

        if (!res.isConfirmed) return;

        const pin = document.getElementById("pinInput").value.trim();
        if (!pin) return;

        await addByPin(pin);
    });
}

async function addByPin(pin) {
    const { data } = await client
        .from("profiles")
        .select("*")
        .eq("pin", pin)
        .single();

    if (!data) {
        Swal.fire("見つからない");
        return;
    }

    const { data: room } = await client
        .from("rooms")
        .insert({ name: data.name })
        .select()
        .single();

    await client.from("room_members").insert([
        { room_id: room.id, user_id: user.id },
        { room_id: room.id, user_id: data.id }
    ]);

    Swal.fire("追加完了");
    loadChats();
}
function scanQR() {
    Swal.fire({
        title: "QRコードをスキャン",
        html: `<div id="qrReader" style="width: 250px; margin:auto;"></div>`,
        didOpen: () => {
            const qr = new Html5Qrcode("qrReader");

            qr.start(
                { facingMode: "environment" },
                { fps: 10, qrbox: 200 },
                async (decoded) => {
                    qr.stop();
                    Swal.close();

                    if (decoded.includes("/add.html?data=")) {
                        location.href = decoded;
                        return;
                    }

                    Swal.fire("不正なQRコードです");
                }
            );
        }
    });
}

function addQR() {
    const myPin = localStorage.getItem("username");

    const payload = {
        from: myPin,
        to: null,
        room_id: null
    };

    const base64 = btoa(JSON.stringify(payload));
    const url = `${location.origin}/add.html?data=${base64}`;

    Swal.fire({
        title: "あなたのQRコード",
        html: `<canvas id="myQR"></canvas>`,
        didOpen: () => {
            QRCode.toCanvas(document.getElementById("myQR"), url);
        }
    });
}

function showQR() {
    const myPin = localStorage.getItem("username");

    const payload = {
        from: myPin,
        to: null,
        room_id: currentRoom
    };

    const base64 = btoa(JSON.stringify(payload));
    const url = `${location.origin}/add.html?data=${base64}`;

    Swal.fire({
        title: "招待QRコード",
        html: `<canvas id="qrcode"></canvas>`,
        didOpen: () => {
            QRCode.toCanvas(document.getElementById("qrcode"), url);
        }
    });
}

async function openSettings() {
    const newName = await Swal.fire({
        title: "ルーム名変更",
        input: "text",
        inputPlaceholder: "新しいルーム名",
        showCancelButton: true
    });

    if (!newName.value) return;

    await client
        .from("rooms")
        .update({ name: newName.value })
        .eq("id", currentRoom);

    Swal.fire("変更しました");
    loadChats();
}

async function addMemberToGroup() {
    Swal.fire({
        title: "メンバー追加",
        html: `
            <button class="btn btn-primary w-100 mb-2" onclick="scanQR()"><i class="bi bi-qr-code-scan"></i><small>QRコードをスキャン</small></button>
            <input id="pinInput2" class="form-control" placeholder="PINを入力">
        `,
        confirmButtonText: "追加"
    }).then(async res => {
        if (!res.isConfirmed) return;

        const pin = document.getElementById("pinInput2").value.trim();
        if (!pin) return;

        const { data } = await client
            .from("profiles")
            .select("*")
            .eq("pin", pin)
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

async function checkInvite() {

    const params = new URLSearchParams(location.search);
    const roomId = params.get("room");

    if (!roomId) return;

    await client.from("room_members").insert({
        room_id: roomId,
        user_id: user.id
    });

    Swal.fire("参加しました");

    history.replaceState(null, null, "/");
}

async function leaveGroup() {

    await client
        .from("room_members")
        .delete()
        .eq("room_id", currentRoom)
        .eq("user_id", user.id);

    Swal.fire("退出しました");

    backList();
    loadChats();
}
