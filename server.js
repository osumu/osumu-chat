import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ルートで index.html
app.get('/', (req, res) => {
    res.sendFile(process.cwd() + '/public/index.html');
});

// ===== Supabase =====
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ===== multer =====
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

// ===== JWT =====
function auth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).send('No token');
    try {
        const token = authHeader.split(' ')[1];
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (e) {
        return res.status(401).send('Invalid token');
    }
}

// ===== Signup =====
app.post('/signup', async (req, res) => {
    const { name, password } = req.body;

    const hash = await bcrypt.hash(password, 10);
    const pin = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');

    const { data, error } = await supabase
        .from('users')
        .insert({ username: name, password_hash: hash, chat_pin: pin })
        .select()
        .single();

    if (error) return res.status(500).send(error.message);

    const token = jwt.sign({ id: data.id, name }, process.env.JWT_SECRET);

    res.json({ token, pin });
});

// ===== Login =====
app.post('/login', async (req, res) => {
    const { name, password } = req.body;

    const { data } = await supabase
        .from('users')
        .select()
        .eq('username', name)
        .single();

    if (!data) return res.status(400).send('User not found');

    const ok = await bcrypt.compare(password, data.password_hash);
    if (!ok) return res.status(400).send('Wrong password');

    const token = jwt.sign({ id: data.id, name }, process.env.JWT_SECRET);

    res.json({ token, pin: data.chat_pin });
});

// ===== PIN検索 =====
app.get('/user-by-pin/:pin', auth, async (req, res) => {
    const { data } = await supabase
        .from('users')
        .select('id,username')
        .eq('chat_pin', req.params.pin)
        .single();

    if (!data) return res.status(404).send('Not found');

    res.json(data);
});

// ===== メッセージ取得 =====
app.get('/messages/:id', auth, async (req, res) => {
    const me = req.user.id;
    const other = parseInt(req.params.id);

    const { data } = await supabase
        .from('messages')
        .select('*')
        .or(`and(sender_id.eq.${me},receiver_id.eq.${other}),and(sender_id.eq.${other},receiver_id.eq.${me})`)
        .order('created_at', { ascending: true });

    res.json(data || []);
});

// ===== 未読 =====
app.get('/unread', auth, async (req, res) => {
    const me = req.user.id;

    const { data } = await supabase
        .from('messages')
        .select('sender_id')
        .eq('receiver_id', me)
        .eq('is_read', false);

    const map = {};
    data.forEach(d => {
        map[d.sender_id] = (map[d.sender_id] || 0) + 1;
    });

    res.json(Object.entries(map).map(([k, v]) => ({ sender_id: +k, count: v })));
});

// ===== プロフィール更新 =====
app.post('/update-profile', auth, async (req, res) => {
    const { username } = req.body;

    const { data, error } = await supabase
        .from('users')
        .update({ username })
        .eq('id', req.user.id)
        .select()
        .single();

    if (error) return res.status(500).send(error.message);

    res.json(data);
});

// ===== ファイルアップロード =====
app.post('/upload', auth, upload.single('file'), async (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).send('No file');

    const name = `chat/${req.user.id}/${Date.now()}_${file.originalname}`;

    const { error } = await supabase.storage
        .from('chat-files')
        .upload(name, file.buffer, { contentType: file.mimetype });

    if (error) return res.status(500).send(error.message);

    const { data } = supabase.storage
        .from('chat-files')
        .getPublicUrl(name);

    res.json({ url: data.publicUrl });
});

// ===== Socket =====
io.use((socket, next) => {
    try {
        socket.user = jwt.verify(socket.handshake.auth.token, process.env.JWT_SECRET);
        next();
    } catch (e) {
        next(new Error('Auth error'));
    }
});

io.on('connection', socket => {
    socket.on('private message', async data => {
        const { to, message, file } = data;

        await supabase.from('messages').insert({
            sender_id: socket.user.id,
            receiver_id: to,
            content: message || null,
            file_url: file || null
        });

        socket.to(to).emit('private message', {
            from: socket.user.id,
            message,
            file
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running:', PORT));