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
    try {
        // 自分が所属している部屋一覧取得
        const { data: members, error: memberError } = await client
            .from("room_members")
            .select("room_id")
            .eq("user_id", user.id);

        if (memberError) {
            console.error(memberError);
            return;
        }

        const roomIds = (members || []).map(m => m.room_id);

        // 所属部屋なし
        if (roomIds.length === 0) {
            document.getElementById("chatList").innerHTML =
                `<p>まだ相手がいません。右上の＋ボタンで話し相手を追加しましょう。</p>`;
            return;
        }

        // 部屋取得
        const { data: rooms, error: roomError } = await client
            .from("rooms")
            .select("*")
            .in("id", roomIds)
            .order("created_at", { ascending: false });

        if (roomError) {
            console.error(roomError);
            return;
        }

        // メッセージ取得（一括）
        const { data: msgs, error: msgError } = await client
            .from("messages")
            .select("*")
            .in("room_id", roomIds)
            .order("created_at", { ascending: true });

        if (msgError) {
            console.error(msgError);
            return;
        }

        const messages = msgs || [];
        let html = "";

        for (const r of rooms || []) {
            const roomMsgs = messages.filter(m => m.room_id === r.id);

            const last = roomMsgs[roomMsgs.length - 1];

            const unread = roomMsgs.filter(m =>
                m.sender_id !== user.id &&
                !m.read_by?.includes(user.id)
            ).length;

            html += `
                <div class="chat-item"
                    onclick="openRoom('${r.id}','${escapeHTML(r.name)}')">

                    <div class="avatar"></div>

                    <div style="flex:1">
                        <b>${escapeHTML(r.name)}</b><br>
                        <small>
                            ${escapeHTML(last?.content || "メッセージなし")}
                        </small>
                    </div>

                    <div>
                        ${unread > 0
                    ? `<span class="badge bg-danger">${unread}</span>`
                    : ""
                }
                    </div>

                </div>
            `;
        }

        if (!html) {
            html = `<p>まだ相手がいません。右上の＋ボタンで話し相手を追加しましょう。</p>`;
        }

        document.getElementById("chatList").innerHTML = html;

    } catch (e) {
        console.error(e);

        document.getElementById("chatList").innerHTML =
            `<p>読み込みに失敗しました。</p>`;
    }
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

function openAdd() {
    Swal.fire({
        width: 420,
        showConfirmButton: true,
        confirmButtonText: "追加",
        html: `
      <div class="text-start">

        <div class="d-flex justify-content-between align-items-center mb-3">
          <h3 class="m-0">追加</h3>
          <button class="btn btn-sm" onclick="Swal.close()">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>

        <p>PINコードを入力</p>
        <input id="pinInput" class="form-control">

        <p class="mt-3">もしくは</p>

        <button class="btn btn-primary w-100"
          onclick="scanQR()">
          QRコードを読み込み
        </button>

      </div>
    `,
    }).then(async (res) => {
        if (!res.isConfirmed) return;

        const pin = document
            .getElementById("pinInput")
            .value.trim();

        if (!pin) return;

        await addByPin(pin);
    });
}

// ===============================
// PIN追加
// ===============================
async function addByPin(pin) {
    const { data: profile } = await client
        .from("profiles")
        .select("*")
        .eq("pin", pin)
        .single();

    if (!profile) {
        Swal.fire("見つかりません");
        return;
    }

    const { data: room } = await client
        .from("rooms")
        .insert({
            name: profile.name,
        })
        .select()
        .single();

    await client.from("room_members").insert([
        {
            room_id: room.id,
            user_id: user.id,
        },
        {
            room_id: room.id,
            user_id: profile.id,
        },
    ]);

    Swal.fire("追加しました");
    loadChats();
}

// ===============================
// グループ作成
// ===============================
async function createGroup() {
    const { value } = await Swal.fire({
        title: "グループ名",
        input: "text",
        showCancelButton: true,
    });

    if (!value) return;

    const { data: room } = await client
        .from("rooms")
        .insert({
            name: value,
        })
        .select()
        .single();

    await client.from("room_members").insert({
        room_id: room.id,
        user_id: user.id,
    });

    loadChats();
}

