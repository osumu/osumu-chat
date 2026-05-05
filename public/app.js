const client = supabase.createClient("https://acebtnoxoijpurwvpisr.supabase.co", "sb_publishable_zgLg3lODrTUNc2JDa1aoXA_epBmQ3Zx");

let user = null;
window.currentRoom = null;
let channel = null;
let sending = false;

const audio = new Audio("public/notification.mp3");

// ===============================
// 起動
// ===============================
window.onload = async () => {
    const { data: { session } } = await client.auth.getSession();

    if (!session) {
        location.href = "accounts/signup.html";
        return;
    }

    const { data: { user: authUser }, error } = await client.auth.getUser();

    if (error || !authUser) {
        await client.auth.signOut();
        localStorage.clear();
        location.href = "accounts/signup.html";
        return;
    }


    user = data.session.user;

    document.getElementById("deleteBtn").onclick = () => {
        confirmDeleteRoom(window.currentRoom);
    };


    await registerDevice();
    await ensureProfile();
    await checkInvite();
    await loadChats();
    checkNotificationPermission();
    applySettings();
    applyIcon();

    if (!localStorage.getItem("avatar_prompt_shown")) {
        showAvatarPrompt();
    }


    subscribeMessages();
};


async function checkNotificationPermission() {
    if (!("Notification" in window)) return;

    const asked = localStorage.getItem("notifAsked");

    if (Notification.permission !== "default" || asked) return;

    Swal.fire({
        title: "通知を有効にしますか？",
        text: "新着メッセージを受け取れます",
        showCancelButton: true,
        confirmButtonText: "許可",
    }).then(async (res) => {
        if (!res.isConfirmed) return;

        const perm = await Notification.requestPermission();
        localStorage.setItem("notifAsked", "1");

        if (perm === "granted") {
            Swal.fire("有効になりました", "", "success");
        }
    });
}

function showAvatarPrompt() {
    Swal.fire({
        title: `<img src="data:image/svg+xml,%3Csvg%20width%3D%2232%22%20height%3D%2232%22%20viewBox%3D%220%200%2064%2064%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Ccircle%20cx%3D%2232%22%20cy%3D%2232%22%20r%3D%2228%22%20fill%3D%22none%22%20stroke%3D%22currentColor%22%20stroke-width%3D%224%22/%3E%3Ccircle%20cx%3D%2223%22%20cy%3D%2226%22%20r%3D%224%22%20fill%3D%22currentColor%22/%3E%3Cpath%20d%3D%22M38%2026%20Q42%2022%2046%2026%22%20stroke%3D%22currentColor%22%20stroke-width%3D%224%22%20fill%3D%22none%22%20stroke-linecap%3D%22round%22/%3E%3Cpath%20d%3D%22M22%2040%20Q32%2048%2042%2040%22%20stroke%3D%22currentColor%22%20stroke-width%3D%224%22%20fill%3D%22none%22%20stroke-linecap%3D%22round%22/%3E%3C/svg%3E"><br><span>ようこそ！</span>`,
        html: `<button class="btn btn-success" id="sa">アバターを設定しましょう！</button>`,
        showConfirmButton: false,
        didOpen: () => {
            document.getElementById("sa").onclick = () => {
                localStorage.setItem("avatar_prompt_shown", "1");
                Swal.close();

                openSettings();
                // 少し待ってからスクロール
                setTimeout(() => {
                    const el = document.getElementById("asection");
                    if (!el) return;

                    el.scrollIntoView({
                        behavior: "smooth",
                        block: "center"
                    });
                }, 300);
            };
        }
    });
}

