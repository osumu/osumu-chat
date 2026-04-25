const client = supabase.createClient("https://acebtnoxoijpurwvpisr.supabase.co", "sb_publishable_zgLg3lODrTUNc2JDa1aoXA_epBmQ3Zx");

let user = null;
let currentRoom = null;
let channel = null;
let sending = false;

const audio = new Audio("public/notification.mp3");

// ===============================
// 起動
// ===============================
window.onload = async () => {
    const { data } = await client.auth.getSession();

    if (!data.session) {
        location.href = "accounts/signup.html";
        return;
    }

    user = data.session.user;

    if ("Notification" in window && Notification.permission !== "granted") {
        Notification.requestPermission();
    }

    await registerDevice();
    await ensureProfile();
    await checkInvite();
    await loadChats();
    applySettings();
    applyIcon();

    if (!localStorage.getItem("avatar_prompt_shown")) {
        showAvatarPrompt();
    }


    subscribeMessages();
};

function showAvatarPrompt() {
    Swal.fire({
        title: "ようこそ！",
        html: `<button class="btn btn-success" id="sa">アバターを設定しましょう！</button>`,
        icon: "data:image/svg+xml,%3Csvg%20width%3D%2232%22%20height%3D%2232%22%20viewBox%3D%220%200%2064%2064%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Ccircle%20cx%3D%2232%22%20cy%3D%2232%22%20r%3D%2228%22%20fill%3D%22none%22%20stroke%3D%22currentColor%22%20stroke-width%3D%224%22/%3E%3Ccircle%20cx%3D%2223%22%20cy%3D%2226%22%20r%3D%224%22%20fill%3D%22currentColor%22/%3E%3Cpath%20d%3D%22M38%2026%20Q42%2022%2046%2026%22%20stroke%3D%22currentColor%22%20stroke-width%3D%224%22%20fill%3D%22none%22%20stroke-linecap%3D%22round%22/%3E%3Cpath%20d%3D%22M22%2040%20Q32%2048%2042%2040%22%20stroke%3D%22currentColor%22%20stroke-width%3D%224%22%20fill%3D%22none%22%20stroke-linecap%3D%22round%22/%3E%3C/svg%3E",
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

    // タブ開いてる
    if (document.visibilityState === "visible") {
        Swal.fire({
            toast: true,
            position: "top-end",
            timer: 3000,
            showConfirmButton: false,
            title: "新着メッセージ",
            text: msg.content || "新しいメッセージ"
        });
        return;
    }

    // 通知許可チェック
    if (Notification.permission !== "granted") {
        Notification.requestPermission();
        return;
    }

    new Notification("新着メッセージ", {
        body: msg.content || "新しいメッセージ"
    });
}

// ===============================
// プロフィール
// ===============================
async function ensureProfile() {
    const username = localStorage.getItem("username") || "user";

    const { data, error } = await client
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

    if (data) return;

    if (error) {
        Swal.fire("エラー", `エラーが発生しました：${error.message}`, "error")
    }

    const pin = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");

    await client.from("profiles").insert({
        id: user.id,
        username,
        name: username,
        pin,
        avatar: null
    });
}

// ===============================
// チャット一覧
// ===============================
async function loadChats() {
    try {
        const { data: members, error } = await client
            .from("room_members")
            .select("room_id, user_id")
            .eq("user_id", user.id);

        if (error) {
            swalError("部屋一覧取得失敗");
            return;
        }

        const roomIds = (members || []).map(v => v.room_id);

        if (roomIds.length === 0) {
            document.getElementById("chatList").innerHTML =
                `<p>まだ相手がいません。</p>`;
            return;
        }

        const { data: rooms } = await client
            .from("rooms")
            .select("*")
            .in("id", roomIds)
            .order("created_at", { ascending: false });

        const { data: msgs } = await client
            .from("messages")
            .select("*")
            .in("room_id", roomIds)
            .order("created_at", { ascending: true });

        const { data: profiles } = await client
            .from("profiles")
            .select("id, avatar, name");

        let html = "";

        for (const r of rooms || []) {

            const roomMembers = members.filter(m => m.room_id === r.id);

            const otherId = roomMembers.find(m => m.user_id !== user.id)?.user_id;
            const p = profiles?.find(p => p.id === otherId);

            const roomMsgs = msgs.filter(m => m.room_id === r.id);
            const last = roomMsgs[roomMsgs.length - 1];

            const unread = roomMsgs.filter(
                m => m.sender_id !== user.id &&
                    !m.read_by?.includes(user.id)
            ).length;

            html += `
                <div class="chat-item"
                    onclick="openRoom('${r.id}','${escapeHTML(r.name)}')">

                    <div class="avatar">
                        ${p?.avatar || "👤"}
                    </div>

                    <div style="flex:1">
                        <b>${escapeHTML(r.name)}</b><br>
                        <small>
                            ${escapeHTML(last?.content || "メッセージなし")}
                        </small>
                    </div>

                    <div>
                        ${unread > 0 ? `<span class="badge bg-danger">${unread}</span>` : ""}
                    </div>

                </div>
            `;
        }

        document.getElementById("chatList").innerHTML = html;

    } catch (e) {
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

    (messages || []).forEach(m => {

        const isMe = m.sender_id === user.id;

        const avatar = getMessageAvatar(m, profiles);

        let cls = isMe ? "bubble-me" : "bubble-you";

        if (!isMe && lastUser === m.sender_id) {
            cls += " square";
        }

        html += `
            <div class="${cls}">

                ${!isMe ? `<div class="avatar-inline">${avatar}</div>` : ""}

                ${escapeHTML(m.content || "")}

                <div class="meta">
                    ${formatDate(m.created_at)}
                </div>
            </div>
            <div style="clear:both"></div>
        `;

        lastUser = m.sender_id;
    });

    document.getElementById("messages").innerHTML = html;
}

// ===============================
// 一括既読
// ===============================
async function markAsReadBatch() {
    const { data, error } = await client
        .from("messages")
        .select("id,read_by")
        .eq("room_id", currentRoom);

    if (error) return;

    const list = (data || []).filter(
        m => !m.read_by?.includes(user.id)
    );

    await Promise.all(
        list.map(m =>
            client
                .from("messages")
                .update({
                    read_by: [
                        ...(m.read_by || []),
                        user.id,
                    ],
                })
                .eq("id", m.id)
        )
    );
}

// ===============================
// 送信
// ===============================
async function sendMsg() {
    if (sending) return;

    const input =
        document.getElementById("msgInput");

    const file =
        document.getElementById("fileInput")
            .files[0];

    if (!input.value && !file) return;

    sending = true;

    const btn =
        document.getElementById("sendBtn");

    if (btn) btn.disabled = true;

    try {
        let fileUrl = null;

        if (file) {
            const path =
                crypto.randomUUID() +
                "_" +
                file.name;

            const { error } =
                await client.storage
                    .from("files")
                    .upload(path, file);

            if (error) {
                swalError("アップロード失敗");
                return;
            }

            const { data } =
                client.storage
                    .from("files")
                    .getPublicUrl(path);

            fileUrl = data.publicUrl;
        }

        const { error } = await client
            .from("messages")
            .insert({
                room_id: currentRoom,
                sender_id: user.id,
                content: input.value,
                file_url: fileUrl,
                read_by: [user.id],
            });

        if (error) {
            swalError("送信失敗");
            return;
        }

        input.value = "";
        document.getElementById(
            "fileInput"
        ).value = "";

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

                // 自分以外のメッセージ通知
                if (msg.sender_id !== user.id) {

                    const s = JSON.parse(localStorage.getItem("settings") || "{}");

                    notifyMessage(msg);

                    if (s.notify !== "silent") {
                        audio.play().catch(() => { });
                    }
                }

                // 現在開いてるルームなら更新
                if (currentRoom && msg.room_id === currentRoom) {
                    loadMessages();
                }

                // チャット一覧更新
                loadChats();
            }
        )
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

                <button class="btn btn-sm"
                    onclick="Swal.close()">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>

            <p>PINコードを入力</p>
            <input id="pinInput"
                class="form-control">

            <p class="mt-3">もしくは</p>

            <button class="btn btn-primary w-100"
                onclick="scanQR()">
                QRコードを読み込み
            </button>

        </div>
        `,
    }).then(async res => {
        if (!res.isConfirmed) return;

        const pin =
            document
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
    try {
        const { data: profile, error: pErr } = await client
            .from("profiles")
            .select("*")
            .eq("pin", pin)
            .maybeSingle();

        if (pErr) throw pErr;
        if (!profile) {
            return Swal.fire("エラー", "ユーザーが見つかりません", "error");
        }

        const { data: myRooms } = await client
            .from("room_members")
            .select("room_id")
            .eq("user_id", user.id);

        const roomIds = (myRooms || []).map(r => r.room_id);

        let existingRoom = null;

        if (roomIds.length > 0) {
            const { data: members } = await client
                .from("room_members")
                .select("*")
                .in("room_id", roomIds);

            for (const roomId of roomIds) {
                const users = members
                    .filter(m => m.room_id === roomId)
                    .map(m => m.user_id);

                if (
                    users.length === 2 &&
                    users.includes(user.id) &&
                    users.includes(profile.id)
                ) {
                    existingRoom = roomId;
                    break;
                }
            }
        }

        if (existingRoom) {
            openRoom(existingRoom, profile.name);
            return;
        }

        const { data: room, error: rErr } = await client
            .from("rooms")
            .insert({
                name: profile.name,
                is_group: false
            })
            .select()
            .single();

        if (rErr) throw rErr;

        const { error: mErr } = await client
            .from("room_members")
            .insert({
                room_id: room.id,
                user_id: user.id
            });

        if (mErr) throw mErr;

        const payload = btoa(JSON.stringify({
            room_id: room.id
        }));

        Swal.fire({
            title: "相手に送ってください",
            html: `
                <p>このQRまたは文字を相手に送ってください</p>
                <textarea class="form-control">${payload}</textarea>
            `
        });

        loadChats();

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
        <div class="text-start">

            <!-- ヘッダー -->
            <div class="d-flex align-items-center mb-3">
                <button class="btn btn-sm me-2" onclick="Swal.close()">
                    <i class="bi bi-arrow-left"></i>
                </button>
                <h2 class="m-0">設定</h2>
            </div>

            <!-- テーマ -->
            <p>テーマカラー</p>
            <select id="themeSelect" class="form-control mb-3">
                <option value="light">ライト</option>
                <option value="dark">ダーク</option>
                <option value="auto">自動</option>
                <option value="custom">カスタムカラー</option>
            </select>

            <!-- アクセント -->
            <p>アクセントカラー</p>
            <input id="accentColor" type="color" class="form-control form-control-color mb-3">

            <!-- 背景 -->
            <p>背景色 / 壁紙</p>
            <input id="bgColor" type="color" class="form-control form-control-color mb-2">

            <div id="dropZone"
                style="border:2px dashed #ccc;padding:15px;text-align:center;border-radius:10px;margin-bottom:15px;">
                ここに画像をドロップ or クリックしてアップロード
                <input type="file" id="bgFile" hidden>
            </div>

            <!-- 吹き出し -->
            <p>メッセージ気泡の形</p>
            <div class="d-flex flex-wrap gap-2 mb-3">
                ${[1, 2, 3, 4, 5, 6, 7].map(i => `
                    <div class="bubble-style" data-style="${i}"
                        style="width:60px;height:40px;border-radius:${i * 3}px;background:#eee;cursor:pointer;">
                    </div>
                `).join("")}
            </div>

            <!-- 角丸 -->
            <p>角丸度</p>
            <input id="radiusRange" type="range" min="0" max="30" value="15" class="form-range mb-3">

            <!-- 通知 -->
            <p>新着メッセージ通知</p>
            <select id="notifySelect" class="form-control mb-3">
                <option value="on">オン</option>
                <option value="off">オフ</option>
                <option value="silent">サイレント</option>
            </select>

            <!-- 自動削除 -->
            <p>メッセージ自動削除</p>
            <select id="autoDelete" class="form-control mb-3">
                <option value="0">無期限</option>
                <option value="1">24h</option>
                <option value="7">7日</option>
                <option value="30">30日</option>
            </select>

            <!-- 名前 -->
            <p>表示名</p>
            <input id="displayName" class="form-control mb-3">

            <!-- アイコン -->
            <p class="asection">アイコン画像</p>
            <button class="btn btn-outline-primary mb-2" onclick="openIconPicker()">
                アイコン選択
            </button>

            <input type="file" id="iconUpload" class="form-control mb-3">

            <!-- デバイス -->
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

            // ドラッグ&ドロップ
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

            // 吹き出し選択
            document.querySelectorAll(".bubble-style").forEach(el => {
                el.onclick = () => {
                    document.querySelectorAll(".bubble-style")
                        .forEach(x => x.style.outline = "none");

                    el.style.outline = "3px solid green";

                    localStorage.setItem("bubbleStyle", el.dataset.style);
                };
            });

            const input = document.getElementById("iconUpload");

            input.addEventListener("change", async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                await saveIconFromFile(file);
            });
        }
    });
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
                    <button class="btn btn-sm" onclick="Swal.close()">
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>

                <div id="iconPicker"></div>

                <div class="mt-3 text-center">
                    <button class="btn btn-success" onclick="saveIcon()">決定</button>
                </div>
            </div>
        `,
        didOpen: () => {
            window.iconPicker = new UniversalIconPicker({
                container: "#iconPicker",
                theme: "light",
                size: 32
            });
        }
    });
}