// ===============================
// QR表示（自分）
// ===============================
function addQR() {
    const pin =
        localStorage.getItem("username") || "user";

    const payload = btoa(
        JSON.stringify({
            type: "add",
            from: pin,
        })
    );

    const url =
        location.origin + "/add.html?data=" + payload;

    Swal.fire({
        title: "あなたのQR",
        html: `<canvas id="myQR"></canvas>`,
        didOpen: () => {
            QRCode.toCanvas(
                document.getElementById("myQR"),
                url
            );
        },
    });
}

// ===============================
// QR表示（招待）
// ===============================
function showQR() {
    const payload = btoa(
        JSON.stringify({
            room_id: currentRoom,
        })
    );

    const url =
        location.origin + "/add.html?data=" + payload;

    Swal.fire({
        title: "招待QR",
        html: `<canvas id="roomQR"></canvas>`,
        didOpen: () => {
            QRCode.toCanvas(
                document.getElementById("roomQR"),
                url
            );
        },
    });
}

// ===============================
// QR読み込み
// ===============================
function scanQR() {
    Swal.fire({
        width: 420,
        showConfirmButton: false,
        html: `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <button class="btn btn-sm" onclick="openAdd()">
          <i class="bi bi-arrow-left"></i>
        </button>
        <h3 class="m-0">読み込み</h3>
        <div style="width:32px"></div>
      </div>

      <div id="qrReader"></div>
    `,
        didOpen: () => {
            const qr = new Html5Qrcode("qrReader");

            qr.start(
                { facingMode: "environment" },
                { fps: 10, qrbox: 240 },
                async (decoded) => {
                    await qr.stop();
                    Swal.close();

                    try {
                        const raw = decoded.split("data=")[1];
                        const obj = JSON.parse(atob(raw));

                        if (obj.from) {
                            await addByPin(obj.from);
                        }

                        if (obj.room_id) {
                            await joinRoom(obj.room_id);
                        }
                    } catch {
                        Swal.fire("不正なQR");
                    }
                }
            );
        },
    });
}

// ===============================
// 招待参加
// ===============================
async function joinRoom(roomId) {
    await client.from("room_members").upsert(
        {
            room_id: roomId,
            user_id: user.id,
        },
        {
            onConflict: "room_id,user_id",
        }
    );

    Swal.fire("参加しました");
    loadChats();
}

// ===============================
// 設定
// ===============================
function openSettings() {
    Swal.fire({
        width: 520,
        showConfirmButton: false,
        html: `
      <div class="text-start">

        <button class="btn btn-sm mb-2"
          onclick="Swal.close()">
          <i class="bi bi-arrow-left"></i>
        </button>

        <h2>設定</h2>

        <p>テーマカラー</p>
        <select class="form-control mb-3">
          <option>ライト</option>
          <option>ダーク</option>
          <option>自動</option>
          <option>カスタムカラー</option>
        </select>

        <p>アクセントカラー</p>
        <input type="color"
          class="form-control form-control-color mb-3">

        <p>通知</p>
        <select class="form-control mb-3">
          <option>オン</option>
          <option>オフ</option>
          <option>サイレント</option>
        </select>

        <p>表示名</p>
        <input class="form-control">

      </div>
    `,
    });
}

// ===============================
// メンバー追加
// ===============================
async function addMemberToGroup() {
    const { value } = await Swal.fire({
        title: "追加するPIN",
        input: "text",
        showCancelButton: true,
    });

    if (!value) return;

    const { data } = await client
        .from("profiles")
        .select("*")
        .eq("pin", value)
        .single();

    if (!data) {
        Swal.fire("見つかりません");
        return;
    }

    await client.from("room_members").upsert(
        {
            room_id: currentRoom,
            user_id: data.id,
        },
        {
            onConflict: "room_id,user_id",
        }
    );

    Swal.fire("追加しました");
}

// ===============================
// 退出
// ===============================
async function leaveGroup() {
    await client
        .from("room_members")
        .delete()
        .eq("room_id", currentRoom)
        .eq("user_id", user.id);

    backList();
    loadChats();

    Swal.fire("退出しました");
}

// ===============================
// 招待確認
// ===============================
async function checkInvite() {
    const params = new URLSearchParams(
        location.search
    );

    const roomId = params.get("room");

    if (!roomId) return;

    await joinRoom(roomId);

    history.replaceState(null, null, "/");
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