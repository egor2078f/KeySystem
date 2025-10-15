// server.js - Серверная часть на Node.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;
const DB_FILE = path.join(__dirname, 'keys_database.json');

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Инициализация базы данных
function initDatabase() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = {
            keys: {},
            lastGeneration: {},
            stats: {
                totalGenerated: 0,
                activeKeys: 0,
                expiredKeys: 0
            }
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    }
}

// Чтение базы данных
function readDatabase() {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
}

// Запись в базу данных
function writeDatabase(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Очистка истекших ключей
function cleanExpiredKeys(db) {
    const now = Date.now();
    let activeCount = 0;
    let expiredCount = 0;

    for (let key in db.keys) {
        if (db.keys[key].expiry < now) {
            db.keys[key].status = 'expired';
            expiredCount++;
        } else {
            db.keys[key].status = 'active';
            activeCount++;
        }
    }

    db.stats.activeKeys = activeCount;
    db.stats.expiredKeys = expiredCount;
    return db;
}

// API: Генерация нового ключа
app.post('/api/generate', (req, res) => {
    const { userId } = req.body;
    
    if (!userId) {
        return res.status(400).json({ 
            success: false, 
            error: 'User ID required' 
        });
    }

    let db = readDatabase();
    const now = Date.now();
    const COOLDOWN = 18 * 60 * 60 * 1000; // 18 часов

    // Проверка кулдауна
    if (db.lastGeneration[userId]) {
        const timeSinceLastGen = now - db.lastGeneration[userId];
        if (timeSinceLastGen < COOLDOWN) {
            const remainingTime = COOLDOWN - timeSinceLastGen;
            return res.status(429).json({
                success: false,
                error: 'Cooldown active',
                remainingTime: remainingTime,
                nextGenerationTime: db.lastGeneration[userId] + COOLDOWN
            });
        }
    }

    // Генерация ключа
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let key = '';
    for (let i = 0; i < 32; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const expiryTime = now + (18 * 60 * 60 * 1000);

    // Сохранение в базу
    db.keys[key] = {
        userId: userId,
        created: now,
        expiry: expiryTime,
        status: 'active',
        createdDate: new Date(now).toISOString()
    };

    db.lastGeneration[userId] = now;
    db.stats.totalGenerated++;
    db.stats.activeKeys++;

    db = cleanExpiredKeys(db);
    writeDatabase(db);

    res.json({
        success: true,
        key: key,
        expiry: expiryTime,
        created: now
    });
});

// API: Проверка валидности ключа
app.post('/api/validate', (req, res) => {
    const { key } = req.body;
    
    if (!key) {
        return res.status(400).json({
            success: false,
            valid: false,
            error: 'Key required'
        });
    }

    let db = readDatabase();
    db = cleanExpiredKeys(db);
    writeDatabase(db);

    if (!db.keys[key]) {
        return res.json({
            success: true,
            valid: false,
            reason: 'Key not found'
        });
    }

    const keyData = db.keys[key];
    const now = Date.now();

    if (keyData.expiry < now) {
        return res.json({
            success: true,
            valid: false,
            reason: 'Key expired',
            expiredAt: keyData.expiry
        });
    }

    res.json({
        success: true,
        valid: true,
        key: key,
        created: keyData.created,
        expiry: keyData.expiry,
        remainingTime: keyData.expiry - now
    });
});

// API: Получить все ключи
app.get('/api/keys', (req, res) => {
    let db = readDatabase();
    db = cleanExpiredKeys(db);
    writeDatabase(db);

    res.json({
        success: true,
        keys: db.keys,
        stats: db.stats
    });
});

// API: Получить статистику
app.get('/api/stats', (req, res) => {
    let db = readDatabase();
    db = cleanExpiredKeys(db);
    writeDatabase(db);

    res.json({
        success: true,
        stats: db.stats
    });
});

// API: Проверить кулдаун для пользователя
app.post('/api/cooldown', (req, res) => {
    const { userId } = req.body;
    
    if (!userId) {
        return res.status(400).json({
            success: false,
            error: 'User ID required'
        });
    }

    const db = readDatabase();
    const now = Date.now();
    const COOLDOWN = 18 * 60 * 60 * 1000;

    if (!db.lastGeneration[userId]) {
        return res.json({
            success: true,
            canGenerate: true,
            remainingTime: 0
        });
    }

    const timeSinceLastGen = now - db.lastGeneration[userId];
    const canGenerate = timeSinceLastGen >= COOLDOWN;
    const remainingTime = canGenerate ? 0 : COOLDOWN - timeSinceLastGen;

    res.json({
        success: true,
        canGenerate: canGenerate,
        remainingTime: remainingTime,
        lastGeneration: db.lastGeneration[userId],
        nextGenerationTime: db.lastGeneration[userId] + COOLDOWN
    });
});

// Инициализация и запуск сервера
initDatabase();

app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
    console.log(`📁 База данных: ${DB_FILE}`);
});