async function saveIcon() {
    const selected = window.iconPicker.getSelected();

    if (!selected) {
        Swal.fire("選択してください");
        return;
    }

    await client
        .from("profiles")
        .update({ avatar: selected })
        .eq("id", user.id);

    applyIcon();
    Swal.close();
}

async function applyIcon() {
    const { data } = await client
        .from("profiles")
        .select("avatar")
        .eq("id", user.id)
        .maybeSingle();

    if (!data?.avatar) return;

    document.querySelectorAll(".avatar").forEach(el => {
        el.innerHTML = data.avatar;
        el.style.display = "flex";
        el.style.alignItems = "center";
        el.style.justifyContent = "center";
        el.style.fontSize = "20px";
    });
}


async function uploadAvatar(file) {
    const path = `avatars/${user.id}/${crypto.randomUUID()}_${file.name}`;

    const { error } = await client.storage
        .from("files")
        .upload(path, file);

    if (error) throw error;

    const { data } = client.storage
        .from("files")
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
    if (!avatar) return "👤";

    if (avatar.startsWith("http")) {
        return `<img src="${avatar}" style="width:32px;height:32px;border-radius:50%">`;
    }

    return avatar; // 絵文字
}

function handleBgFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
        document.body.style.backgroundImage = `url(${reader.result})`;
        localStorage.setItem("bgImage", reader.result);
    };
    reader.readAsDataURL(file);
}