// ===============================
// 共通
// ===============================
function escapeHTML(str = "") {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatDate(date) {
    const d = new Date(date);

    return (
        d.getFullYear().toString().slice(2) +
        "/" +
        String(d.getMonth() + 1).padStart(2, "0") +
        "/" +
        String(d.getDate()).padStart(2, "0") +
        " " +
        String(d.getHours()).padStart(2, "0") +
        ":" +
        String(d.getMinutes()).padStart(2, "0")
    );
}

function swalError(msg) {
    Swal.fire("エラー", msg, "error");
}

function swalSuccess(msg) {
    Swal.fire("完了", msg, "success");
}

function encodeQR(obj) {
    return btoa(JSON.stringify(obj));
}

function decodeQR(str) {
    return JSON.parse(atob(str));
}

function notifyMessage(msg) {
    const s = JSON.parse(localStorage.getItem("settings") || "{}");

    if (s.notify === "off") return;

    const text = msg.content || "新しいメッセージ";

    if (document.visibilityState === "visible") {
        Swal.fire({
            toast: true,
            position: "top-end",
            timer: 3000,
            showConfirmButton: false,
            title: "新着メッセージ",
            text
        });
        return;
    }

    if (Notification.permission === "granted") {
        new Notification("新着メッセージ", { body: text });
    }
}

let myAvatar = null;

async function applyIcon(force = false) {
    const { data, error } = await client
        .from("profiles")
        .select("avatar")
        .eq("id", user.id)
        .maybeSingle();

    if (error) {
        console.error(error);
        return;
    }

    const avatar = data?.avatar ?? null;

    if (!force && myAvatar === avatar) {
        return;
    }

    myAvatar = avatar;

    const el = document.getElementById("myAvatar");
    if (el) {
        el.innerHTML = renderAvatar(avatar);
    }
}


// ===============================
// プロフィール
// ===============================
async function ensureProfile() {
    const username = localStorage.getItem("username") || "user";

    const { data, error } = await client
        .from("profiles")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();

    if (error) {
        console.error(error);
        return;
    }

    if (data) return;

    const pin = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");

    await client.from("profiles").insert({
        id: user.id,
        username,
        name: username,
        pin,
        avatar: `<i class="fa-solid fa-circle-user"></i>`
    });
}

// ===============================
// チャット一覧
// ===============================
async function loadChats() {
    try {
        const chatList = document.getElementById("chatList");

        const { data: members, error } = await client
            .from("room_members")
            .select("room_id, user_id")
            .eq("user_id", user.id);

        if (error) {
            swalError("部屋一覧取得失敗");
            return;
        }

        const roomIds = [...new Set((members || []).map(m => m.room_id))];

        if (!roomIds.length) {
            chatList.innerHTML = `<p>まだ相手がいません。</p>`;
            return;
        }

        const [{ data: rooms }, { data: lastMsgs }] = await Promise.all([
            client
                .from("rooms")
                .select("id, name, is_group, created_at")
                .in("id", roomIds)
                .order("created_at", { ascending: false }),

            client.rpc("get_last_messages", {
                room_ids: roomIds
            })
        ]);

        const { data: allMembers } = await client
            .from("room_members")
            .select("room_id, user_id")
            .in("room_id", roomIds);

        const otherIds = [];

        for (const room of rooms || []) {
            if (room.is_group) continue;

            const roomUsers = allMembers
                ?.filter(m => m.room_id === room.id);

            const other = roomUsers
                ?.find(m => m.user_id !== user.id);

            if (other) {
                otherIds.push(other.user_id);
            }
        }

        const uniqueOtherIds = [...new Set(otherIds)];

        const { data: profiles } = uniqueOtherIds.length
            ? await client
                .from("profiles")
                .select("id, avatar, name")
                .in("id", uniqueOtherIds)
            : { data: [] };

        const memberMap = new Map();

        for (const m of allMembers || []) {
            if (!memberMap.has(m.room_id)) {
                memberMap.set(m.room_id, []);
            }

            memberMap.get(m.room_id).push(m.user_id);
        }

        const profileMap = new Map(
            (profiles || []).map(p => [p.id, p])
        );

        const lastMap = new Map(
            (lastMsgs || []).map(m => [m.room_id, m])
        );

        let html = "";

        for (const room of rooms || []) {
            const last = lastMap.get(room.id);

            let name = room.name;
            let avatarHTML = `<i class="fa fa-circle-user"></i>`;

            if (!room.is_group) {
                const users = memberMap.get(room.id) || [];
                const otherId = users.find(id => id !== user.id);

                const profile = profileMap.get(otherId);

                name = profile?.name || room.name;
                avatarHTML = renderAvatar(profile?.avatar);
            }

            html += `
                <div class="chat-item"
                    onclick="openRoom('${room.id}','${escapeHTML(name)}')">

                    <div class="avatar">
                        ${avatarHTML}
                    </div>

                    <div style="flex:1">
                        <b>${escapeHTML(name)}</b><br>
                        <small>
                            ${escapeHTML(last?.content || "メッセージなし")}
                        </small>
                    </div>

                </div>
            `;
        }

        chatList.innerHTML = html;

    } catch (e) {
        console.error(e);
        swalError("一覧読み込み失敗");
    }
}

// ===============================
// ルーム開く
// ===============================
async function openRoom(id, name) {
    currentRoom = id;

    document.getElementById("chatListPage").style.display =
        "none";

    document.getElementById("chatRoom").style.display =
        "block";

    document.getElementById("chatUser").innerText = name;

    await client.from("room_members").upsert(
        {
            room_id: id,
            user_id: user.id,
        },
        {
            onConflict: "room_id,user_id",
        }
    );

    await loadMessages();
}

// ===============================
// 戻る
// ===============================
function backList() {
    document.getElementById("chatRoom").style.display =
        "none";

    document.getElementById("chatListPage").style.display =
        "block";

    currentRoom = null;
}

// ===============================
// メッセージ一覧
// ===============================
async function loadMessages() {
    if (!currentRoom) return;

    const { data: messages } = await client
        .from("messages")
        .select("*")
        .eq("room_id", currentRoom)
        .order("created_at", { ascending: true });

    const { data: profiles } = await client
        .from("profiles")
        .select("id, avatar");

    let html = "";
    let lastUser = null;

    for (const m of messages || []) {
        const isMe = m.sender_id === user.id;

        const avatar = getMessageAvatar(m, profiles);

        const style = localStorage.getItem("bubbleStyle") || "tail";

        let bubbleClass = `bubble ${isMe ? "me" : "you"} ${style}`;

        if (!isMe && lastUser === m.sender_id) {
            bubbleClass = bubbleClass.replace("tail", "");
        }

        html += `
            <div class="msg-row ${isMe ? "me" : "you"}">

                ${!isMe ? `<div class="avatar-inline">${avatar}</div>` : ""}

                <div class="${bubbleClass}">
                    <div class="text">${escapeHTML(m.content || "")}</div>
                    <div class="meta">${formatDate(m.created_at)}</div>
                </div>

            </div>
        `;

        lastUser = m.sender_id;
    }

    document.getElementById("messages").innerHTML = html;
}

// ===============================
// 一括既読
// ===============================
async function markAsReadBatch() {
    const { error } = await client.rpc("mark_messages_read", {
        p_room_id: currentRoom,
        p_user_id: user.id
    });

    if (error) console.error(error);
}

// ===============================
// 送信
// ===============================
async function sendMsg() {
    if (sending) return;

    const input = document.getElementById("msgInput");
    const fileInput = document.getElementById("fileInput");

    const file = fileInput?.files?.[0];

    if (!input.value && !file) return;

    sending = true;

    const btn = document.getElementById("sendBtn");
    if (btn) btn.disabled = true;

    try {
        let fileUrl = null;

        if (file) {
            const path = `${crypto.randomUUID()}_${file.name}`;

            const { error } = await client.storage
                .from("files")
                .upload(path, file);

            if (error) throw error;

            const { data } = client.storage
                .from("files")
                .getPublicUrl(path);

            fileUrl = data.publicUrl;
        }

        const { error } = await client.from("messages").insert({
            room_id: currentRoom,
            sender_id: user.id,
            content: input.value,
            file_url: fileUrl,
            read_by: [user.id]
        });

        if (error) throw error;

        input.value = "";
        if (fileInput) fileInput.value = "";

    } catch (e) {
        swalError(e.message);
    } finally {
        sending = false;
        if (btn) btn.disabled = false;
    }
}

// ===============================
// リアルタイム
// ===============================
function subscribeMessages() {
    if (channel) {
        client.removeChannel(channel);
    }

    channel = client.channel("chat-realtime")

        // ===============================
        // メッセージ受信
        // ===============================
        .on("postgres_changes", {
            event: "INSERT",
            schema: "public",
            table: "messages"
        }, (payload) => {

            const msg = payload.new;

            // 🔔 他人のメッセージのみ通知
            if (msg.sender_id !== user.id) {
                notifyMessage(msg);

                const s = JSON.parse(localStorage.getItem("settings") || "{}");

                if (s.notify !== "silent") {
                    audio.currentTime = 0;
                    audio.play().catch(() => { });
                }
            }

            // 📩 今開いてる部屋
            if (currentRoom && msg.room_id === currentRoom) {
                loadMessages();
                markAsReadBatch();
            }

            // 📋 一覧更新
            loadChats();
        })

        // ===============================
        // ルーム参加検知（重要）
        // ===============================
        .on("postgres_changes", {
            event: "INSERT",
            schema: "public",
            table: "room_members"
        }, (payload) => {

            const row = payload.new;

            if (row.user_id === user.id) {
                loadChats();

                Swal.fire({
                    toast: true,
                    position: "top-end",
                    timer: 2000,
                    showConfirmButton: false,
                    title: "新しいチャットに追加されました"
                });
            }
        })

        .subscribe();
}

// ===============================
// 追加
// ===============================
function openAdd() {
    Swal.fire({
        width: 420,
        confirmButtonText: "追加",
        html: `
        <div class="text-start">
            <div class="d-flex justify-content-between align-items-center mb-3">
                <h3 class="m-0">追加</h3>
                <button class="btn btn-sm" onclick="Swal.close()">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>

            <p>PINコード入力</p>
            <input id="pinInput" class="form-control" placeholder="6桁のPIN">
            <div id="pinResult" class="mt-2 small"></div>

            <div class="text-center my-3 text-muted">もしくは</div>

            <button id="qrBtn" class="btn btn-outline-primary w-100">
                QRコードで参加
            </button>

        </div>
        `,
        didOpen: () => {
            setupPinRealtimeCheck();
            document.getElementById("qrBtn").onclick = () => {
                Swal.close();
                scanQR();
            };
        }
    }).then(async res => {
        if (!res.isConfirmed) return;

        const pin = document.getElementById("pinInput").value.trim();

        if (!pin) return;

        await addByPin(pin);
    });
}

function getMessageAvatar(message, profiles) {
    const senderProfile = profiles?.find(
        p => p.id === message.sender_id
    );

    return renderAvatar(senderProfile?.avatar);
}

let pinTimer = null;

function setupPinRealtimeCheck() {
    const input = document.getElementById("pinInput");
    const result = document.getElementById("pinResult");

    input.addEventListener("input", () => {
        const pin = input.value.trim();

        result.innerHTML = "";

        if (pinTimer) clearTimeout(pinTimer);

        pinTimer = setTimeout(async () => {

            const { data, error } = await client
                .from("profiles")
                .select("id, name, avatar")
                .eq("pin", pin)
                .maybeSingle();

            if (error) {
                result.innerHTML = `<span class="text-danger">エラー</span>`;
                return;
            }

            if (!data) {
                result.innerHTML = `<span class="text-danger">ユーザーが見つかりません</span>`;
                return;
            }

            if (data.id === user.id) {
                result.innerHTML = `<span class="text-warning">自分は追加できません</span>`;
                return;
            }

            result.innerHTML = `
                <div class="d-flex align-items-center gap-2 mt-2">
                    <div class="avatar">
                        ${renderAvatar(data.avatar)}
                    </div>
                    <div>
                        <b>${escapeHTML(data.name)}</b><br>
                        <small class="text-success">追加できます</small>
                    </div>
                </div>
            `;

        }, 400); // デバウンス
    });
}

// ===============================
// PIN追加
// ===============================
async function addByPin(pin) {
    try {
        const { data: profile } = await client
            .from("profiles")
            .select("*")
            .eq("pin", pin)
            .maybeSingle();

        if (!profile) {
            return Swal.fire("エラー", "ユーザーが見つかりません", "error");
        }

        if (profile.id === user.id) {
            return Swal.fire("エラー", "自分は追加できません", "error");
        }

        const pairKey = [user.id, profile.id].sort().join("_");

        const { data: existing } = await client
            .from("rooms")
            .select("*")
            .eq("pair_key", pairKey)
            .maybeSingle();

        let room;

        if (existing) {
            room = existing;

            // 🔥 既存でも必ずメンバー復元
            await client.from("room_members").upsert([
                { room_id: room.id, user_id: user.id },
                { room_id: room.id, user_id: profile.id }
            ], {
                onConflict: "room_id,user_id"
            });

        } else {
            const { data: newRoom, error } = await client
                .from("rooms")
                .insert({
                    name: profile.name,
                    is_group: false,
                    pair_key: pairKey
                })
                .select()
                .single();

            if (error) throw error;

            room = newRoom;

            await client.from("room_members").insert([
                { room_id: room.id, user_id: user.id },
                { room_id: room.id, user_id: profile.id }
            ]);
        }

        openRoom(room.id, profile.name);

    } catch (e) {
        swalError(e.message);
    }
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

    const { data: room, error } =
        await client
            .from("rooms")
            .insert({
                name: value,
                is_group: true,
            })
            .select()
            .single();

    if (error) {
        swalError("作成失敗");
        return;
    }

    await client.from("room_members").insert({
        room_id: room.id,
        user_id: user.id,
    });

    swalSuccess("作成しました");
    loadChats();
}

// ===============================
// QR関連
// ===============================

async function handleQR(decoded) {
    try {
        const obj = decodeQR(decoded); // ←直接デコード

        if (obj.type === "add") {
            await addByPin(obj.pin);
        }

        if (obj.type === "invite") {
            await joinRoom(obj.room_id);
        }

    } catch (e) {
        Swal.fire("エラー", "QRが不正です", "error");
    }
}


async function addQR() {
    const { data } = await client
        .from("profiles")
        .select("pin")
        .eq("id", user.id)
        .single();

    const payload = encodeQR({
        type: "add",
        pin: data.pin
    });

    Swal.fire({
        title: '<span class="noselect">あなたのQR</span>',
        html: `<canvas id="myQR"></canvas>`,
        didOpen: () => {
            QRCode.toCanvas(
                document.getElementById("myQR"),
                payload
            );
        },
        draggable: true
    });
}

function showQR() {
    const payload = encodeQR({
        type: "invite",
        room_id: currentRoom
    });

    Swal.fire({
        title: "招待QR",
        html: `<canvas id="roomQR"></canvas>`,
        didOpen: () => {
            QRCode.toCanvas(
                document.getElementById("roomQR"),
                payload
            );
        }
    });
}

function scanQR() {
    Swal.fire({
        width: 420,
        showConfirmButton: false,
        html: `
        <div class="d-flex justify-content-between align-items-center mb-2">
            <button class="btn btn-sm" onclick="Swal.close()">
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

                    handleQR(decoded);
                }
            );
        }
    });
}

async function joinRoom(roomId) {
    await client
        .from("room_members")
        .upsert(
            {
                room_id: roomId,
                user_id: user.id,
            },
            {
                onConflict:
                    "room_id,user_id",
            }
        );

    swalSuccess("参加しました");
    loadChats();
}

// ===============================
// 設定
// ===============================
function openSettings() {
    Swal.fire({
        width: "650px",
        showConfirmButton: false,
        html: `
        <div class="text-start" id="settingsWrap">

            <div class="d-flex align-items-center mb-3">
                <button class="btn btn-sm me-2" onclick="Swal.close()">
                    ←
                </button>
                <h2 class="m-0">設定</h2>
            </div>

            <p>テーマカラー</p>
            <select id="themeSelect" class="form-control mb-3">
                <option value="light">ライト</option>
                <option value="dark">ダーク</option>
                <option value="auto">自動</option>
                <option value="custom">カスタムカラー</option>
            </select>

            <p>アクセントカラー</p>
            <input id="accentColor" type="color" class="form-control mb-3">

            <p>背景色 / 壁紙</p>
            <input id="bgColor" type="color" class="form-control mb-2">

            <div id="dropZone"
                style="border:2px dashed #ccc;padding:15px;text-align:center;border-radius:10px;margin-bottom:15px;">
                ここに画像をドロップ or <button class="btn btn-link">クリック</button>
                <input type="file" id="bgFile" hidden>
            </div>

            <p>メッセージ気泡の形</p>
            <div class="d-flex flex-wrap gap-2 mb-3">
                ${[1, 2, 3].map(i => `
                    <div class="bubble-style" data-style="${i}"
                        style="width:60px;height:40px;border-radius:${i === 1 ? 15 : i === 2 ? 999 : 6}px;background:#eee;cursor:pointer;">
                    </div>
                `).join("")}
            </div>

            <p>新着メッセージ通知</p>
            <select id="notifySelect" class="form-control mb-3">
                <option value="on">オン</option>
                <option value="off">オフ</option>
                <option value="silent">サイレント</option>
            </select>

            <p>メッセージ自動削除</p>
            <select id="autoDelete" class="form-control mb-3">
                <option value="0">無期限</option>
                <option value="1">24h</option>
                <option value="7">7日</option>
                <option value="30">30日</option>
            </select>

            <p>表示名</p>
            <input id="displayName" class="form-control mb-3">

            <p class="asection">アイコン画像</p>

            <button class="btn btn-outline-primary mb-2" onclick="openIconPicker()">
                アイコン選択
            </button>

            <input type="file" id="iconUpload" class="form-control mb-3">

            <p>接続デバイス管理</p>
            <button class="btn btn-outline-dark w-100" onclick="showDevices()">
                ログイン中の端末を見る
            </button>

            <div class="mt-4 text-center">
                <button class="btn btn-success" onclick="saveSettings()">保存</button>
            </div>

        </div>
        `,
        didOpen: () => {
            const s = JSON.parse(localStorage.getItem("settings") || "{}");

            document.getElementById("themeSelect").value = s.theme || "light";
            document.getElementById("accentColor").value = s.accent || "#28a745";
            document.getElementById("bgColor").value = s.bg || "#e5ddd5";
            document.getElementById("notifySelect").value = s.notify || "on";


            const dz = document.getElementById("dropZone");

            dz.onclick = () => document.getElementById("bgFile").click();

            dz.ondragover = e => {
                e.preventDefault();
                dz.style.borderColor = "green";
            };

            dz.ondrop = e => {
                e.preventDefault();
                dz.style.borderColor = "#ccc";
                handleBgFile(e.dataTransfer.files[0]);
            };

            document.getElementById("bgFile").onchange = e => {
                handleBgFile(e.target.files[0]);
            };

            const map = {
                "1": "tail",
                "2": "round",
                "3": "square"
            };

            const current = localStorage.getItem("bubbleStyle") || "tail";

            document.querySelectorAll(".bubble-style").forEach(el => {

                if (map[el.dataset.style] === current) {
                    el.style.outline = "3px solid green";
                }

                el.onclick = () => {
                    document.querySelectorAll(".bubble-style")
                        .forEach(x => x.style.outline = "none");

                    el.style.outline = "3px solid green";

                    localStorage.setItem("bubbleStyle", map[el.dataset.style]);
                };
            });

            const input = document.getElementById("iconUpload");

            input.addEventListener("change", async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                await saveIconFromFile(file);
            });

            setTimeout(() => {
                const target = document.querySelector(".asection");
                if (target) {
                    target.scrollIntoView({
                        behavior: "smooth",
                        block: "center"
                    });
                }
            }, 200);
        }
    });
}

function setBubbleStyle(style) {
    localStorage.setItem("bubbleStyle", style);
    loadMessages(); // 即反映
}

function getDeviceId() {
    let id = localStorage.getItem("device_id");

    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem("device_id", id);
    }

    return id;
}

async function registerDevice() {
    const deviceId = getDeviceId();

    const { data, error } = await client
        .from("devices")
        .select("*")
        .eq("user_id", user.id)
        .eq("device_id", deviceId)
        .maybeSingle();

    if (error) {
        console.error(error);
        return;
    }

    // 既にあるなら更新だけ
    if (data) {
        await client
            .from("devices")
            .update({
                last_seen: new Date().toISOString(),
                browser: platform.name,
                os: platform.os?.family
            })
            .eq("id", data.id);

        return;
    }

    // 無ければ作成
    await client.from("devices").insert({
        user_id: user.id,
        device_id: deviceId,
        browser: platform.name,
        os: platform.os?.family,
        last_seen: new Date().toISOString()
    });
}

async function showDevices() {
    const { data, error } = await client
        .from("devices")
        .select("*")
        .eq("user_id", user.id)
        .order("last_seen", { ascending: false });

    if (error) {
        swalError("取得失敗");
        return;
    }

    const html = (data || []).map(d => `
        <div style="padding:10px;border-bottom:1px solid #eee">
            <b>${escapeHTML(d.browser || "unknown")}</b><br>
            <small>${escapeHTML(d.os || "unknown")}</small><br>
            <small>最終アクセス: ${formatDate(d.last_seen)}</small>
        </div>
    `).join("");

    Swal.fire({
        title: "ログイン中の端末",
        html: html || "端末なし"
    });
}

async function logoutDevice() {
    const deviceId = getDeviceId();

    await client
        .from("devices")
        .delete()
        .eq("user_id", user.id)
        .eq("device_id", deviceId);

    await client.auth.signOut();
    location.href = "/";
}

function openIconPicker() {
    Swal.fire({
        width: 400,
        showConfirmButton: false,
        html: `
            <div class="text-start">
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <h3 class="m-0">アイコン選択</h3>
                    <button class="btn btn-sm" onclick="Swal.close()">✕</button>
                </div>

                <button id="iconPickerBtn" class="btn btn-outline-primary w-100 mb-3">
                    アイコンを選択
                </button>

                <div id="iconPreview" class="text-center"></div>
            </div>
        `,
        didOpen: () => {

            const options = {
                iconLibraries: ['font-awesome.min.json'],
                iconLibrariesCss: [
                    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.0.1/css/all.min.css'
                ],

                onSelect: async (icon) => {
                    document.getElementById("iconPreview").innerHTML = icon.iconHtml;

                    await client
                        .from("profiles")
                        .update({ avatar: icon.iconHtml })
                        .eq("id", user.id);

                    applyIcon();
                    Swal.close();
                }
            };

            window.iconPicker = new UniversalIconPicker(
                '#iconPickerBtn',
                options
            );
        }
    });
}

async function uploadAvatar(file) {
    const path = `${user.id}/${crypto.randomUUID()}_${file.name}`;

    const { error } = await client.storage
        .from("avatars")
        .upload(path, file);

    if (error) throw error;

    const { data } = client.storage
        .from("avatars")
        .getPublicUrl(path);

    return data.publicUrl;
}

async function saveIconFromFile(file) {
    const url = await uploadAvatar(file);

    await client
        .from("profiles")
        .update({ avatar: url })
        .eq("id", user.id);

    applyIcon();
}

function renderAvatar(avatar) {
    const fallback = `<i class="fa-solid fa-circle-user"></i>`;

    if (!avatar) return fallback;

    if (avatar.startsWith("http")) {
        return `
            <img src="${escapeHTML(avatar)}"
                style="width:32px;height:32px;border-radius:50%;object-fit:cover">
        `;
    }

    if (avatar.trim().startsWith("<i")) {
        return avatar;
    }

    return escapeHTML(avatar);
}

function handleBgFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
        const chat = document.getElementById("chatRoom");
        if (chat) {
            chat.style.backgroundImage = `url(${reader.result})`;
            chat.style.backgroundSize = "cover";
        }
        localStorage.setItem("bgImage", reader.result);
    };
    reader.readAsDataURL(file);
}

async function saveSettings() {
    const localSettings = {
        theme: document.getElementById("themeSelect").value,
        accent: document.getElementById("accentColor").value,
        bg: document.getElementById("bgColor").value,
        notify: document.getElementById("notifySelect").value,
        bubbleStyle: localStorage.getItem("bubbleStyle") || "tail"
    };

    localStorage.setItem("settings", JSON.stringify(localSettings));

    if (currentRoom) {
        const roomSettings = {
            auto_delete: Number(document.getElementById("autoDelete").value),
            display_name: document.getElementById("displayName").value
        };

        const { error } = await client
            .from("rooms")
            .update(roomSettings)
            .eq("id", currentRoom);

        if (error) {
            console.error(error);
            Swal.fire("保存失敗", "", "error");
            return;
        }
    }

    applySettings();

    Swal.fire("保存しました", "", "success");
}

function applySettings() {
    const s = JSON.parse(localStorage.getItem("settings") || "{}");
    const chat = document.getElementById("chatRoom");

    if (s.accent) {
        document.documentElement.style.setProperty("--accent", s.accent);
    }

    if (s.bg) {
        chat.style.background = s.bg;
    }

    // 壁紙
    const bgImage = localStorage.getItem("bgImage");
    if (bgImage) {
        chat.style.backgroundImage = `url(${bgImage})`;
        chat.style.backgroundSize = "cover";
        chat.style.backgroundPosition = "center";
    } else if (s.bg) {
        document.body.style.background = s.bg;
    }

    if (s.theme === "dark") {
        document.body.style.backgroundColor = "#111";
        document.body.style.color = "#fff";
    }

    if (s.theme === "light") {
        document.body.style.backgroundColor = "#e5ddd5";
        document.body.style.color = "#000";
    }
    loadMessages();
}

async function addMemberToGroup() {
    const { value } = await Swal.fire({
        title: "PIN入力",
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
        swalError("見つかりません");
        return;
    }

    await client.from("room_members").upsert(
        {
            room_id: currentRoom,
            user_id: data.id,
        },
        {
            onConflict:
                "room_id,user_id",
        }
    );

    swalSuccess("追加しました");
}

async function leaveGroup() {
    await client
        .from("room_members")
        .delete()
        .eq("room_id", currentRoom)
        .eq("user_id", user.id);

    backList();
    loadChats();
    swalSuccess("退出しました");
}

async function checkInvite() {
    const params =
        new URLSearchParams(
            location.search
        );

    const roomId =
        params.get("room");

    if (!roomId) return;

    await joinRoom(roomId);

    history.replaceState(
        null,
        null,
        "/"
    );
}

async function deleteRoom(roomId) {
    try {
        // ===============================
        // 1. ルーム情報取得
        // ===============================
        const { data: room } = await client
            .from("rooms")
            .select("*")
            .eq("id", roomId)
            .single();

        if (!room) {
            swalError("ルームが存在しません");
            return;
        }

        // ===============================
        // 2. メンバー取得（通知用）
        // ===============================
        const { data: members } = await client
            .from("room_members")
            .select("user_id")
            .eq("room_id", roomId);

        const userIds = (members || []).map(m => m.user_id);

        // ===============================
        // 3. RPCでDB一括削除
        // ===============================
        const { error } = await client.rpc("delete_room", {
            p_room_id: roomId,
            p_user_id: user.id
        });

        if (error) throw error;

        // ===============================
        // 4. ストレージ削除
        // ===============================
        await deleteRoomFiles(roomId);

        // ===============================
        // 5. 通知送信
        // ===============================
        await notifyRoomDeletion(room, userIds);

        swalSuccess("ルームを削除しました");

        backList();
        loadChats();

    } catch (e) {
        console.error(e);
        swalError(e.message || "削除失敗");
    }
}
async function notifyRoomDeletion(room, userIds) {
    const isGroup = room.is_group;

    const targets = userIds.filter(id => id !== user.id);

    if (targets.length === 0) return;

    const notifications = targets.map(uid => ({
        user_id: uid,
        title: "ルーム削除",
        content: isGroup
            ? `グループ「${room.name}」が削除されました`
            : "チャットルームが削除されました",
        created_at: new Date().toISOString()
    }));

    await client.from("notifications").insert(notifications);
}

async function deleteRoomFiles(roomId) {
    const { data: messages } = await client
        .from("messages")
        .select("file_url")
        .eq("room_id", roomId);

    const paths = (messages || [])
        .map(m => m.file_url)
        .filter(Boolean)
        .map(url =>
            url.split("/storage/v1/object/public/files/")[1]
        )
        .filter(Boolean);

    if (paths.length === 0) return;

    await client.storage
        .from("files")
        .remove(paths);
}

function confirmDeleteRoom(roomId) {
    if (!roomId) {
        Swal.fire("エラー", "ルームが選択されていません", "error");
        return;
    }

    Swal.fire({
        title: "ルーム削除",
        text: "本当に削除しますか？（復元できません）",
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "削除する",
        cancelButtonText: "キャンセル"
    }).then(res => {
        if (res.isConfirmed) {
            deleteRoom(roomId);
        }
    });
}

// ===============================
// ファイル表示
// ===============================
function renderImageGallery(urls) {
    let index = 0;

    Swal.fire({
        width: "90%",
        html: `
            <div style="text-align:center">
                <img id="galleryImg" src="${urls[0]}" style="max-width:100%;border-radius:10px">

                <div style="margin-top:10px">
                    <button id="prev">◀</button>
                    <span id="counter">1/${urls.length}</span>
                    <button id="next">▶</button>
                </div>
            </div>
        `,
        showConfirmButton: false,
        didOpen: () => {
            const img = document.getElementById("galleryImg");
            const counter = document.getElementById("counter");

            document.getElementById("prev").onclick = () => {
                index = (index - 1 + urls.length) % urls.length;
                img.src = urls[index];
                counter.innerText = `${index + 1}/${urls.length}`;
            };

            document.getElementById("next").onclick = () => {
                index = (index + 1) % urls.length;
                img.src = urls[index];
                counter.innerText = `${index + 1}/${urls.length}`;
            };
        }
    });
}

function renderPDF(url) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.6.347/pdf.worker.min.js";
    Swal.fire({
        width: "90%",
        html: `
            <canvas id="pdfCanvas"></canvas>
            <div>
                <button id="prevPage">←</button>
                <span id="pageNum"></span>
                <button id="nextPage">→</button>
            </div>
        `,
        showConfirmButton: false,
        didOpen: async () => {
            const pdf = await pdfjsLib.getDocument(url).promise;
            let page = 1;

            const canvas = document.getElementById("pdfCanvas");
            const ctx = canvas.getContext("2d");

            async function render(p) {
                const pageObj = await pdf.getPage(p);
                const viewport = pageObj.getViewport({ scale: 1.2 });

                canvas.height = viewport.height;
                canvas.width = viewport.width;

                await pageObj.render({ canvasContext: ctx, viewport }).promise;

                document.getElementById("pageNum").innerText =
                    `${p} / ${pdf.numPages}`;
            }

            document.getElementById("prevPage").onclick = () => {
                if (page > 1) render(--page);
            };

            document.getElementById("nextPage").onclick = () => {
                if (page < pdf.numPages) render(++page);
            };

            render(page);
        }
    });
}

function renderCode(url) {
    fetch(url)
        .then(r => r.text())
        .then(text => {

            Swal.fire({
                width: "80%",
                html: `
                    <pre><code id="codeBlock"></code></pre>
                `,
                showConfirmButton: false,
                didOpen: () => {
                    const el = document.getElementById("codeBlock");
                    el.textContent = text;

                    hljs.highlightElement(el);
                }
            });
        });
}




async function renderZip(url) {
    const res = await fetch(url);
    const blob = await res.blob();

    const zip = await JSZip.loadAsync(blob);

    let html = "<ul>";

    zip.forEach((path) => {
        html += `<li>${path}</li>`;
    });

    html += "</ul>";

    Swal.fire({
        width: "70%",
        html,
        showConfirmButton: false
    });
}


function renderDocx(url) {
    fetch(url)
        .then(r => r.arrayBuffer())
        .then(buffer => mammoth.convertToHtml({ arrayBuffer: buffer }))
        .then(result => {
            Swal.fire({
                html: `<div style="text-align:left">${result.value}</div>`,
                width: "80%"
            });
        });
}

const fileTypes = {
    image: [
        "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "heic"
    ],
    video: [
        "mp4", "webm", "mov", "mkv", "avi", "flv", "m4v", "ts"
    ],
    audio: [
        "mp3", "wav", "ogg", "aac", "m4a", "flac", "opus"
    ],
    pdf: ["pdf"],
    code: [
        "js", "ts", "jsx", "tsx", "html", "css", "json",
        "py", "java", "c", "cpp", "cs", "php", "go", "rb",
        "swift", "kt", "rs", "sh", "bash", "sql", "yaml", "yml", "xml", "md"
    ],
    archive: [
        "zip", "rar", "7z", "tar", "gz", "bz2"
    ],
    office: [
        "docx", "xlsx", "pptx", "doc", "xls", "ppt"
    ],
    executable: [
        "exe", "msi", "apk", "dmg", "pkg", "bat", "cmd", "sh", "appimage"
    ]
};

function loadFile(url) {
    const ext = url.split("?")[0].split(".").pop().toLowerCase();

    if (fileTypes.image.includes(ext)) return renderImage(url);
    if (fileTypes.video.includes(ext)) return renderVideo(url);
    if (fileTypes.audio.includes(ext)) return renderAudio(url);
    if (fileTypes.pdf.includes(ext)) return renderPDF(url);
    if (fileTypes.code.includes(ext)) return renderCode(url);
    if (fileTypes.archive.includes(ext)) return renderZip(url);
    if (fileTypes.office.includes(ext)) {
        if (ext === "docx") return renderDocx(url);
        if (ext === "xlsx") return renderXLSX(url);
    }

    if (fileTypes.executable.includes(ext)) {
        return Swal.fire({
            icon: "warning",
            title: "実行ファイル",
            text: "ダウンロードのみ可能です"
        }).then(() => window.open(url));
    }

    window.open(url);
}