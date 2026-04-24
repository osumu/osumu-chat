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
        pin
    });

    Swal.fire("プロフィールを自動作成しました");
}

// ===============================
// チャット一覧
// ===============================
async function loadChats() {
    try {
        const { data: members, error } = await client
            .from("room_members")
            .select("room_id")
            .eq("user_id", user.id);

        if (error) {
            swalError("部屋一覧取得失敗");
            return;
        }

        const roomIds = (members || []).map(v => v.room_id);

        if (roomIds.length === 0) {
            document.getElementById("chatList").innerHTML =
                `<p>まだ相手がいません。右上の＋ボタンで話し相手を追加しましょう。</p>`;
            return;
        }

        const { data: rooms, error: roomErr } = await client
            .from("rooms")
            .select("*")
            .in("id", roomIds)
            .order("created_at", { ascending: false });

        if (roomErr) {
            swalError("部屋取得失敗");
            return;
        }

        const { data: msgs, error: msgErr } = await client
            .from("messages")
            .select("*")
            .in("room_id", roomIds)
            .order("created_at", { ascending: true });

        if (msgErr) {
            swalError("メッセージ取得失敗");
            return;
        }

        const messages = msgs || [];
        let html = "";

        for (const r of rooms || []) {
            const roomMsgs = messages.filter(
                m => m.room_id === r.id
            );

            const last = roomMsgs[roomMsgs.length - 1];

            const unread = roomMsgs.filter(
                m =>
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
                            ${escapeHTML(
                last?.content ||
                "メッセージなし"
            )}
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
            html =
                `<p>まだ相手がいません。右上の＋ボタンで話し相手を追加しましょう。</p>`;
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

    const { data, error } = await client
        .from("messages")
        .select("*")
        .eq("room_id", currentRoom)
        .order("created_at", { ascending: true });

    if (error) {
        swalError("メッセージ取得失敗");
        return;
    }

    let html = "";
    let lastUser = null;

    (data || []).forEach(m => {
        const isMe = m.sender_id === user.id;

        let cls = isMe
            ? "bubble-me"
            : "bubble-you";

        if (!isMe && lastUser === m.sender_id) {
            cls += " square";
        }

        const attachment = m.file_url
            ? `
            <button
                class="btn btn-sm btn-light mt-1"
                onclick="loadFile('${m.file_url}')">
                添付表示
            </button>`
            : "";

        html += `
            <div class="${cls}">
                ${escapeHTML(m.content || "")}
                ${attachment}

                <div class="meta">
                    ${formatDate(m.created_at)}
                </div>
            </div>
            <div style="clear:both"></div>
        `;

        lastUser = m.sender_id;
    });

    document.getElementById("messages").innerHTML =
        html;

    await markAsReadBatch();

    const box = document.getElementById("messages");
    box.scrollTop = box.scrollHeight;
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
            payload => {
                const msg = payload.new;

                if (
                    currentRoom &&
                    msg.room_id === currentRoom
                ) {
                    loadMessages();
                }

                if (
                    msg.sender_id !== user.id
                ) {
                    audio.play().catch(() => { });
                }

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
// PIN追加（既存1対1再利用）
// ===============================
async function addByPin(pin) {
    const { data: target } = await client
        .from("profiles")
        .select("*")
        .eq("pin", pin)
        .single();

    if (!target) {
        swalError("見つかりません");
        return;
    }

    if (target.id === user.id) {
        swalError("自分は追加できません");
        return;
    }

    const { data: myRooms } = await client
        .from("room_members")
        .select("room_id")
        .eq("user_id", user.id);

    for (const row of myRooms || []) {
        const { data: members } =
            await client
                .from("room_members")
                .select("user_id")
                .eq("room_id", row.room_id);

        const ids = (members || [])
            .map(v => v.user_id)
            .sort();

        if (
            ids.length === 2 &&
            ids.includes(user.id) &&
            ids.includes(target.id)
        ) {
            swalSuccess("既存部屋を再利用");
            loadChats();
            return;
        }
    }

    const { data: room, error } =
        await client
            .from("rooms")
            .insert({
                name: target.name,
            })
            .select()
            .single();

    if (error || !room) {
        swalError("部屋作成失敗");
        return;
    }

    await client.from("room_members").insert([
        {
            room_id: room.id,
            user_id: user.id,
        },
        {
            room_id: room.id,
            user_id: target.id,
        },
    ]);

    swalSuccess("追加しました");
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
function addQR() {
    const pin =
        localStorage.getItem("username") ||
        "user";

    const payload = btoa(
        JSON.stringify({
            from: pin,
        })
    );

    const url =
        location.origin +
        "/add.html?data=" +
        payload;

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

function showQR() {
    const payload = btoa(
        JSON.stringify({
            room_id: currentRoom,
        })
    );

    const url =
        location.origin +
        "/add.html?data=" +
        payload;

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

function scanQR() {
    Swal.fire({
        width: 420,
        showConfirmButton: false,
        html: `
        <div class="d-flex justify-content-between align-items-center mb-2">
            <button class="btn btn-sm"
                onclick="openAdd()">
                <i class="bi bi-arrow-left"></i>
            </button>

            <h3 class="m-0">読み込み</h3>
            <div style="width:32px"></div>
        </div>

        <div id="qrReader"></div>
        `,
        didOpen: () => {
            const qr =
                new Html5Qrcode(
                    "qrReader"
                );

            qr.start(
                {
                    facingMode:
                        "environment",
                },
                {
                    fps: 10,
                    qrbox: 240,
                },
                async decoded => {
                    await qr.stop();
                    Swal.close();

                    try {
                        const raw =
                            decoded.split(
                                "data="
                            )[1];

                        const obj =
                            JSON.parse(
                                atob(raw)
                            );

                        if (obj.from) {
                            await addByPin(
                                obj.from
                            );
                        }

                        if (
                            obj.room_id
                        ) {
                            await joinRoom(
                                obj.room_id
                            );
                        }

                    } catch {
                        swalError(
                            "不正なQR"
                        );
                    }
                }
            );
        },
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

        </div>
        `,
    });
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