function saveSettings() {
    const settings = {
        theme: document.getElementById("themeSelect").value,
        accent: document.getElementById("accentColor").value,
        bgColor: document.getElementById("bgColor").value,
        radius: document.getElementById("radiusRange").value,
        notify: document.getElementById("notifySelect").value,
        autoDelete: document.getElementById("autoDelete").value,
        name: document.getElementById("displayName").value
    };

    localStorage.setItem("settings", JSON.stringify(settings));

    applySettings();

    Swal.fire("保存しました", "", "success");
}

function applySettings() {
    const s = JSON.parse(localStorage.getItem("settings") || "{}");

    if (s.accent) {
        document.documentElement.style.setProperty("--accent", s.accent);
    }

    if (s.bgColor) {
        document.body.style.background = s.bgColor;
    }

    if (s.radius) {
        document.querySelectorAll(".bubble").forEach(b => {
            b.style.borderRadius = s.radius + "px";
        });
    }

    if (s.theme === "dark") {
        document.body.style.background = "#111";
        document.body.style.color = "#fff";
    }

    if (s.theme === "light") {
        document.body.style.background = "#e5ddd5";
        document.body.style.color = "#000";
    }
}

// ===============================
// その他
// ===============================
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

// ===============================
// ファイル表示
// ===============================
function loadFile(url) {
    const safe = escapeHTML(url);
    const lower = url.toLowerCase();

    if (
        lower.match(
            /\.(png|jpg|jpeg|gif|webp)$/
        )
    ) {
        Swal.fire({
            html: `<img src="${safe}" style="width:100%">`,
            showConfirmButton: false,
        });
        return;
    }

    if (
        lower.match(
            /\.(mp4|webm)$/
        )
    ) {
        Swal.fire({
            html: `
            <video controls style="width:100%">
                <source src="${safe}">
            </video>
            `,
            showConfirmButton: false,
        });
        return;
    }

    if (lower.endsWith(".pdf")) {
        Swal.fire({
            html: `
            <iframe src="${safe}"
                style="width:100%;height:80vh">
            </iframe>
            `,
            showConfirmButton: false,
        });
        return;
    }

    window.open(url, "_blank");
}

